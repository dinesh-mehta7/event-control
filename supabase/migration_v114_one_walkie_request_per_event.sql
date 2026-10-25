-- ============================================================================
-- v114 · One event walkie request per department per event
-- ----------------------------------------------------------------------------
-- A department asks once for an event. A second request for the same event is refused while the
-- first is still open (anything except declined / fully returned); instead the quantities of the
-- open request can be changed while it is still waiting for approval.
-- Apply after migration_v113_request_visible_to_involved_departments.sql. Safe to re-run.
-- ============================================================================

drop function if exists public.event_radio_request_submit(text, integer, integer, integer, text);
create function public.event_radio_request_submit(
  p_event_id text,
  p_walkies integer,
  p_chargers integer,
  p_earphones integer,
  p_collect_from text default ''
)
returns text language plpgsql security definer set search_path = public as $$
declare p public.profiles%rowtype; d public.departments%rowtype; ev public.event_plans%rowtype; rid text; open_one record;
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
  select id, status into open_one from public.event_radio_requests
    where organization_id = p.organization_id and event_id = p_event_id and department_id = d.id
      and status not in ('rejected','returned')
    limit 1;
  if found then
    raise exception '% already has a walkie request for %. %', d.name, ev.name,
      case when open_one.status = 'pending_approval' then 'Change its quantities under My requests instead.'
           else 'Ask the Walkie team if you need more.' end;
  end if;
  rid := 'radio-' || gen_random_uuid()::text;
  insert into public.event_radio_requests(id,organization_id,event_id,department_id,department_name,requester_id,requester_name,walkie_count,charger_count,earphone_count,collect_from)
  values(rid,p.organization_id,p_event_id,d.id,d.name,p.id,p.name,p_walkies,p_chargers,p_earphones,trim(coalesce(p_collect_from,'')));
  return rid;
end $$;
revoke all on function public.event_radio_request_submit(text,integer,integer,integer,text) from public, anon;
grant execute on function public.event_radio_request_submit(text,integer,integer,integer,text) to authenticated;

-- Change the quantities of a request that is still waiting for approval (the requester or their head).
create or replace function public.event_radio_request_update(p_id text, p_walkies integer, p_chargers integer, p_earphones integer)
returns void language plpgsql security definer set search_path = public as $$
declare p public.profiles%rowtype; r public.event_radio_requests%rowtype;
begin
  select * into p from public.profiles where id = auth.uid() and organization_id = public.current_organization_id() and is_active and approved;
  if not found then raise exception 'Not allowed.'; end if;
  select * into r from public.event_radio_requests where id = p_id and organization_id = p.organization_id for update;
  if not found then raise exception 'Request not found.'; end if;
  if not (r.requester_id = p.id or p.level = 'owner' or (p.level = 'dept_head' and p.department_id = r.department_id)) then
    raise exception 'Only the person who asked, or their Department Head, can change this request.';
  end if;
  if r.status <> 'pending_approval' then raise exception 'Quantities can be changed only while the request waits for approval.'; end if;
  if p_walkies <= 0 or p_chargers < 0 or p_earphones < 0 then raise exception 'Enter valid whole-number quantities.'; end if;
  update public.event_radio_requests
    set walkie_count = p_walkies, charger_count = p_chargers, earphone_count = p_earphones, updated_at = now()
    where id = p_id;
end $$;
revoke all on function public.event_radio_request_update(text,integer,integer,integer) from public, anon;
grant execute on function public.event_radio_request_update(text,integer,integer,integer) to authenticated;

notify pgrst, 'reload schema';
