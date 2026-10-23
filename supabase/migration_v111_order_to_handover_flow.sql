-- ============================================================================
-- v111 · Order → at store → handed over → closed, without dead ends
-- ----------------------------------------------------------------------------
-- 1. Final approval puts the purchase quantities straight on a draft order (no "Create purchase
--    order" click). The draft is prefilled with the vendor and rates of the last order of the same
--    item, so Purchase only checks them and places it.
-- 2. Partial supply: whatever has arrived can be handed over now (the part is split), and Purchase
--    can "close the rest" of a partly received order when the vendor cannot supply it; the approved
--    quantity on the request is reduced, so the request can finish.
-- 3. Arrivals are announced as they come ("8 of 12 at store"), and offline-vendor progress
--    (confirmed / ready / dispatched) now appears on the request timeline and notifies the requester.
-- 4. Purchased walkie-talkies leave inventory stock when they are handed over (no phantom stock).
-- 5. A handed-over request reminds the requester after 1 day and closes itself after 3 days.
--    Runs from pg_cron when it is enabled, and whenever someone opens Requests.
-- Apply after migration_v110_request_purchase_department_fix.sql. Safe to re-run.
-- ============================================================================

alter table public.requests add column if not exists fulfilled_at timestamptz;
alter table public.requests add column if not exists confirm_reminded_at timestamptz;
update public.requests set fulfilled_at = updated_at where status = 'fulfilled' and fulfilled_at is null;

-- ── Order guard: internal steps (closing the rest of an order) may set the status ─────────────
create or replace function public.purchase_orders_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if coalesce(current_setting('app.po_internal', true), '') = '1' then return new; end if;

  new.po_number := old.po_number;
  new.created_by := old.created_by;
  new.organization_id := old.organization_id;
  new.paid_amount := old.paid_amount;
  new.request_id := old.request_id;

  if new.status is distinct from old.status then
    if new.status = 'ordered' then
      if old.status not in ('draft','rejected','pending','approved') then
        raise exception 'Only an open purchase order can be marked as ordered.';
      end if;
      if not public.can_manage_purchase() then raise exception 'Only Purchase can mark an order as placed.'; end if;
      if not exists (select 1 from public.purchase_items where po_id = old.id) then raise exception 'This order has no items.'; end if;
      if new.vendor_id is null then raise exception 'Choose a vendor first.'; end if;
      if exists (select 1 from public.purchase_items where po_id = old.id and rate <= 0) then raise exception 'Enter the rate for every item first.'; end if;
    elsif new.status = 'draft' then
      if old.status <> 'pending' or not public.can_manage_purchase() then raise exception 'Only Purchase can return an old pending order to draft.'; end if;
    elsif new.status in ('pending','approved','rejected') then
      raise exception 'Purchase orders do not need a second approval after the request is approved.';
    elsif new.status = 'cancelled' then
      if old.status not in ('draft','pending','approved','rejected','ordered') then raise exception 'This order can no longer be cancelled.'; end if;
      if not public.can_manage_purchase() then raise exception 'Only Purchase can cancel an order.'; end if;
      if exists (select 1 from public.purchase_receipts where po_id = old.id) then raise exception 'Goods were already received against this order. Use "Close the rest" instead.'; end if;
    else
      raise exception 'That status can only be set by receiving goods.';
    end if;
  end if;

  if new.status in ('draft','ordered') and old.status in ('pending','rejected','draft') then
    new.approved_by := null;
    new.approved_at := null;
  else
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
  end if;
  if new.status in ('draft','ordered') and old.status in ('pending','rejected','draft') then
    new.decision_note := '';
  else
    new.decision_note := old.decision_note;
  end if;

  if old.status not in ('draft','pending','rejected') and (
       new.vendor_id is distinct from old.vendor_id or new.title is distinct from old.title
    or new.requested_by is distinct from old.requested_by or new.deliver_to is distinct from old.deliver_to) then
    raise exception 'This order is locked. Only the expected date and notes can still change.';
  end if;
  return new;
end $$;

-- ── Helpers ───────────────────────────────────────────────────────────────────────────────────
-- How much of an order line has already been handed over to its request.
create or replace function public._purchase_line_handed(p_line text)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(qty), 0)::integer from public.request_fulfilments where purchase_item_id = p_line and status = 'done';
$$;
revoke all on function public._purchase_line_handed(text) from public, anon, authenticated;

-- Marks a request handed over once every approved quantity is done. Returns true when it did.
create or replace function public._request_check_fulfilled(p_request text)
returns boolean language plpgsql security definer set search_path = public as $$
declare r record; all_done boolean;
begin
  select * into r from public.requests where id = p_request for update;
  if not found or r.status <> 'approved' then return false; end if;
  select not exists (
    select 1 from public.request_items i
    where i.request_id = r.id and coalesce(i.qty_approved, 0) > 0
      and coalesce((select sum(x.qty) from public.request_fulfilments x where x.item_id = i.id and x.status = 'done'), 0) < i.qty_approved
  ) into all_done;
  if not all_done then return false; end if;
  update public.requests set status = 'fulfilled', fulfilled_at = now(), confirm_reminded_at = null, updated_at = now() where id = r.id;
  perform public._req_event(r.id, 'fulfilled', 'Everything approved has been handed over');
  perform public._req_notify(r.requester_id, r.organization_id, 'Everything handed over',
    r.number || ': all approved items are handed over. Please open the ticket and confirm you received them.', 'info', r.id);
  perform public._req_notify_group(r.id, 'owner', 'Handed over: ' || r.title,
    r.number || ' is fully handed over. Waiting for ' || r.requester_name || ' to confirm.', 'info');
  return true;
end $$;
revoke all on function public._request_check_fulfilled(text) from public, anon, authenticated;

-- ── 1. Approval → draft order, prefilled from the last order of the same item ──────────────────
create or replace function public._request_auto_po(p_request text)
returns void language plpgsql security definer set search_path = public as $$
declare
  ids text[]; v_po text; line record; prev record; vendor_ids text[]; vendor_modes text[]; refs text[];
begin
  select array_agg(f.id) into ids
  from public.request_fulfilments f join public.requests r on r.id = f.request_id
  where f.request_id = p_request and r.status = 'approved'
    and f.source = 'purchase' and f.status = 'planned' and f.purchase_item_id is null;
  if ids is null then return; end if;

  begin
    v_po := public.purchase_create_po_for_parts(ids);
  exception when others then
    -- Never block an approval: Procurement still sees the lines on To Order and can create the order there.
    perform public._req_event(p_request, 'po_auto_failed', 'The draft order could not be created automatically: ' || sqlerrm);
    return;
  end;

  -- Suggest the vendor and rate of the latest placed order of each item in this department.
  vendor_ids := '{}'; vendor_modes := '{}'; refs := '{}';
  perform set_config('app.po_internal', '1', true);
  for line in select pi.* from public.purchase_items pi where pi.po_id = v_po loop
    select pi2.rate, po2.vendor_id, po2.vendor_mode, po2.po_number into prev
    from public.purchase_items pi2 join public.purchase_orders po2 on po2.id = pi2.po_id
    where pi2.organization_id = line.organization_id and pi2.id <> line.id
      and po2.status in ('ordered','partial','received') and pi2.rate > 0
      and po2.department_id is not distinct from (select department_id from public.purchase_orders where id = v_po)
      and (pi2.inventory_item_id = line.inventory_item_id
           or regexp_replace(lower(trim(pi2.name)), '[^a-z0-9]', '', 'g') = regexp_replace(lower(trim(line.name)), '[^a-z0-9]', '', 'g'))
    order by po2.created_at desc limit 1;
    if found then
      update public.purchase_items set rate = prev.rate where id = line.id;
      vendor_ids := vendor_ids || coalesce(prev.vendor_id, '');
      vendor_modes := vendor_modes || coalesce(prev.vendor_mode, '');
      refs := refs || prev.po_number;
    else
      vendor_ids := vendor_ids || ''::text;
    end if;
  end loop;
  -- One vendor for every line: put it on the order too.
  if array_length(vendor_ids, 1) > 0 and (select count(distinct v) from unnest(vendor_ids) v) = 1 and vendor_ids[1] <> '' then
    update public.purchase_orders
      set vendor_id = vendor_ids[1], vendor_mode = nullif(vendor_modes[1], ''),
          notes = trim(both ' ' from notes || ' Vendor and rates suggested from ' || array_to_string(array(select distinct unnest(refs)), ', ') || '. Check before placing.')
      where id = v_po;
  elsif array_length(refs, 1) > 0 then
    update public.purchase_orders
      set notes = trim(both ' ' from notes || ' Rates suggested from ' || array_to_string(array(select distinct unnest(refs)), ', ') || '. Check before placing.')
      where id = v_po;
  end if;
  perform set_config('app.po_internal', '', true);
end $$;
revoke all on function public._request_auto_po(text) from public, anon, authenticated;

create or replace function public._request_auto_po_on_part()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'purchase' and new.status = 'planned' and new.purchase_item_id is null then
    perform public._request_auto_po(new.request_id);
  end if;
  return null;
end $$;
-- Deferred to the end of the transaction, so every part of one approval lands on one order.
drop trigger if exists request_auto_po_on_part on public.request_fulfilments;
create constraint trigger request_auto_po_on_part after insert on public.request_fulfilments
  deferrable initially deferred for each row execute function public._request_auto_po_on_part();

create or replace function public._request_auto_po_on_approval()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status is distinct from new.status then
    perform public._request_auto_po(new.id);
  end if;
  return null;
end $$;
drop trigger if exists request_auto_po_on_approval on public.requests;
create constraint trigger request_auto_po_on_approval after update of status on public.requests
  deferrable initially deferred for each row execute function public._request_auto_po_on_approval();

-- ── 2a. Hand over what has arrived, even if it is only part of the order ──────────────────────
create or replace function public.request_deliver(p_fulfilment text, p_location text, p_received_by text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record; f public.request_fulfilments%rowtype; r record; ri record; loc_id text; loc_name text;
  got integer := 0; hand integer; done_id text; from_loc text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into f from public.request_fulfilments where id = p_fulfilment for update;
  if not found then raise exception 'Part not found.'; end if;
  select * into r from public.requests where id = f.request_id for update;
  select * into ri from public.request_items where id = f.item_id;
  if r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if f.status = 'done' then raise exception 'Already handed over.'; end if;
  if r.status <> 'approved' then raise exception 'This request is not open.'; end if;

  hand := f.qty;
  if f.source = 'purchase' then
    if f.purchase_item_id is null then raise exception 'The purchase order has not been raised yet.'; end if;
    select coalesce(qty_received, 0) into got from public.purchase_items where id = f.purchase_item_id;
    got := coalesce(got, 0) - public._purchase_line_handed(f.purchase_item_id);
    if got <= 0 then raise exception 'Nothing has arrived at the store for this item yet.'; end if;
    hand := least(f.qty, got);
  end if;
  -- The Sewadar / team assigned the delivery task may hand over too (kept from v46).
  if ri.kind = 'radio' then
    if not (me.level in ('owner','dept_head') or me.sub_department = 'walkie')
       and not public._request_delivery_task_is_assigned(p_fulfilment, me.id) then
      raise exception 'Only the Walkie-Talkie team or the assigned delivery team can confirm radios.';
    end if;
  else
    if not (me.level in ('owner','dept_head') or me.sub_department = 'inventory')
       and not public._request_delivery_task_is_assigned(p_fulfilment, me.id) then
      raise exception 'Only the Inventory team or the assigned delivery team can issue stock.';
    end if;
    if f.inventory_item_id is null then raise exception 'This part is not linked to an inventory item.'; end if;
  end if;

  -- Only part has arrived: split it. The rest keeps this part's id (and its delivery task) and stays planned.
  done_id := f.id;
  if hand < f.qty then
    update public.request_fulfilments set qty = f.qty - hand where id = f.id;
    f.id := 'rf-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
    f.qty := hand;
    f.returned_qty := 0;
    insert into public.request_fulfilments select (f).*;
    done_id := f.id;
  end if;

  if ri.kind = 'radio' then
    -- Purchased radios were added to inventory on receipt; take them out again now.
    if f.source = 'purchase' and f.inventory_item_id is not null then
      select location into from_loc from public.purchase_receipts where item_id = f.purchase_item_id order by done_at desc limit 1;
      perform set_config('app.request_issue', '1', true);
      insert into public.inventory_movements (id, organization_id, item_id, type, qty, location, given_by, received_by, ref, note, done_by)
      values ('mv-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), r.organization_id, f.inventory_item_id, 'issue', hand, from_loc,
              me.name, trim(coalesce(p_received_by, '')), r.number, 'Request ' || r.number || ' · ' || ri.name || ' (walkie-talkie)', me.name);
    end if;
    update public.request_fulfilments set status = 'done', location_name = trim(coalesce(p_location, '')), received_by = trim(coalesce(p_received_by, '')),
           note = trim(coalesce(p_note, '')), done_by = me.name, done_at = now() where id = done_id;
  else
    loc_id := nullif(trim(coalesce(p_location, '')), '');
    if loc_id is null then raise exception 'Choose where it is being sent.'; end if;
    select name into loc_name from public.inventory_locations where id = loc_id and organization_id = r.organization_id;
    if loc_name is null then raise exception 'That location does not exist.'; end if;
    perform set_config('app.request_issue', '1', true);
    insert into public.inventory_movements (id, organization_id, item_id, type, qty, location, given_by, received_by, ref, note, done_by)
    values ('mv-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), r.organization_id, f.inventory_item_id, 'issue', hand, loc_id,
            me.name, trim(coalesce(p_received_by, '')), r.number, 'Request ' || r.number || ' · ' || ri.name, me.name);
    update public.request_fulfilments set status = 'done', location_name = loc_name, received_by = trim(coalesce(p_received_by, '')),
           note = trim(coalesce(p_note, '')), done_by = me.name, done_at = now() where id = done_id;
  end if;

  perform public._req_event(r.id, 'delivered', 'Handed over ' || hand || ' × ' || ri.name || ' (' || f.source || ')' ||
    case when coalesce(trim(p_received_by), '') <> '' then ' to ' || trim(p_received_by) else '' end);

  if not public._request_check_fulfilled(r.id) then
    perform public._req_notify(r.requester_id, r.organization_id, 'Item handed over',
      r.number || ': ' || hand || ' × ' || ri.name || ' handed over' || case when coalesce(trim(p_received_by), '') <> '' then ' to ' || trim(p_received_by) else '' end || '.', 'info', r.id);
  end if;
end $$;
revoke all on function public.request_deliver(text, text, text, text) from public, anon;
grant execute on function public.request_deliver(text, text, text, text) to authenticated;

-- Stock reserved for a purchased part is what has arrived and not yet been handed over.
drop function if exists public.inventory_available();
create function public.inventory_available()
returns table (item_id text, in_stock integer, reserved integer, available integer, department_id text)
language sql stable security definer set search_path = public as $$
  select i.id, i.in_stock,
         coalesce(x.res, 0)::integer,
         greatest(i.in_stock - coalesce(x.res, 0), 0)::integer,
         i.department_id
  from public.inventory_items i
  left join (
    select f.inventory_item_id as iid,
           sum(case when f.source = 'inventory' then f.qty
                    else least(f.qty, greatest(coalesce(pi.qty_received, 0) - public._purchase_line_handed(pi.id), 0)) end) as res
    from public.request_fulfilments f
    left join public.purchase_items pi on pi.id = f.purchase_item_id
    where f.status = 'planned' and f.inventory_item_id is not null
    group by f.inventory_item_id
  ) x on x.iid = i.id
  where i.organization_id = public.current_organization_id()
    and (public.req_is_exec() or public.req_team() in ('inventory','purchase'))
    and public.in_my_department(i.department_id);
$$;
revoke all on function public.inventory_available() from public, anon;
grant execute on function public.inventory_available() to authenticated;

-- ── 2b. Announce every arrival, including partial ones ────────────────────────────────────────
create or replace function public.request_goods_arrived()
returns trigger language plpgsql security definer set search_path = public as $$
declare f record; r record; ri record; handed integer; now_at integer; before_at integer;
begin
  if new.qty_received <= old.qty_received then return new; end if;
  handed := public._purchase_line_handed(new.id);
  for f in select * from public.request_fulfilments where purchase_item_id = new.id and status = 'planned' loop
    now_at := least(f.qty, greatest(new.qty_received - handed, 0));
    before_at := least(f.qty, greatest(old.qty_received - handed, 0));
    if now_at > before_at then
      select * into r from public.requests where id = f.request_id;
      select * into ri from public.request_items where id = f.item_id;
      perform public._req_event(r.id, 'arrived',
        case when now_at >= f.qty then ri.name || ' is at the store' else now_at || ' of ' || f.qty || ' × ' || ri.name || ' at the store' end);
      perform public._req_notify(r.requester_id, r.organization_id, 'At the store',
        r.number || ': ' || case when now_at >= f.qty then ri.name else now_at || ' of ' || f.qty || ' × ' || ri.name end || ' arrived and will be handed over soon.', 'info', r.id);
      perform public._req_notify_group(r.id, case when ri.kind = 'radio' then 'walkie' else 'inventory' end,
        'Ready to hand over: ' || r.title, r.number || ' · ' || now_at || ' × ' || ri.name || ' at the store', 'approval');
    end if;
  end loop;
  return new;
end $$;

-- ── 2d. Delivery tasks follow partial arrivals ────────────────────────────────────────────────
-- A purchased part gets its delivery task as soon as some of it is at the store (was: all of it).
create or replace function public._request_create_delivery_task(p_fulfilment text)
returns void language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare f record; r record; i record; task_id text; task_team text; task_member text; task_assignee text; task_details text;
begin
  select * into f from public.request_fulfilments where id=p_fulfilment;
  if not found or f.status <> 'planned' then return; end if;
  if f.source not in ('inventory','walkie','purchase') then return; end if;
  select * into r from public.requests where id=f.request_id;
  if not found or r.status not in ('approved','fulfilled') then return; end if;
  if coalesce(r.delivery_team,'')='' and r.delivery_member_id is null then return; end if;
  if exists (select 1 from public.manpower_tasks where request_fulfilment_id=f.id) then return; end if;
  if f.source='purchase' then
    if not exists (select 1 from public.purchase_items pi where pi.id=f.purchase_item_id
                   and pi.qty_received - public._purchase_line_handed(pi.id) > 0) then return; end if;
  end if;
  select * into i from public.request_items where id=f.item_id;
  if not found then return; end if;

  task_id := 'request-delivery-' || substr(md5(random()::text || clock_timestamp()::text),1,18);
  task_team := coalesce(r.delivery_team,'');
  task_member := r.delivery_member_id;
  select m.name into task_assignee from public.accommodation_members m where m.id=task_member and m.organization_id=r.organization_id;
  task_details := 'Deliver ' || f.qty || ' ' || i.unit || ' of ' || i.name || ' to ' || r.deliver_to || ' for ' || r.number || ' · requested by ' || r.requester_name;

  insert into public.manpower_tasks(id,organization_id,title,details,team,assigned_to,member_id,due_date,status,request_fulfilment_id)
  values(task_id,r.organization_id,'Deliver ' || i.name || ' · ' || r.number,task_details,task_team,coalesce(task_assignee,''),task_member,r.needed_by,'todo',f.id);

  if task_member is not null then
    insert into public.manpower_task_members(id,organization_id,task_id,member_id)
    values('request-task-member-' || substr(md5(task_id || task_member),1,18),r.organization_id,task_id,task_member)
    on conflict(task_id,member_id) do nothing;
  elsif task_team <> '' then
    insert into public.manpower_task_members(id,organization_id,task_id,member_id)
    select 'request-task-member-' || substr(md5(task_id || m.id),1,18),r.organization_id,task_id,m.id
    from public.accommodation_members m
    where m.organization_id=r.organization_id
      and (exists(select 1 from unnest(coalesce(m.team_names,'{}'::text[])) as team_names(name) where lower(trim(team_names.name))=lower(task_team))
        or lower(trim(coalesce(m.team_name,'')))=lower(task_team))
    on conflict(task_id,member_id) do nothing;
  end if;
end $$;
revoke all on function public._request_create_delivery_task(text) from public, anon, authenticated;

create or replace function public._request_delivery_task_on_purchase_arrival()
returns trigger language plpgsql security definer set search_path = public as $$
declare f record;
begin
  if new.qty_received <= old.qty_received then return new; end if;
  for f in select rf.id from public.request_fulfilments rf
           where rf.purchase_item_id=new.id and rf.source='purchase' and rf.status='planned' loop
    perform public._request_create_delivery_task(f.id);   -- no-op if the part already has its task
  end loop;
  return new;
end $$;

-- Assigning delivery after goods (partly) arrived creates the tasks for what is at the store.
create or replace function public.request_set_delivery_assignment(p_id text, p_team text, p_member text)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record;
  r record;
  fulfilment record;
  team_name text := nullif(trim(coalesce(p_team,'')), '');
  v_member text := nullif(trim(coalesce(p_member,'')), '');
begin
  select * into me from public.profiles where id=auth.uid();
  if not found or not me.approved or not me.is_active or me.level <> 'dept_head' then
    raise exception 'Only the active IT Department Head can assign delivery.';
  end if;
  select * into r from public.requests where id=p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'approved' then raise exception 'Delivery can only be assigned after final approval.'; end if;
  if (team_name is null) = (v_member is null) then raise exception 'Choose either a team or an IT Sewadar.'; end if;
  if team_name is not null and not exists (
    select 1 from public.manpower_teams t where t.organization_id=r.organization_id and lower(trim(t.name))=lower(team_name)
  ) then raise exception 'Choose a valid delivery team.'; end if;
  if v_member is not null and not exists (
    select 1 from public.accommodation_members m
    where m.id=v_member and m.organization_id=r.organization_id and lower(coalesce(m.department,'')) like '%it%'
  ) then raise exception 'Choose an IT Sewadar from the roster.'; end if;
  if exists (
    select 1 from public.manpower_tasks t
    join public.request_fulfilments existing_fulfilment on existing_fulfilment.id=t.request_fulfilment_id
    where existing_fulfilment.request_id=p_id and t.status <> 'complete'
      and (t.team is distinct from coalesce(team_name,'')
        or t.member_id is distinct from v_member)
  ) then raise exception 'Delivery tasks already exist with another assignee. Update them from Team tasks.'; end if;

  update public.requests
    set delivery_team=coalesce(team_name,''), delivery_member_id=v_member, updated_at=now()
    where id=p_id;

  for fulfilment in select rf.id from public.request_fulfilments rf where rf.request_id=p_id and rf.status='planned' loop
    perform public._request_create_delivery_task(fulfilment.id);   -- checks arrival for purchased parts
  end loop;
end $$;
revoke all on function public.request_set_delivery_assignment(text,text,text) from public, anon;
grant execute on function public.request_set_delivery_assignment(text,text,text) to authenticated;

-- Completing a delivery task hands over what is at the store. If that was only part of it, the task
-- stays open (in progress) for the rest instead of being marked complete.
create or replace function public.request_complete_delivery_task(p_task text,p_location text,p_received_by text,p_note text)
returns void language plpgsql security definer set search_path=public as $$
declare me record; t record; f record; r record; location_id text; left_qty integer;
begin
  select * into me from public.profiles where id=auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into t from public.manpower_tasks where id=p_task and organization_id=me.organization_id for update;
  if not found or t.request_fulfilment_id is null then raise exception 'This is not a request delivery task.'; end if;
  if t.status<>'in_progress' then raise exception 'Start the task before completing it.'; end if;
  if not (public.can_manage_manpower() or t.assigned_to=(select name from public.profiles where id=me.id) or public._manpower_task_is_assigned(t.id,me.id)) then
    raise exception 'Only the assigned Sewadar or a task manager can complete this delivery.';
  end if;
  select * into f from public.request_fulfilments where id=t.request_fulfilment_id;
  if f.source<>'walkie' and nullif(trim(coalesce(p_location,'')),'') is null then
    select * into r from public.requests where id=f.request_id;
    select id into location_id from public.inventory_locations where organization_id=me.organization_id and lower(trim(name))=lower(trim(r.deliver_to)) limit 1;
    if location_id is null then
      location_id := 'loc-' || substr(md5(me.organization_id || ':' || lower(trim(r.deliver_to))),1,18);
      insert into public.inventory_locations(id,organization_id,name) values(location_id,me.organization_id,trim(r.deliver_to)) on conflict do nothing;
      select id into location_id from public.inventory_locations where organization_id=me.organization_id and lower(trim(name))=lower(trim(r.deliver_to)) limit 1;
    end if;
    p_location := location_id;
  end if;
  perform public.request_deliver(t.request_fulfilment_id,p_location,p_received_by,p_note);
  -- Still planned = only part was at the store: the task stays in progress (the request timeline has the detail).
  select qty into left_qty from public.request_fulfilments where id=t.request_fulfilment_id and status='planned';
  if left_qty is null then
    update public.manpower_tasks set status='complete',updated_at=now() where id=t.id;
  end if;
end $$;
revoke all on function public.request_complete_delivery_task(text,text,text,text) from public,anon;
grant execute on function public.request_complete_delivery_task(text,text,text,text) to authenticated;

-- ── 2c. Close the rest of a partly received order ─────────────────────────────────────────────
create or replace function public.purchase_close_remaining(p_po text, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
declare
  me record; o record; line record; f record; short integer; cut integer; ri record; why text; touched text[] := '{}'; rid text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if not public.can_manage_purchase() then raise exception 'Only Purchase can close an order.'; end if;
  select * into o from public.purchase_orders where id = p_po and organization_id = me.organization_id for update;
  if not found then raise exception 'Order not found.'; end if;
  if not public.in_my_department(o.department_id) then raise exception 'That order belongs to another department.'; end if;
  if o.status <> 'partial' then raise exception 'Only a partly received order can be closed this way. Cancel an order that has received nothing.'; end if;
  why := coalesce(nullif(trim(p_reason), ''), 'Vendor could not supply the rest');

  perform set_config('app.po_internal', '1', true);
  for line in select * from public.purchase_items where po_id = o.id and qty_received < qty_ordered for update loop
    short := line.qty_ordered - line.qty_received;
    -- The request quantities that will no longer come: cut them from the planned part and the approved line.
    for f in select * from public.request_fulfilments where purchase_item_id = line.id and status = 'planned' for update loop
      exit when short <= 0;
      cut := least(short, f.qty);
      -- Nothing left to deliver on this part: drop its open delivery task too.
      if cut >= f.qty then
        delete from public.manpower_tasks where request_fulfilment_id = f.id and status <> 'complete';
        delete from public.request_fulfilments where id = f.id;
      else update public.request_fulfilments set qty = qty - cut where id = f.id; end if;
      select * into ri from public.request_items where id = f.item_id for update;
      update public.request_items
        set qty_approved = greatest(coalesce(qty_approved, 0) - cut, 0),
            cut_reason = trim(both ' ;' from coalesce(cut_reason, '') || '; ' || why || ' (' || cut || ' not supplied)')
        where id = ri.id;
      perform public._req_event(f.request_id, 'short_closed', cut || ' × ' || ri.name || ' will not be supplied: ' || why);
      touched := touched || f.request_id;
      short := short - cut;
    end loop;
    if line.qty_received = 0 then delete from public.purchase_items where id = line.id;
    else update public.purchase_items set qty_ordered = qty_received where id = line.id; end if;
  end loop;
  update public.purchase_orders set status = 'received',
    notes = trim(both ' ' from notes || ' Closed with the rest not supplied (' || why || ') by ' || coalesce(me.name, '') || '.')
    where id = o.id;
  perform set_config('app.po_internal', '', true);

  for rid in select distinct unnest(touched) loop
    if not public._request_check_fulfilled(rid) then
      perform public._req_notify((select requester_id from public.requests where id = rid), o.organization_id, 'Order closed short',
        (select number from public.requests where id = rid) || ': part of your order will not be supplied (' || why || ').', 'warning', rid);
    end if;
  end loop;
end $$;
revoke all on function public.purchase_close_remaining(text, text) from public, anon;
grant execute on function public.purchase_close_remaining(text, text) to authenticated;

-- ── 3. Offline-vendor progress reaches the request ────────────────────────────────────────────
create or replace function public.purchase_set_offline_status(p_po text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; o record; q record; label text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if not (public.can_manage_purchase() or public.can_receive_purchase()) then
    raise exception 'Only Purchase or the receiving team can update an order''s progress.';
  end if;
  select * into o from public.purchase_orders where id = p_po and organization_id = me.organization_id;
  if not found then raise exception 'Order not found.'; end if;
  if not public.in_my_department(o.department_id) then raise exception 'That order belongs to another department.'; end if;
  if o.status not in ('ordered','partial') then raise exception 'Progress can be updated only while the order is waiting for its goods.'; end if;
  if p_status is not null and p_status not in ('confirmed','ready','dispatched') then raise exception 'Unknown status.'; end if;
  update public.purchase_orders
    set offline_status = p_status, offline_status_at = case when p_status is null then null else now() end,
        offline_status_by = case when p_status is null then '' else coalesce(me.name, '') end
    where id = p_po;
  if p_status is null or p_status is not distinct from o.offline_status then return; end if;
  label := case p_status when 'confirmed' then 'The vendor confirmed the order'
                         when 'ready' then 'The goods are ready for pickup'
                         else 'The vendor dispatched the goods' end;
  for q in select distinct r.id, r.number, r.requester_id, r.organization_id
           from public.purchase_items i join public.requests r on r.id = i.request_id where i.po_id = o.id loop
    perform public._req_event(q.id, 'vendor_' || p_status, label || ' (' || o.po_number || ')');
    perform public._req_notify(q.requester_id, q.organization_id, 'Order update', q.number || ': ' || lower(label) || '.', 'info', q.id);
  end loop;
end $$;
revoke all on function public.purchase_set_offline_status(text, text) from public, anon;
grant execute on function public.purchase_set_offline_status(text, text) to authenticated;

-- ── 5. Remind, then close handed-over requests nobody confirmed ───────────────────────────────
-- Signed in: only the caller's organization. From pg_cron (no user): every organization.
create or replace function public.request_auto_close()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; closed integer := 0; org text := case when auth.uid() is null then null else public.current_organization_id() end;
begin
  for r in select * from public.requests
           where status = 'fulfilled' and confirmed_at is null and fulfilled_at is not null
             and (org is null or organization_id = org) for update skip locked loop
    if r.fulfilled_at < now() - interval '3 days' then
      update public.requests set confirmed_at = now(), confirmed_by = 'Closed automatically', updated_at = now() where id = r.id;
      begin
        perform public._req_event(r.id, 'confirmed', 'Closed automatically 3 days after everything was handed over.');
      exception when others then null;
      end;
      insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
      values (r.organization_id, r.requester_id, 'Request closed', r.number || ' was closed 3 days after it was handed over.', 'info', 'requests/' || r.id, r.id);
      closed := closed + 1;
    elsif r.fulfilled_at < now() - interval '1 day' and r.confirm_reminded_at is null then
      update public.requests set confirm_reminded_at = now() where id = r.id;
      insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
      values (r.organization_id, r.requester_id, 'Please confirm you received it',
              r.number || ' was handed over. Confirm on the ticket, or it closes by itself in 2 days.', 'approval', 'requests/' || r.id, r.id);
    end if;
  end loop;
  return closed;
end $$;
revoke all on function public.request_auto_close() from public, anon;
grant execute on function public.request_auto_close() to authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'request-auto-close';
    perform cron.schedule('request-auto-close', '15 * * * *', 'select public.request_auto_close()');
  else
    raise notice 'pg_cron is not enabled: requests close when someone opens Requests. Enable pg_cron to close them on the hour.';
  end if;
end $$;

notify pgrst, 'reload schema';
