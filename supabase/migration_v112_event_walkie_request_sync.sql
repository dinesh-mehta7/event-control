-- ============================================================================
-- v112 · Event walkie requests: the Walkie team sets the pickup point, everyone is told
-- ----------------------------------------------------------------------------
-- 1. The requester no longer chooses where to collect from (they cannot know). collect_from is
--    now the pickup point the Walkie team sets when the radios are allocated / ready.
-- 2. Every step notifies the right people: submit → the department's head(s); approve → the
--    requester and the Walkie team; decline / ready (with pickup point) / handed over → the requester.
-- Apply after migration_v111_order_to_handover_flow.sql. Safe to re-run.
-- ============================================================================

-- 1a. Submit without a pickup point (the parameter stays for older screens, and is ignored if empty).
drop function if exists public.event_radio_request_submit(text, integer, integer, integer, text);
create function public.event_radio_request_submit(
  p_event_id text,
  p_walkies integer,
  p_chargers integer,
  p_earphones integer,
  p_collect_from text default ''
)
returns text language plpgsql security definer set search_path = public as $$
declare p public.profiles%rowtype; d public.departments%rowtype; ev public.event_plans%rowtype; rid text;
begin
  select * into p from public.profiles where id = auth.uid() and organization_id = public.current_organization_id() and is_active and approved;
  if not found or p.role = 'Client' or p.level not in ('dept_head','sub_dept_head','owner') then raise exception 'Only department leads and admins can request event radios.'; end if;
  if p.department_id is null and p.level <> 'owner' then raise exception 'Ask an admin to assign your department first.'; end if;
  if p_walkies <= 0 or p_chargers < 0 or p_earphones < 0 then raise exception 'Enter valid whole-number quantities.'; end if;
  if p.level = 'owner' and p.department_id is null then raise exception 'Select the department this request is for.'; end if;
  select * into d from public.departments where id = p.department_id and organization_id = p.organization_id;
  if not found then raise exception 'Your assigned department could not be found.'; end if;
  select * into ev from public.event_plans where id = p_event_id and organization_id = p.organization_id and status <> 'cancelled';
  if not found then raise exception 'Select an active event.'; end if;
  rid := 'radio-' || gen_random_uuid()::text;
  insert into public.event_radio_requests(id,organization_id,event_id,department_id,department_name,requester_id,requester_name,walkie_count,charger_count,earphone_count,collect_from)
  values(rid,p.organization_id,p_event_id,d.id,d.name,p.id,p.name,p_walkies,p_chargers,p_earphones,trim(coalesce(p_collect_from,'')));
  return rid;
end $$;
revoke all on function public.event_radio_request_submit(text,integer,integer,integer,text) from public, anon;
grant execute on function public.event_radio_request_submit(text,integer,integer,integer,text) to authenticated;

-- 1b. The Walkie team sets (or changes) where the department collects its radios.
create or replace function public.event_radio_request_set_pickup(p_id text, p_point text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.event_radio_requests%rowtype; point text := trim(coalesce(p_point,''));
begin
  if not (public.current_role() in ('Admin','Operator') and (public.current_level()='owner' or (public.current_level()='sub_dept_head' and public.current_sub_department()='walkie'))) then
    raise exception 'Walkie team access required.';
  end if;
  if point = '' then raise exception 'Enter where the department should collect the radios.'; end if;
  select * into r from public.event_radio_requests where id=p_id and organization_id=public.current_organization_id() for update;
  if not found then raise exception 'Request not found.'; end if;
  if r.status not in ('approved','ready') then raise exception 'The pickup point can be set only before the radios are handed over.'; end if;
  update public.event_radio_requests set collect_from = point, updated_at = now() where id = p_id;
  if r.status = 'ready' and point is distinct from r.collect_from then
    insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
    values (r.organization_id, r.requester_id, 'Walkie pickup point changed',
            r.walkie_count || ' walkie(s) for ' || r.department_name || ': collect from ' || point || '.', 'info', 'requests/mine', r.id);
  end if;
end $$;
revoke all on function public.event_radio_request_set_pickup(text,text) from public, anon;
grant execute on function public.event_radio_request_set_pickup(text,text) to authenticated;

-- 2. Notifications at every step.
create or replace function public._event_radio_request_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare what text;
begin
  what := new.walkie_count || ' walkie(s)' ||
          case when new.charger_count > 0 then ', ' || new.charger_count || ' charger(s)' else '' end ||
          case when new.earphone_count > 0 then ', ' || new.earphone_count || ' earphone(s)' else '' end;
  if tg_op = 'INSERT' then
    insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
    select new.organization_id, p.id, 'Walkie request to approve',
           new.requester_name || ' (' || new.department_name || ') asked for ' || what || '.', 'approval', 'requests/review', new.id
    from public.profiles p
    where p.organization_id = new.organization_id and p.approved and p.is_active and p.id is distinct from new.requester_id
      and p.level = 'dept_head' and p.department_id = new.department_id;
    return new;
  end if;
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'approved' then
    insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
    values (new.organization_id, new.requester_id, 'Walkie request approved',
            what || ' approved. The Walkie team will allocate them and tell you where to collect.', 'info', 'requests/mine', new.id);
    insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
    select new.organization_id, p.id, 'Walkies to allocate: ' || new.department_name, what || ' approved for ' || new.department_name || '.',
           'approval', 'walkie/requests', new.id
    from public.profiles p
    where p.organization_id = new.organization_id and p.approved and p.is_active and p.sub_department = 'walkie';
  elsif new.status = 'rejected' then
    insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
    values (new.organization_id, new.requester_id, 'Walkie request declined',
            what || ' declined' || case when coalesce(new.approval_note,'') <> '' then ': ' || new.approval_note else '.' end, 'warning', 'requests/mine', new.id);
  elsif new.status = 'ready' then
    insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
    values (new.organization_id, new.requester_id, 'Walkies ready',
            what || ' are ready' || case when coalesce(new.collect_from,'') <> '' then '. Collect from ' || new.collect_from || '.' else '. The Walkie team will hand them over.' end,
            'info', 'requests/mine', new.id);
  elsif new.status = 'delivered' then
    insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
    values (new.organization_id, new.requester_id, 'Walkies handed over',
            what || ' handed over' || case when coalesce(new.signed_by,'') <> '' then ' to ' || new.signed_by else '' end || '. Return them after the event.', 'info', 'requests/mine', new.id);
  end if;
  return new;
end $$;
drop trigger if exists event_radio_request_notify on public.event_radio_requests;
create trigger event_radio_request_notify after insert or update of status on public.event_radio_requests
  for each row execute function public._event_radio_request_notify();

notify pgrst, 'reload schema';
