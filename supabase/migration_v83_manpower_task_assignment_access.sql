-- Match task and resource assignment permissions with the Sewadar and
-- Accommodation workspaces, which both expose team-management controls.
create or replace function public.can_manage_manpower()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select approved and is_active
      and (level in ('owner','dept_head') or sub_department in ('sewadars','accommodation'))
    from public.profiles where id = auth.uid()
  ), false);
$$;

notify pgrst, 'reload schema';

-- A task resource can be handed to the team's lead, an assigned Sewadar,
-- or the named task owner when legacy teams have no configured lead.
create or replace function public.manpower_task_add_resource(p_task_id text, p_item_id text, p_location text, p_qty integer)
returns text language plpgsql security definer set search_path = public as $$
declare t public.manpower_tasks%rowtype; lead_name text; item_org text; location_org text; new_id text;
begin
  if not public.can_manage_manpower() then raise exception 'You cannot allocate task resources.'; end if;
  if p_qty is null or p_qty < 1 then raise exception 'Enter a positive whole-number quantity.'; end if;
  select * into t from public.manpower_tasks where id=p_task_id and organization_id=public.current_organization_id() for update;
  if not found then raise exception 'Task not found.'; end if;
  if t.status='complete' then raise exception 'Resources cannot be added after the task is complete.'; end if;
  select lead into lead_name from public.manpower_teams where organization_id=t.organization_id and lower(trim(name))=lower(trim(t.team));
  if coalesce(trim(lead_name),'')='' then
    select m.name into lead_name
    from public.manpower_task_members tm join public.accommodation_members m on m.id=tm.member_id
    where tm.organization_id=t.organization_id and tm.task_id=t.id
    order by tm.created_at asc limit 1;
  end if;
  lead_name := coalesce(nullif(trim(lead_name),''), nullif(trim(t.assigned_to),''));
  if coalesce(trim(lead_name),'')='' then raise exception 'Assign a team lead, Sewadar, or task owner before allocating resources.'; end if;
  select organization_id into item_org from public.inventory_items where id=p_item_id;
  if item_org is distinct from t.organization_id then raise exception 'Choose an inventory item from this organization.'; end if;
  select organization_id into location_org from public.inventory_locations where id=p_location;
  if location_org is distinct from t.organization_id then raise exception 'Choose a valid inventory location.'; end if;
  new_id := 'task-resource-' || gen_random_uuid()::text;
  insert into public.manpower_task_resources(id,organization_id,task_id,item_id,location,qty,team_leader,created_by)
  values(new_id,t.organization_id,t.id,p_item_id,p_location,p_qty,lead_name,auth.uid());
  return new_id;
end $$;

revoke all on function public.manpower_task_add_resource(text,text,text,integer) from public;
grant execute on function public.manpower_task_add_resource(text,text,text,integer) to authenticated;
notify pgrst, 'reload schema';
