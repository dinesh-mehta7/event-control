-- Task resources reserve stock when they are allocated, not only when the team leader confirms receipt.
-- Available to issue = in store − reserved for approved requests − allocated to tasks but not yet received.
-- Run after migration_v83.

-- 1. Reservation helpers ------------------------------------------------------------------
create or replace function public._inv_reserved_requests(p_item_id text)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when f.source = 'inventory' then f.qty else least(f.qty, coalesce(pi.qty_received, 0)) end), 0)::integer
  from public.request_fulfilments f left join public.purchase_items pi on pi.id = f.purchase_item_id
  where f.status = 'planned' and f.inventory_item_id = p_item_id;
$$;

create or replace function public._inv_reserved_tasks(p_item_id text, p_exclude_resource text default null)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(qty), 0)::integer from public.manpower_task_resources
  where item_id = p_item_id and received_at is null and id is distinct from p_exclude_resource;
$$;
revoke all on function public._inv_reserved_requests(text) from public, anon, authenticated;
revoke all on function public._inv_reserved_tasks(text, text) from public, anon, authenticated;

-- 2. What can be issued for every item in the caller's organization (used by the allocate picker).
create or replace function public.inventory_availability()
returns table (item_id text, in_stock integer, reserved_requests integer, reserved_tasks integer, available integer)
language sql stable security definer set search_path = public as $$
  select i.id, i.in_stock, x.req, x.tsk, greatest(i.in_stock - x.req - x.tsk, 0)
  from public.inventory_items i
  cross join lateral (select public._inv_reserved_requests(i.id) as req, public._inv_reserved_tasks(i.id) as tsk) x
  where i.organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved();
$$;
revoke all on function public.inventory_availability() from public, anon;
grant execute on function public.inventory_availability() to authenticated;

-- 3. Direct issues cannot take stock reserved by requests or by other task allocations ---------
create or replace function public.inventory_reserve_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare stock integer; req integer; tsk integer; avail integer;
begin
  if new.type <> 'issue' then return new; end if;
  if coalesce(current_setting('app.request_issue', true), '') = '1' then return new; end if;
  select in_stock into stock from public.inventory_items where id = new.item_id;
  if stock is null then return new; end if;
  req := public._inv_reserved_requests(new.item_id);
  -- A task receipt issues its own allocation, so that allocation is not counted against it.
  tsk := public._inv_reserved_tasks(new.item_id, nullif(current_setting('app.task_resource', true), ''));
  avail := stock - req - tsk;
  if new.qty > avail then
    raise exception 'Only % can be issued right now (% in store, % reserved for approved requests, % allocated to other tasks).',
      greatest(avail, 0), stock, req, tsk;
  end if;
  return new;
end $$;
-- (Re)attach the guard so this migration stands on its own. The a0_ name keeps it firing BEFORE the
-- ledger trigger (inventory_apply_movement): same-kind triggers run in name order.
drop trigger if exists inventory_a0_reserve_guard on public.inventory_movements;
create trigger inventory_a0_reserve_guard before insert on public.inventory_movements
  for each row execute function public.inventory_reserve_guard();

-- 4. Allocate: same rules as v83, plus a stock check that holds the item row while it reserves.
create or replace function public.manpower_task_add_resource(p_task_id text, p_item_id text, p_location text, p_qty integer)
returns text language plpgsql security definer set search_path = public as $$
declare t public.manpower_tasks%rowtype; lead_name text; it public.inventory_items%rowtype; location_org text; new_id text; req integer; tsk integer; avail integer;
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
  select * into it from public.inventory_items where id=p_item_id for update;
  if not found or it.organization_id is distinct from t.organization_id then raise exception 'Choose an inventory item from this organization.'; end if;
  select organization_id into location_org from public.inventory_locations where id=p_location;
  if location_org is distinct from t.organization_id then raise exception 'Choose a valid inventory location.'; end if;
  req := public._inv_reserved_requests(it.id);
  tsk := public._inv_reserved_tasks(it.id);
  avail := it.in_stock - req - tsk;
  if p_qty > avail then
    raise exception 'Only % % of % available (% in store, % reserved for approved requests, % allocated to other tasks).',
      greatest(avail, 0), it.unit, it.name, it.in_stock, req, tsk;
  end if;
  new_id := 'task-resource-' || gen_random_uuid()::text;
  insert into public.manpower_task_resources(id,organization_id,task_id,item_id,location,qty,team_leader,created_by)
  values(new_id,t.organization_id,t.id,p_item_id,p_location,p_qty,lead_name,auth.uid());
  return new_id;
end $$;

-- 5. Receipt: same as v67, but tells the guard which allocation is being issued.
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
  perform set_config('app.task_resource', r.id, true);
  insert into public.inventory_movements(id, organization_id, item_id, type, qty, location, given_by, received_by, ref, note, done_by)
    values ('task-issue-' || gen_random_uuid()::text, r.organization_id, r.item_id, 'issue', r.qty, r.location, coalesce(actor_name,'Team'), r.team_leader, t.id, 'Task resource: ' || coalesce(item_name,'item'), coalesce(actor_name,'System'));
  perform set_config('app.task_resource', '', true);
  update public.manpower_task_resources set received_by = r.team_leader, received_at = now() where id = r.id;
end $$;

-- 6. Allocations that were never received can be cancelled, which releases their reservation.
create or replace function public.manpower_task_cancel_resource(p_resource_id text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.manpower_task_resources%rowtype;
begin
  if not public.can_manage_manpower() then raise exception 'You cannot change task resources.'; end if;
  select * into r from public.manpower_task_resources where id = p_resource_id and organization_id = public.current_organization_id() for update;
  if not found then raise exception 'Task resource allocation not found.'; end if;
  if r.received_at is not null then raise exception 'Already received. Record a return instead.'; end if;
  delete from public.manpower_task_resources where id = r.id;
end $$;

revoke all on function public.manpower_task_add_resource(text,text,text,integer) from public;
revoke all on function public.manpower_task_receive_resource(text) from public;
revoke all on function public.manpower_task_cancel_resource(text) from public;
grant execute on function public.manpower_task_add_resource(text,text,text,integer) to authenticated;
grant execute on function public.manpower_task_receive_resource(text) to authenticated;
grant execute on function public.manpower_task_cancel_resource(text) to authenticated;
notify pgrst, 'reload schema';
