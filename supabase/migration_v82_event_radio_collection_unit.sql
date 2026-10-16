-- Add a required collection source unit to the shared event radio request flow.
alter table public.event_radio_requests
  add column if not exists collect_from text not null default '';

drop function if exists public.event_radio_request_submit(text, integer, integer, integer);
create function public.event_radio_request_submit(
  p_event_id text,
  p_walkies integer,
  p_chargers integer,
  p_earphones integer,
  p_collect_from text
)
returns text language plpgsql security definer set search_path = public as $$
declare p public.profiles%rowtype; d public.departments%rowtype; ev public.event_plans%rowtype; rid text;
begin
  select * into p from public.profiles where id = auth.uid() and organization_id = public.current_organization_id() and is_active and approved;
  if not found or p.role = 'Client' or p.level not in ('dept_head','sub_dept_head','owner') then raise exception 'Only department leads and admins can request event radios.'; end if;
  if p.department_id is null and p.level <> 'owner' then raise exception 'Ask an admin to assign your department first.'; end if;
  if p_walkies <= 0 or p_chargers < 0 or p_earphones < 0 then raise exception 'Enter valid whole-number quantities.'; end if;
  if length(trim(coalesce(p_collect_from, ''))) = 0 then raise exception 'Choose the unit where these radios will be collected.'; end if;
  if p.level = 'owner' and p.department_id is null then raise exception 'Select the department this request is for.'; end if;
  select * into d from public.departments where id = p.department_id and organization_id = p.organization_id;
  if not found then raise exception 'Your assigned department could not be found.'; end if;
  select * into ev from public.event_plans where id = p_event_id and organization_id = p.organization_id and status <> 'cancelled';
  if not found then raise exception 'Select an active event.'; end if;
  rid := 'radio-' || gen_random_uuid()::text;
  insert into public.event_radio_requests(id,organization_id,event_id,department_id,department_name,requester_id,requester_name,walkie_count,charger_count,earphone_count,collect_from)
  values(rid,p.organization_id,p_event_id,d.id,d.name,p.id,p.name,p_walkies,p_chargers,p_earphones,trim(p_collect_from));
  return rid;
end $$;
revoke all on function public.event_radio_request_submit(text,integer,integer,integer,text) from public, anon;
grant execute on function public.event_radio_request_submit(text,integer,integer,integer,text) to authenticated;
notify pgrst, 'reload schema';
