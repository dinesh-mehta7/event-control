-- Member issue and site/event complaint reports.
-- Run after migration_v15_access_meetings.sql.

create table if not exists public.member_issues (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reporter_name text not null default '',
  kind text not null check (kind in ('material','site_event')),
  material text not null default '',
  location text not null default '',
  title text not null check (length(trim(title)) > 0),
  details text not null default '',
  status text not null default 'open' check (status in ('open','in_progress','resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists member_issues_org_created_idx on public.member_issues (organization_id, created_at desc);
create index if not exists member_issues_reporter_idx on public.member_issues (reporter_id, created_at desc);

alter table public.member_issues enable row level security;
drop policy if exists member_issues_select on public.member_issues;
create policy member_issues_select on public.member_issues for select using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (reporter_id = auth.uid() or public.current_level() in ('owner','dept_head','sub_dept_head'))
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
  and public.current_level() in ('owner','dept_head','sub_dept_head')
) with check (
  organization_id = public.current_organization_id() and public.current_level() in ('owner','dept_head','sub_dept_head')
);
revoke update on public.member_issues from authenticated;
grant update (status) on public.member_issues to authenticated;

create or replace function public.member_issue_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare title text;
begin
  title := case when new.kind = 'material' then 'Material issue reported' else 'Site/event complaint reported' end;
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select new.organization_id, p.id, title,
    new.reporter_name || ': ' || new.title || case when new.material <> '' then ' · ' || new.material else '' end,
    'warning', 'issues', new.id::text
  from public.profiles p
  where p.organization_id = new.organization_id and p.approved and p.is_active and p.id <> new.reporter_id
    and (p.level in ('owner','dept_head','sub_dept_head')
      or (new.kind = 'material' and p.sub_department = 'inventory')
      or (new.kind = 'site_event' and p.sub_department in ('control','sewadars')));
  return new;
end $$;
drop trigger if exists member_issue_notify on public.member_issues;
create trigger member_issue_notify after insert on public.member_issues
  for each row execute function public.member_issue_notify();

create or replace function public.set_member_issue_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; issue public.member_issues%rowtype;
begin
  if p_status not in ('open','in_progress','resolved') then raise exception 'Unknown issue status.'; end if;
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level not in ('owner','dept_head','sub_dept_head') then
    raise exception 'Only a team lead can update issue status.';
  end if;
  update public.member_issues set status = p_status, updated_at = now()
    where id = p_id and organization_id = me.organization_id returning * into issue;
  if not found then raise exception 'Issue not found.'; end if;
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  values (issue.organization_id, issue.reporter_id, 'Issue status updated',
    'Your report "' || issue.title || '" is now ' || replace(p_status, '_', ' ') || '.',
    case when p_status = 'resolved' then 'info' else 'warning' end, 'issues', issue.id::text);
end $$;
revoke all on function public.set_member_issue_status(uuid, text) from public, anon;
grant execute on function public.set_member_issue_status(uuid, text) to authenticated;

notify pgrst, 'reload schema';
