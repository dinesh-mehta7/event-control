-- Tracks tools/material issued to team leaders for a task and returned after completion.
create table if not exists public.manpower_task_resources (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  task_id text not null references public.manpower_tasks(id) on delete cascade,
  item_id text not null references public.inventory_items(id) on delete restrict,
  location text not null references public.inventory_locations(id) on delete restrict,
  qty integer not null check (qty > 0),
  team_leader text not null,
  received_by text not null default '',
  received_at timestamptz,
  returned_good_qty integer not null default 0 check (returned_good_qty >= 0),
  returned_damaged_qty integer not null default 0 check (returned_damaged_qty >= 0),
  returned_by text not null default '',
  returned_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  check (returned_good_qty + returned_damaged_qty <= qty)
);
create index if not exists manpower_task_resources_task_idx on public.manpower_task_resources(organization_id, task_id, created_at);
alter table public.manpower_task_resources enable row level security;
drop policy if exists manpower_task_resources_select on public.manpower_task_resources;
create policy manpower_task_resources_select on public.manpower_task_resources for select
  using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());

create or replace function public.manpower_task_add_resource(p_task_id text, p_item_id text, p_location text, p_qty integer)
returns text language plpgsql security definer set search_path = public as $$
declare t public.manpower_tasks%rowtype; lead_name text; item_org text; location_org text; new_id text;
begin
  if not public.can_manage_manpower() then raise exception 'You cannot allocate task resources.'; end if;
  if p_qty is null or p_qty < 1 then raise exception 'Enter a positive whole-number quantity.'; end if;
  select * into t from public.manpower_tasks where id = p_task_id and organization_id = public.current_organization_id() for update;
  if not found then raise exception 'Task not found.'; end if;
  if t.status = 'complete' then raise exception 'Resources cannot be added after the task is complete.'; end if;
  select lead into lead_name from public.manpower_teams where organization_id = t.organization_id and lower(trim(name)) = lower(trim(t.team));
  if coalesce(trim(lead_name), '') = '' then raise exception 'Assign a team leader before allocating resources.'; end if;
  select organization_id into item_org from public.inventory_items where id = p_item_id;
  if item_org is distinct from t.organization_id then raise exception 'Choose an inventory item from this organization.'; end if;
  select organization_id into location_org from public.inventory_locations where id = p_location;
  if location_org is distinct from t.organization_id then raise exception 'Choose a valid inventory location.'; end if;
  new_id := 'task-resource-' || gen_random_uuid()::text;
  insert into public.manpower_task_resources(id, organization_id, task_id, item_id, location, qty, team_leader, created_by)
    values (new_id, t.organization_id, t.id, p_item_id, p_location, p_qty, lead_name, auth.uid());
  return new_id;
end $$;

create or replace function public.manpower_task_receive_resource(p_resource_id text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.manpower_task_resources%rowtype; t public.manpower_tasks%rowtype; actor_name text; item_name text;
begin
  select name into actor_name from public.profiles where id = auth.uid();
  select * into r from public.manpower_task_resources where id = p_resource_id and organization_id = public.current_organization_id() for update;
  if not found then raise exception 'Task resource allocation not found.'; end if;
  if not public.can_manage_manpower() and lower(trim(coalesce(actor_name,''))) <> lower(trim(r.team_leader)) then raise exception 'Only the assigned team leader can confirm receipt.'; end if;
  select * into t from public.manpower_tasks where id = r.task_id and organization_id = r.organization_id for update;
  if t.status = 'complete' then raise exception 'The task is already complete.'; end if;
  if r.received_at is not null then raise exception 'Receipt has already been recorded.'; end if;
  select name into item_name from public.inventory_items where id = r.item_id;
  insert into public.inventory_movements(id, organization_id, item_id, type, qty, location, given_by, received_by, ref, note, done_by)
    values ('task-issue-' || gen_random_uuid()::text, r.organization_id, r.item_id, 'issue', r.qty, r.location, coalesce(actor_name,'Team'), r.team_leader, t.id, 'Task resource: ' || coalesce(item_name,'item'), coalesce(actor_name,'System'));
  update public.manpower_task_resources set received_by = r.team_leader, received_at = now() where id = r.id;
end $$;

create or replace function public.manpower_task_return_resource(p_resource_id text, p_good_qty integer, p_damaged_qty integer)
returns void language plpgsql security definer set search_path = public as $$
declare r public.manpower_task_resources%rowtype; t public.manpower_tasks%rowtype; actor_name text; item_name text; left_qty integer;
begin
  if coalesce(p_good_qty,0) < 0 or coalesce(p_damaged_qty,0) < 0 or coalesce(p_good_qty,0) + coalesce(p_damaged_qty,0) < 1 then raise exception 'Enter a positive returned quantity.'; end if;
  select name into actor_name from public.profiles where id = auth.uid();
  select * into r from public.manpower_task_resources where id = p_resource_id and organization_id = public.current_organization_id() for update;
  if not found then raise exception 'Task resource allocation not found.'; end if;
  if not public.can_manage_manpower() and lower(trim(coalesce(actor_name,''))) <> lower(trim(r.team_leader)) then raise exception 'Only the assigned team leader can record this return.'; end if;
  select * into t from public.manpower_tasks where id = r.task_id and organization_id = r.organization_id for update;
  if t.status <> 'complete' then raise exception 'Resources can be returned after the task is complete.'; end if;
  if r.received_at is null then raise exception 'The team leader has not confirmed receipt.'; end if;
  left_qty := r.qty - r.returned_good_qty - r.returned_damaged_qty;
  if p_good_qty + p_damaged_qty > left_qty then raise exception 'Only % item(s) remain to be returned.', left_qty; end if;
  select name into item_name from public.inventory_items where id = r.item_id;
  if p_good_qty > 0 then
    insert into public.inventory_movements(id, organization_id, item_id, type, qty, location, returned_by, ref, note, done_by)
      values ('task-return-' || gen_random_uuid()::text, r.organization_id, r.item_id, 'return', p_good_qty, r.location, r.team_leader, t.id, 'Task resource returned: ' || coalesce(item_name,'item'), coalesce(actor_name,'System'));
  end if;
  if p_damaged_qty > 0 then
    insert into public.inventory_movements(id, organization_id, item_id, type, qty, location, returned_by, ref, note, done_by)
      values ('task-return-damaged-' || gen_random_uuid()::text, r.organization_id, r.item_id, 'return_damaged', p_damaged_qty, r.location, r.team_leader, t.id, 'Task resource returned damaged: ' || coalesce(item_name,'item'), coalesce(actor_name,'System'));
  end if;
  update public.manpower_task_resources
    set returned_good_qty = r.returned_good_qty + p_good_qty,
        returned_damaged_qty = r.returned_damaged_qty + p_damaged_qty,
        returned_by = r.team_leader,
        returned_at = case when r.returned_good_qty + p_good_qty + r.returned_damaged_qty + p_damaged_qty = r.qty then now() else null end
    where id = r.id;
end $$;

revoke all on function public.manpower_task_add_resource(text,text,text,integer) from public;
revoke all on function public.manpower_task_receive_resource(text) from public;
revoke all on function public.manpower_task_return_resource(text,integer,integer) from public;
grant execute on function public.manpower_task_add_resource(text,text,text,integer) to authenticated;
grant execute on function public.manpower_task_receive_resource(text) to authenticated;
grant execute on function public.manpower_task_return_resource(text,integer,integer) to authenticated;

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.manpower_task_resources'; exception when duplicate_object then null; end;
end $$;
notify pgrst, 'reload schema';
