-- ============================================================================
-- v118 · Every department manages its own walkies
-- ----------------------------------------------------------------------------
-- A department sees the radios allocated to it ("Walkies" page), decides who holds each one, and
-- reports a problem (needs repair, lost / damaged, other issue). The Walkie team sees the reports in
-- Walkie devices and sends the radio to repair, resolves or dismisses them; the reporter is told.
--   walkie_set_holder(walkie, name, contact)      people of the radio's department (or the Walkie team)
--   walkie_report_issue(walkie, kind, issue)      people of the radio's department (or the Walkie team)
--   walkie_issue_update(id, status, note)         Walkie team: in_repair / resolved / dismissed
-- Apply after migration_v117_walkie_return_transfer.sql. Safe to re-run.
-- ============================================================================

create table if not exists public.walkie_issues (
  id               text primary key,
  organization_id  text not null references public.organizations(id) on delete cascade,
  walkie_id        text not null references public.walkies(id) on delete cascade,
  department_id    text references public.departments(id) on delete set null,
  kind             text not null default 'repair' check (kind in ('repair','lost','other')),
  issue            text not null,
  status           text not null default 'open' check (status in ('open','in_repair','resolved','dismissed')),
  reported_by      uuid references public.profiles(id) on delete set null,
  reported_by_name text not null default '',
  note             text not null default '',
  closed_by        text not null default '',
  closed_at        timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists walkie_issues_org_idx on public.walkie_issues (organization_id, status, created_at desc);
create index if not exists walkie_issues_walkie_idx on public.walkie_issues (walkie_id) where status in ('open','in_repair');
alter table public.walkie_issues enable row level security;

-- The Walkie team (Admin / Operator) and the Super Admin see every report; a department sees its own.
drop policy if exists walkie_issues_select on public.walkie_issues;
create policy walkie_issues_select on public.walkie_issues for select using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.current_role() in ('Admin','Operator') or public.current_level() = 'owner'
       or department_id = (select p.department_id from public.profiles p where p.id = auth.uid()))
);
revoke insert, update, delete on public.walkie_issues from anon, authenticated;
do $$ begin
  alter publication supabase_realtime add table public.walkie_issues;
exception when duplicate_object then null; end $$;

-- People of the department the radio is allocated to, or the Walkie team / Super Admin.
create or replace function public._walkie_dept_check(p_walkie text)
returns public.walkies language plpgsql stable security definer set search_path = public as $$
declare me record; w public.walkies%rowtype;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into w from public.walkies where id = p_walkie and organization_id = me.organization_id;
  if not found then raise exception 'Radio not found.'; end if;
  if not (me.role in ('Admin','Operator') or me.level = 'owner'
          or (w.status = 'Allocated' and w.department_id is not null and w.department_id = me.department_id)) then
    raise exception 'Only the department this radio is with can do this.';
  end if;
  return w;
end $$;
revoke all on function public._walkie_dept_check(text) from public, anon, authenticated;

-- 1. Who holds the radio (the department decides).
create or replace function public.walkie_set_holder(p_walkie text, p_name text, p_contact text default '')
returns void language plpgsql security definer set search_path = public as $$
declare w public.walkies%rowtype; who text := nullif(trim(coalesce(p_name, '')), '');
begin
  w := public._walkie_dept_check(p_walkie);
  if w.status <> 'Allocated' then raise exception 'Only a radio that is with a department can have a holder.'; end if;
  update public.walkies
    set assigned_person_name = who,
        assigned_person_contact = case when who is null then null else nullif(trim(coalesce(p_contact, '')), '') end
    where id = w.id;
  insert into public.history (id, action, details, type, organization_id)
  values ('hist-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), 'Holder Changed',
          coalesce(w.label, w.id) || ': ' || coalesce('held by ' || who, 'holder cleared') || ' (by ' || coalesce(public.current_name(), 'someone') || ')',
          'info', w.organization_id);
end $$;
revoke all on function public.walkie_set_holder(text,text,text) from public, anon;
grant execute on function public.walkie_set_holder(text,text,text) to authenticated;

-- 2. Report a problem with a radio; tells the Walkie team.
create or replace function public.walkie_report_issue(p_walkie text, p_kind text, p_issue text)
returns text language plpgsql security definer set search_path = public as $$
declare w public.walkies%rowtype; rid text; dept_name text; what text;
begin
  w := public._walkie_dept_check(p_walkie);
  if coalesce(p_kind, '') not in ('repair','lost','other') then raise exception 'Choose what kind of problem it is.'; end if;
  if trim(coalesce(p_issue, '')) = '' then raise exception 'Say what is wrong.'; end if;
  if exists (select 1 from public.walkie_issues where walkie_id = w.id and status in ('open','in_repair')) then
    raise exception 'This radio already has an open report.';
  end if;
  select name into dept_name from public.departments where id = w.department_id;
  rid := 'wi-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  insert into public.walkie_issues (id, organization_id, walkie_id, department_id, kind, issue, reported_by, reported_by_name)
  values (rid, w.organization_id, w.id, w.department_id, p_kind, trim(p_issue), auth.uid(), coalesce(public.current_name(), ''));
  what := case p_kind when 'repair' then 'needs repair' when 'lost' then 'lost / damaged' else 'issue' end;
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select w.organization_id, p.id, 'Walkie ' || what || ': ' || coalesce(w.label, w.id),
         coalesce(dept_name, 'A department') || ' · ' || trim(p_issue), 'approval', 'walkie', rid
  from public.profiles p
  where p.organization_id = w.organization_id and p.approved and p.is_active and p.sub_department = 'walkie'
    and p.id is distinct from auth.uid();
  return rid;
end $$;
revoke all on function public.walkie_report_issue(text,text,text) from public, anon;
grant execute on function public.walkie_report_issue(text,text,text) to authenticated;

-- 3. The Walkie team answers a report; the reporter is told.
create or replace function public.walkie_issue_update(p_id text, p_status text, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare i public.walkie_issues%rowtype; label text;
begin
  perform public._walkie_team_check();
  if p_status not in ('in_repair','resolved','dismissed') then raise exception 'Unknown status.'; end if;
  select * into i from public.walkie_issues where id = p_id and organization_id = public.current_organization_id() for update;
  if not found then raise exception 'Report not found.'; end if;
  if i.status in ('resolved','dismissed') then raise exception 'This report is already closed.'; end if;
  update public.walkie_issues
    set status = p_status, note = trim(coalesce(p_note, '')), closed_by = coalesce(public.current_name(), ''),
        closed_at = case when p_status = 'in_repair' then null else now() end
    where id = p_id;
  select coalesce(w.label, w.id) into label from public.walkies w where w.id = i.walkie_id;
  if i.reported_by is not null then
    insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
    values (i.organization_id, i.reported_by,
            'Walkie report: ' || case p_status when 'in_repair' then 'sent to repair' when 'resolved' then 'resolved' else 'closed' end,
            coalesce(label, i.walkie_id) || case when trim(coalesce(p_note, '')) <> '' then ' · ' || trim(p_note) else '' end,
            'info', 'my-walkies', i.id);
  end if;
end $$;
revoke all on function public.walkie_issue_update(text,text,text) from public, anon;
grant execute on function public.walkie_issue_update(text,text,text) to authenticated;

notify pgrst, 'reload schema';
