-- Department-scoped feedback, announcements, and lessons learned.
-- Apply after migration_v67_task_resource_handoffs.sql.

alter table public.member_issues add column if not exists sub_department text;
update public.member_issues i set sub_department = p.sub_department
from public.profiles p where p.id = i.reporter_id and i.sub_department is null;
create index if not exists member_issues_department_created_idx
  on public.member_issues (organization_id, sub_department, created_at desc);

create or replace function public.member_issue_set_department()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select p.sub_department into new.sub_department
  from public.profiles p
  where p.id = auth.uid() and p.organization_id = new.organization_id and p.approved and p.is_active;
  if not found then raise exception 'An active department account is required to submit feedback.'; end if;
  return new;
end $$;
drop trigger if exists member_issue_department on public.member_issues;
create trigger member_issue_department before insert on public.member_issues
  for each row execute function public.member_issue_set_department();

create or replace function public.member_issue_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare msg_title text;
begin
  msg_title := case when new.kind = 'material' then 'Material issue reported' else 'Site/event feedback reported' end;
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select new.organization_id, p.id, msg_title,
    new.reporter_name || ': ' || new.title || case when new.material <> '' then ' · ' || new.material else '' end,
    'warning', 'issues', new.id::text
  from public.profiles p
  where p.organization_id = new.organization_id and p.approved and p.is_active and p.id <> new.reporter_id
    and (p.level in ('owner','dept_head') or (p.level = 'sub_dept_head' and p.sub_department = new.sub_department));
  return new;
end $$;

drop policy if exists member_issues_select on public.member_issues;
create policy member_issues_select on public.member_issues for select using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.current_level() in ('owner','dept_head') or sub_department is not distinct from public.current_sub_department())
);
drop policy if exists member_issues_insert on public.member_issues;
create policy member_issues_insert on public.member_issues for insert with check (
  organization_id = public.current_organization_id() and reporter_id = auth.uid()
  and public.current_is_active() and public.current_approved()
  and (kind <> 'material' or length(trim(material)) > 0)
);
drop policy if exists member_issues_update on public.member_issues;
create policy member_issues_update on public.member_issues for update using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and public.current_level() in ('owner','dept_head')
) with check (
  organization_id = public.current_organization_id() and public.current_level() in ('owner','dept_head')
);

create table if not exists public.department_updates (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('announcement','lesson')),
  department text not null check (department in ('all','cctv','wifi','walkie','control','inventory','purchase','accommodation','sewadars')),
  title text not null check (length(trim(title)) > 0),
  body text not null check (length(trim(body)) > 0),
  author_id uuid not null references public.profiles(id) on delete cascade,
  author_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.department_updates drop constraint if exists department_updates_department_check;
alter table public.department_updates add constraint department_updates_department_check
  check (department in ('all','cctv','wifi','walkie','control','inventory','purchase','accommodation','sewadars'));
create index if not exists department_updates_audience_created_idx
  on public.department_updates (organization_id, department, kind, created_at desc);
grant select, insert, update, delete on public.department_updates to authenticated;
alter table public.department_updates enable row level security;
drop policy if exists department_updates_select on public.department_updates;
create policy department_updates_select on public.department_updates for select using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.current_level() in ('owner','dept_head') or department = 'all' or department = public.current_sub_department())
);
drop policy if exists department_updates_insert on public.department_updates;
create policy department_updates_insert on public.department_updates for insert with check (
  organization_id = public.current_organization_id() and author_id = auth.uid()
  and public.current_is_active() and public.current_approved()
  and public.current_level() in ('owner','dept_head')
);
drop policy if exists department_updates_update on public.department_updates;
create policy department_updates_update on public.department_updates for update using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and public.current_level() in ('owner','dept_head')
) with check (organization_id = public.current_organization_id() and public.current_level() in ('owner','dept_head'));
drop policy if exists department_updates_delete on public.department_updates;
create policy department_updates_delete on public.department_updates for delete using (
  organization_id = public.current_organization_id() and public.current_level() in ('owner','dept_head')
);

create or replace function public.set_member_issue_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; issue public.member_issues%rowtype;
begin
  if p_status not in ('open','in_progress','resolved') then raise exception 'Unknown issue status.'; end if;
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level not in ('owner','dept_head') then
    raise exception 'Only an administrator can update feedback status.';
  end if;
  update public.member_issues set status = p_status, updated_at = now()
    where id = p_id and organization_id = me.organization_id returning * into issue;
  if not found then raise exception 'Feedback not found.'; end if;
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  values (issue.organization_id, issue.reporter_id, 'Feedback status updated',
    'Your report "' || issue.title || '" is now ' || replace(p_status, '_', ' ') || '.',
    case when p_status = 'resolved' then 'info' else 'warning' end, 'issues', issue.id::text);
end $$;
revoke all on function public.set_member_issue_status(uuid, text) from public, anon;
grant execute on function public.set_member_issue_status(uuid, text) to authenticated;

notify pgrst, 'reload schema';
