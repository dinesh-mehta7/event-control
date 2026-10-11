-- Requesters choose whether each item is for return after use or purchase to keep. Department Admin approval
-- records the budget and stock/purchase split together, with stock reserved
-- through request_fulfilments so inventory availability stays in sync.
-- Run after migration_v38_walkie_serial_optional.sql.

alter table public.request_items
  add column if not exists return_required boolean not null default false;
alter table public.request_fulfilments
  add column if not exists returned_qty integer not null default 0 check (returned_qty >= 0);

create or replace function public.request_submit(
  p_title text, p_purpose text, p_needed_by date, p_priority text, p_deliver_to text, p_department_id text, p_items jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare
  me record; k integer; rid text; num text; pos integer := 0; it jsonb; inv text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if trim(coalesce(p_title, '')) = '' then raise exception 'Give the request a short title.'; end if;
  if trim(coalesce(p_purpose, '')) = '' then raise exception 'Say why this is needed.'; end if;
  if trim(coalesce(p_deliver_to, '')) = '' then raise exception 'Say where it should be delivered.'; end if;
  if nullif(trim(coalesce(p_department_id, '')), '') is null then raise exception 'Choose a department for this request.'; end if;
  if not exists (select 1 from public.departments d where d.id = p_department_id and d.organization_id = me.organization_id) then raise exception 'Choose a valid department from the Walkie Departments list.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item.'; end if;
  if jsonb_array_length(p_items) > 60 then raise exception 'A request can have at most 60 lines.'; end if;
  if not exists (select 1 from public.profiles h where h.organization_id = me.organization_id and h.level = 'dept_head' and h.approved and h.is_active) then
    raise exception 'No active Department Admin is available to review requests.';
  end if;

  insert into public.request_counters (organization_id, n) values (me.organization_id, 1)
    on conflict (organization_id) do update set n = public.request_counters.n + 1 returning n into k;
  num := 'REQ-' || lpad(k::text, 4, '0');
  rid := 'rq-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  insert into public.requests (id, organization_id, number, requester_id, requester_name, sub_department, department_id, title, purpose, deliver_to, needed_by, priority, status)
  values (rid, me.organization_id, num, me.id, me.name, me.sub_department, p_department_id, trim(p_title), trim(p_purpose), trim(p_deliver_to), p_needed_by,
          case when p_priority = 'urgent' then 'urgent' else 'normal' end, 'pending_it');

  for it in select * from jsonb_array_elements(p_items) loop
    pos := pos + 1;
    if trim(coalesce(it->>'name', '')) = '' then raise exception 'Line % has no item name.', pos; end if;
    if coalesce((it->>'qty')::integer, 0) <= 0 then raise exception 'Line % needs a quantity above zero.', pos; end if;
    if trim(coalesce(it->>'reason', '')) = '' then raise exception 'Line % (%) needs a reason.', pos, trim(it->>'name'); end if;
    inv := nullif(it->>'inventory_item_id', '');
    if inv is not null and not exists (select 1 from public.inventory_items where id = inv and organization_id = me.organization_id) then inv := null; end if;
    insert into public.request_items (id, organization_id, request_id, position, kind, name, unit, qty_requested, note, reason, inventory_item_id, return_required)
    values ('ri-' || substr(md5(random()::text || clock_timestamp()::text || pos::text), 1, 16), me.organization_id, rid, pos,
            case when it->>'kind' = 'radio' then 'radio' else 'item' end, trim(it->>'name'), coalesce(nullif(trim(it->>'unit'), ''), 'pcs'),
            (it->>'qty')::integer, trim(coalesce(it->>'note', '')), trim(it->>'reason'), inv, coalesce((it->>'return_required')::boolean, false));
  end loop;

  perform public._req_event(rid, 'submitted', 'Request raised by ' || me.name);
  perform public._req_notify_group(rid, 'it_head', 'Request to review: ' || trim(p_title), num || ' from ' || me.name, 'approval');
  return rid;
end $$;
revoke all on function public.request_submit(text, text, date, text, text, text, jsonb) from public, anon;
grant execute on function public.request_submit(text, text, date, text, text, text, jsonb) to authenticated;

create or replace function public.request_it_decide(p_id text, p_action text, p_note text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record; r record; ri record; l jsonb; part jsonb; q integer; total numeric; planned integer;
  src text; inv text; avail integer; inv_row record; has_item boolean; has_radio boolean; purchase_needed boolean;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if me.level <> 'dept_head' then raise exception 'Only a Department Admin can review this.'; end if;
  if coalesce(p_action, '') not in ('approve','escalate','reject') then raise exception 'Choose approve, escalate, or reject.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_it' then raise exception 'This request is no longer waiting for the Department Admin.'; end if;

  if p_action = 'reject' then
    if trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting it.'; end if;
    update public.requests set status = 'rejected', it_note = trim(p_note), updated_at = now() where id = p_id;
    perform public._req_event(p_id, 'rejected', 'Rejected by the Department Admin: ' || trim(p_note));
    perform public._req_notify(r.requester_id, r.organization_id, 'Request rejected', r.number || ' was rejected: ' || trim(p_note), 'warning', p_id);
    return;
  elsif p_action = 'escalate' then
    update public.requests set status = 'pending_owner', it_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
    perform public._req_event(p_id, 'escalated', 'Escalated to the Super Admin by the Department Admin' || case when trim(coalesce(p_note, '')) <> '' then ': ' || trim(p_note) else '' end);
    perform public._req_notify_group(p_id, 'owner', 'Request escalated: ' || r.title, r.number || ' needs your review.', 'approval');
    perform public._req_notify(r.requester_id, r.organization_id, 'Request escalated', r.number || ' was sent to the Super Admin for review.', 'info', p_id);
    return;
  end if;

  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Add a budget and arrangement for every requested item.'; end if;
  update public.request_items set qty_approved = qty_requested, cut_reason = '' where request_id = p_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    if not (l ? 'budget_rate') or nullif(l->>'budget_rate', '') is null then raise exception 'Enter a budget per unit for every item.'; end if;
    if (l->>'budget_rate')::numeric < 0 then raise exception 'Budget cannot be negative.'; end if;
    update public.request_items set budget_rate = (l->>'budget_rate')::numeric where id = l->>'id' and request_id = p_id;
  end loop;
  if exists (select 1 from public.request_items where request_id = p_id and budget_rate is null) then raise exception 'Enter a budget per unit for every item.'; end if;

  delete from public.request_fulfilments where request_id = p_id and status = 'planned';
  for ri in select * from public.request_items where request_id = p_id order by position loop
    select value into l from jsonb_array_elements(p_lines) where value->>'id' = ri.id;
    if l is null or jsonb_typeof(l->'plan') is distinct from 'array' or jsonb_array_length(l->'plan') = 0 then
      raise exception 'Set the inventory and purchase quantities for "%".', ri.name;
    end if;
    planned := 0;
    for part in select * from jsonb_array_elements(l->'plan') loop
      src := part->>'source'; q := (part->>'qty')::integer; inv := nullif(part->>'inventory_item_id', '');
      if q is null or q <= 0 then raise exception 'Each arrangement quantity must be above zero.'; end if;
      if ri.kind = 'radio' then
        if src not in ('walkie','purchase') then raise exception 'Radio lines must use the Walkie pool or be purchased.'; end if;
      elsif src not in ('inventory','purchase') then
        raise exception 'Choose inventory or purchase for "%".', ri.name;
      end if;
      if src = 'inventory' and ri.kind <> 'radio' then
        inv := coalesce(inv, ri.inventory_item_id, (select id from public.inventory_items where organization_id = r.organization_id and lower(trim(name)) = lower(trim(ri.name)) limit 1));
        if inv is null then raise exception 'Add or select a matching inventory item for "%".', ri.name; end if;
        select * into inv_row from public.inventory_items where id = inv and organization_id = r.organization_id for update;
        if not found then raise exception 'That inventory item does not exist in this organization.'; end if;
        if regexp_replace(lower(trim(inv_row.name)), '[^a-z0-9]', '', 'g') <> regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g') then
          raise exception 'Choose an inventory item matching "%".', ri.name;
        end if;
        select available into avail from public.inventory_available() where item_id = inv;
        if q > coalesce(avail, 0) then raise exception 'Only % of "%" are available in inventory.', coalesce(avail, 0), inv_row.name; end if;
      elsif src = 'purchase' and ri.kind <> 'radio' then
        inv := coalesce(inv, ri.inventory_item_id, (select id from public.inventory_items where organization_id = r.organization_id and lower(trim(name)) = lower(trim(ri.name)) limit 1));
        if inv is null then
          inv := 'it-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
          insert into public.inventory_items (id, organization_id, name, unit) values (inv, r.organization_id, trim(ri.name), coalesce(nullif(trim(ri.unit), ''), 'pcs'));
        end if;
      end if;
      insert into public.request_fulfilments (id, organization_id, request_id, item_id, source, qty, inventory_item_id)
      values ('rf-' || substr(md5(random()::text || clock_timestamp()::text || planned::text), 1, 16), r.organization_id, r.id, ri.id, src, q, inv);
      planned := planned + q;
      if src = 'purchase' then purchase_needed := true; end if;
    end loop;
    if planned <> ri.qty_requested then raise exception 'Inventory plus purchase for "%" must add up to %.', ri.name, ri.qty_requested; end if;
    if ri.kind = 'item' and ri.inventory_item_id is null then
      update public.request_items set inventory_item_id = coalesce((select inventory_item_id from public.request_fulfilments where item_id = ri.id and inventory_item_id is not null limit 1), ri.inventory_item_id) where id = ri.id;
    end if;
  end loop;

  select coalesce(sum(qty_requested * budget_rate), 0) into total from public.request_items where request_id = p_id;
  update public.requests set status = 'approved', it_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'approved', 'Approved by the Department Admin with a total budget of ₹' || to_char(total, 'FM999,999,990.00') || case when trim(coalesce(p_note, '')) <> '' then '. Note: ' || trim(p_note) else '' end);
  perform public._req_notify(r.requester_id, r.organization_id, 'Request approved', r.number || ' was approved with a budget of ₹' || to_char(total, 'FM999,999,990.00') || ' and its arrangement is ready.', 'info', p_id);
  select bool_or(kind = 'radio'), bool_or(kind = 'item') into has_radio, has_item from public.request_items where request_id = p_id;
  if has_item then perform public._req_notify_group(p_id, 'inventory', 'Approved list to issue or arrange: ' || r.title, r.number || ' · stock reserved; purchase quantities are in Procurement', 'approval'); end if;
  if has_radio then perform public._req_notify_group(p_id, 'walkie', 'Radios approved: ' || r.title, r.number || ' · allocate from the radio pool', 'approval'); end if;
  if coalesce(purchase_needed, false) then perform public._req_notify_group(p_id, 'purchase', 'Items to order: ' || r.title, r.number || ' · raise a purchase order', 'approval'); end if;
end $$;
revoke all on function public.request_it_decide(text, text, text, jsonb) from public, anon;
grant execute on function public.request_it_decide(text, text, text, jsonb) to authenticated;

create or replace function public.request_return_part(p_fulfilment text, p_qty integer, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare me record; f record; r record; ri record; loc_id text; left_to_return integer;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into f from public.request_fulfilments where id = p_fulfilment for update;
  if not found then raise exception 'Delivered item not found.'; end if;
  select * into r from public.requests where id = f.request_id for update;
  select * into ri from public.request_items where id = f.item_id for update;
  if r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'fulfilled' or f.status <> 'done' then raise exception 'Only delivered items can be returned.'; end if;
  if not ri.return_required then raise exception 'This item was not marked as return-required.'; end if;
  if ri.kind = 'radio' or f.source = 'walkie' then raise exception 'Walkie pool returns must be recorded in the Walkie module.'; end if;
  if f.inventory_item_id is null then raise exception 'This delivered item is not linked to inventory.'; end if;
  if r.requester_id <> me.id and me.level not in ('owner','dept_head') and me.sub_department is distinct from 'inventory' then
    raise exception 'Only the requester, Inventory, Department Admin, or Super Admin can record this return.';
  end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Enter a return quantity above zero.'; end if;
  left_to_return := f.qty - f.returned_qty;
  if p_qty > left_to_return then raise exception 'Only % of this delivered line remain to be returned.', left_to_return; end if;
  select id into loc_id from public.inventory_locations
    where organization_id = r.organization_id and lower(trim(name)) = lower(trim(f.location_name))
    order by id limit 1;
  if loc_id is null then raise exception 'The original inventory location no longer exists.'; end if;

  insert into public.inventory_movements (id, organization_id, item_id, type, qty, location, person, given_by, received_by, returned_by, ref, note, done_by)
  values ('mv-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), r.organization_id, f.inventory_item_id, 'return', p_qty, loc_id,
          coalesce(nullif(trim(f.received_by), ''), r.requester_name), me.name, me.name,
          coalesce(nullif(trim(f.received_by), ''), r.requester_name), r.number,
          'Return for ' || r.number || ' · ' || ri.name || case when trim(coalesce(p_note, '')) <> '' then ' · ' || trim(p_note) else '' end, me.name);
  update public.request_fulfilments set returned_qty = returned_qty + p_qty where id = f.id;
  perform public._req_event(r.id, 'returned', 'Returned ' || p_qty || ' × ' || ri.name || ' to Inventory' || case when trim(coalesce(p_note, '')) <> '' then ': ' || trim(p_note) else '' end);
end $$;
revoke all on function public.request_return_part(text, integer, text) from public, anon;
grant execute on function public.request_return_part(text, integer, text) to authenticated;

select pg_notify('pgrst', 'reload schema');
