-- ============================================================================
-- v105 · Help Desk and Issues & Reports work like Requests
-- ----------------------------------------------------------------------------
-- A ticket or an issue report is raised TO a department (the person raising it picks it; their own
-- department by default). Only that department's people handle it; the person who raised it can
-- still follow it; the Super Admin sees everything. New-ticket and new-issue alerts go only to that
-- department. Announcements / lessons (department_updates) belong to the department that posts them.
-- Existing tickets and issues go to the IT department.
-- Apply after migration_v104_offline_order_status.sql. Safe to re-run.
-- ============================================================================

-- ── 1. Columns + backfill ───────────────────────────────────────────────────
alter table public.helpdesk_tickets add column if not exists to_department_id text references public.departments(id) on delete set null;
alter table public.member_issues add column if not exists to_department_id text references public.departments(id) on delete set null;
alter table public.department_updates add column if not exists owner_department_id text references public.departments(id) on delete set null;

do $$
declare t text; c text;
begin
  foreach t in array array['helpdesk_tickets:to_department_id','member_issues:to_department_id','department_updates:owner_department_id'] loop
    c := split_part(t, ':', 2); t := split_part(t, ':', 1);
    execute format('alter table public.%I disable trigger user', t);
    execute format('update public.%I x set %I = public._it_department(x.organization_id) where x.%I is null', t, c, c);
    execute format('alter table public.%I enable trigger user', t);
  end loop;
end $$;

-- ── 2. Stamp on insert: chosen department → the person's own department → IT ─
create or replace function public._stamp_to_department()
returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new); col text := case when tg_table_name = 'department_updates' then 'owner_department_id' else 'to_department_id' end;
        v text := j->>col;
begin
  if v is null then
    v := coalesce(nullif(current_setting('app.to_department_id', true), ''), public.current_department_id(),
                  (select working_department_id from public.profiles where id = auth.uid()),
                  public._it_department(j->>'organization_id'));
  end if;
  if v is not null and not exists (select 1 from public.departments d where d.id = v and d.organization_id = (j->>'organization_id')) then
    raise exception 'That department is not in your organization.';
  end if;
  new := jsonb_populate_record(new, jsonb_build_object(col, v));
  return new;
end $$;
drop trigger if exists a_stamp_to_department on public.helpdesk_tickets;
create trigger a_stamp_to_department before insert on public.helpdesk_tickets for each row execute function public._stamp_to_department();
drop trigger if exists a_stamp_to_department on public.member_issues;
create trigger a_stamp_to_department before insert on public.member_issues for each row execute function public._stamp_to_department();
drop trigger if exists a_stamp_to_department on public.department_updates;
create trigger a_stamp_to_department before insert on public.department_updates for each row execute function public._stamp_to_department();

-- Raising a ticket to a department: the existing helpdesk_submit, with the department chosen.
create or replace function public.helpdesk_submit_to(p_to_department text, p_subject text, p_description text, p_category text,
  p_priority text, p_department text, p_location text, p_requester_name text default null, p_requester_email text default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if p_to_department is not null and p_to_department <> '' then
    perform set_config('app.to_department_id', p_to_department, true);
  end if;
  return public.helpdesk_submit(p_subject, p_description, p_category, p_priority, p_department, p_location, p_requester_name, p_requester_email);
end $$;
revoke all on function public.helpdesk_submit_to(text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.helpdesk_submit_to(text, text, text, text, text, text, text, text, text) to authenticated;

-- ── 3. Who sees what (restrictive, ANDed with the existing policies) ─────────
drop policy if exists department_scope on public.helpdesk_tickets;
create policy department_scope on public.helpdesk_tickets as restrictive for all
  using (to_department_id is null or public.in_my_department(to_department_id) or requester_id = auth.uid())
  with check (to_department_id is null or public.in_my_department(to_department_id) or requester_id = auth.uid());

create or replace function public._helpdesk_ticket_in_scope(p_ticket uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.helpdesk_tickets t where t.id = p_ticket
    and (t.to_department_id is null or public.in_my_department(t.to_department_id) or t.requester_id = auth.uid()));
$$;
grant execute on function public._helpdesk_ticket_in_scope(uuid) to authenticated;
drop policy if exists department_scope on public.helpdesk_ticket_events;
create policy department_scope on public.helpdesk_ticket_events as restrictive for all
  using (public._helpdesk_ticket_in_scope(ticket_id)) with check (public._helpdesk_ticket_in_scope(ticket_id));

-- Replies / notes go through security-definer functions, so check the department there too.
create or replace function public._helpdesk_event_scope_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public._helpdesk_ticket_in_scope(new.ticket_id) then
    raise exception 'That ticket belongs to another department.';
  end if;
  return new;
end $$;
drop trigger if exists helpdesk_event_scope_guard on public.helpdesk_ticket_events;
create trigger helpdesk_event_scope_guard before insert on public.helpdesk_ticket_events
  for each row execute function public._helpdesk_event_scope_guard();

drop policy if exists department_scope on public.member_issues;
create policy department_scope on public.member_issues as restrictive for all
  using (to_department_id is null or public.in_my_department(to_department_id) or reporter_id = auth.uid())
  with check (to_department_id is null or public.in_my_department(to_department_id) or reporter_id = auth.uid());

drop policy if exists department_scope on public.department_updates;
create policy department_scope on public.department_updates as restrictive for all
  using (owner_department_id is null or public.in_my_department(owner_department_id))
  with check (owner_department_id is null or public.in_my_department(owner_department_id));

-- ── 4. Alerts and auto-assign stay inside the department ────────────────────
create or replace function public.helpdesk_tickets_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare s public.helpdesk_settings; t uuid; label text := '#' || new.number || ' ' || new.subject;
begin
  if tg_op = 'INSERT' then
    perform public._helpdesk_log(new, 'Ticket created by ' || coalesce(nullif(new.requester_name, ''), 'requester'));
    s := public._helpdesk_settings(new.organization_id);
    for t in select p.id from public.profiles p where p.organization_id = new.organization_id and p.approved and p.is_active
             -- Only the handlers of the department the ticket was raised to (and the Super Admin).
             and (p.level = 'owner' or ((p.level = 'dept_head' or p.id = any(s.technician_ids))
                  and (new.to_department_id is null or p.department_id = new.to_department_id))) loop
      perform public._helpdesk_notify(t, new.organization_id, 'New helpdesk ticket', label, case when new.priority = 'critical' then 'critical' else 'info' end, new.id);
    end loop;
    return new;
  end if;
  if new.status <> old.status then
    perform public._helpdesk_log(new, 'Status: ' || replace(old.status, '_', ' ') || ' → ' || replace(new.status, '_', ' '));
    if new.status = 'closed' then
      perform public._helpdesk_notify(new.requester_id, new.organization_id, 'Ticket closed', label || ' — ' || left(new.resolution, 140), 'info', new.id);
    elsif old.status = 'closed' then
      perform public._helpdesk_notify(new.assignee_id, new.organization_id, 'Ticket reopened', label, 'warning', new.id);
    end if;
  end if;
  if new.priority <> old.priority then perform public._helpdesk_log(new, 'Priority: ' || old.priority || ' → ' || new.priority); end if;
  if new.assignee_id is distinct from old.assignee_id then
    perform public._helpdesk_log(new, case when new.assignee_id is null then 'Unassigned' else 'Assigned to ' || new.assignee_name end);
    perform public._helpdesk_notify(new.assignee_id, new.organization_id, 'Ticket assigned to you', label, case when new.priority = 'critical' then 'critical' else 'info' end, new.id);
  end if;
  if new.category <> old.category then perform public._helpdesk_log(new, 'Category: ' || old.category || ' → ' || new.category); end if;
  if new.department <> old.department then perform public._helpdesk_log(new, 'Department: ' || coalesce(nullif(old.department, ''), '—') || ' → ' || coalesce(nullif(new.department, ''), '—')); end if;
  if new.location <> old.location then perform public._helpdesk_log(new, 'Location: ' || coalesce(nullif(old.location, ''), '—') || ' → ' || coalesce(nullif(new.location, ''), '—')); end if;
  if new.due_at is distinct from old.due_at then perform public._helpdesk_log(new, 'Due time changed'); end if;
  return new;
end $$;


-- A category rule's technician is used only if they belong to the ticket's department.
create or replace function public.helpdesk_tickets_autoassign()
returns trigger language plpgsql security definer set search_path = public as $$
declare rule text;
begin
  if new.assignee_id is null then
    select category_rules ->> new.category into rule from public.helpdesk_settings where organization_id = new.organization_id;
    if rule is not null and rule <> '' and exists (
      select 1 from public.profiles p where p.id = rule::uuid
        and (new.to_department_id is null or p.department_id = new.to_department_id or p.level = 'owner')) then
      new.assignee_id := rule::uuid;
      new.assignee_name := coalesce((select name from public.profiles where id = new.assignee_id), '');
    end if;
  end if;
  return new;
end $$;

create or replace function public.member_issue_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare msg_title text;
begin
  msg_title := case
    when new.kind = 'feedback' then 'Feedback received'
    when new.kind = 'site_event' then 'Site/event issue reported'
    when new.kind = 'material' then 'Material issue reported'
    else 'Issue reported'
  end;
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select new.organization_id, p.id, msg_title,
    new.reporter_name || ': ' || new.title || case when new.material <> '' then ' · ' || new.material else '' end,
    'warning', 'issues', new.id::text
  from public.profiles p
  where p.organization_id = new.organization_id and p.approved and p.is_active and p.id <> new.reporter_id
    and (p.level = 'owner'
         or ((new.to_department_id is null or p.department_id = new.to_department_id)
             and (p.level = 'dept_head' or (p.level = 'sub_dept_head' and p.sub_department = new.sub_department))));
  return new;
end $$;

notify pgrst, 'reload schema';
