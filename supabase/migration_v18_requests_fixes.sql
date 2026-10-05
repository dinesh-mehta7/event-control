-- ============================================================================
-- migration_v18_requests_fixes.sql
-- Run AFTER migration_v17. Safe to run more than once.
--
--   1. FIX  'record "f" is not assigned yet' when the Purchase team presses "Create purchase order".
--           (The loop variable had the same name as the table alias used inside the loop's query.)
--   2. FIX  Buying an item that is not in the catalogue no longer asks for an inventory item.
--           When the store team arranges "To purchase" for such an item, it is added to the catalogue
--           automatically (stock 0, same name and unit). If the catalogue already has that name, it is reused.
--   3. GUARD  A line that is already on a purchase order cannot be re-split any more (it used to leave the order orphaned).
-- ============================================================================

-- 1. Purchase team: one draft PO from every planned purchase part of a request ----------
create or replace function public.request_create_po(p_request text)
returns text language plpgsql security definer set search_path = public as $$
declare me record; r record; pf record; po_id text; pos integer := 0; pi_id text; n integer;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if not (me.level in ('owner','dept_head') or me.sub_department = 'purchase') then raise exception 'Only the Purchase team can raise the order.'; end if;
  select * into r from public.requests where id = p_request for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'approved' then raise exception 'This request is not open for ordering.'; end if;

  select count(*) into n from public.request_fulfilments where request_id = p_request and source = 'purchase' and status = 'planned' and purchase_item_id is null;
  if n = 0 then raise exception 'Nothing is waiting to be ordered for this request.'; end if;

  po_id := 'po-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  insert into public.purchase_orders (id, organization_id, title, requested_by, deliver_to, expected_date, status, notes, request_id)
  values (po_id, r.organization_id, r.number || ' · ' || r.title, r.requester_name, r.deliver_to, r.needed_by, 'draft',
          'Raised from request ' || r.number || '. Already approved by the owner.', r.id);

  for pf in select x.id as part_id, x.qty as part_qty, x.inventory_item_id as part_inv, ri.name as line_name, ri.unit as line_unit
            from public.request_fulfilments x join public.request_items ri on ri.id = x.item_id
            where x.request_id = p_request and x.source = 'purchase' and x.status = 'planned' and x.purchase_item_id is null
            order by ri.position loop
    pos := pos + 1;
    pi_id := 'pi-' || substr(md5(random()::text || clock_timestamp()::text || pos::text), 1, 16);
    insert into public.purchase_items (id, organization_id, po_id, inventory_item_id, name, unit, qty_ordered, rate, position)
    values (pi_id, r.organization_id, po_id, pf.part_inv, pf.line_name, pf.line_unit, pf.part_qty, 0, pos);
    update public.request_fulfilments set purchase_item_id = pi_id where id = pf.part_id;
  end loop;

  perform public._req_event(p_request, 'po_created', 'Purchase order raised for the items that are not in stock');
  perform public._req_notify(r.requester_id, r.organization_id, 'Items are being ordered', r.number || ': what was not in stock is being purchased.', 'info', p_request);
  return po_id;
end $$;
revoke all on function public.request_create_po(text) from public, anon;
grant execute on function public.request_create_po(text) to authenticated;

-- 2. Plan one approved line. Buying an unlisted item adds it to the catalogue by itself. -----------
create or replace function public.request_plan_line(p_item text, p_plan jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record; ri record; r record; part jsonb; src text; q integer; inv text; done_qty integer; planned_qty integer := 0;
  avail integer; it record; line_inv text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into ri from public.request_items where id = p_item;
  if not found then raise exception 'Line not found.'; end if;
  select * into r from public.requests where id = ri.request_id for update;
  if r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'approved' then raise exception 'Only an approved request can be arranged.'; end if;
  if not (me.level in ('owner','dept_head')
          or (ri.kind = 'item'  and me.sub_department = 'inventory')
          or (ri.kind = 'radio' and me.sub_department = 'walkie')) then
    raise exception 'Only the % team can arrange this line.', case when ri.kind = 'radio' then 'Walkie-Talkie' else 'Inventory' end;
  end if;
  if coalesce(ri.qty_approved, 0) = 0 then raise exception 'This line was not approved.'; end if;
  if jsonb_typeof(p_plan) is distinct from 'array' or jsonb_array_length(p_plan) = 0 then raise exception 'Add at least one part.'; end if;

  -- Once part of the line is on a purchase order it can no longer be re-split (that would leave the order orphaned).
  if exists (select 1 from public.request_fulfilments where item_id = p_item and status = 'planned' and purchase_item_id is not null) then
    raise exception 'Part of "%" is already on a purchase order, so the arrangement can no longer be changed.', ri.name;
  end if;
  select coalesce(sum(qty), 0) into done_qty from public.request_fulfilments where item_id = p_item and status = 'done';
  delete from public.request_fulfilments where item_id = p_item and status = 'planned';
  line_inv := ri.inventory_item_id;

  for part in select * from jsonb_array_elements(p_plan) loop
    src := part->>'source'; q := (part->>'qty')::integer; inv := nullif(part->>'inventory_item_id', '');
    if q is null or q <= 0 then raise exception 'Every part needs a quantity above zero.'; end if;
    if src not in ('inventory','purchase','walkie') then raise exception 'Unknown source.'; end if;
    if ri.kind = 'radio' and src = 'inventory' then raise exception 'Radios come from the Walkie pool or are purchased.'; end if;
    if ri.kind = 'item' and src = 'walkie' then raise exception 'Only radio lines can be allocated from the Walkie pool.'; end if;

    if ri.kind = 'item' and inv is null then
      if src = 'inventory' then raise exception 'Choose which inventory item to take "%" from.', ri.name; end if;
      -- Buying something the catalogue does not know yet: reuse the same name, or add it (stock 0).
      inv := coalesce(line_inv, (select i.id from public.inventory_items i where i.organization_id = r.organization_id and lower(trim(i.name)) = lower(trim(ri.name)) limit 1));
      if inv is null then
        inv := 'it-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
        insert into public.inventory_items (id, organization_id, name, unit) values (inv, r.organization_id, trim(ri.name), coalesce(nullif(trim(ri.unit), ''), 'pcs'));
        perform public._req_event(r.id, 'catalogue', '"' || trim(ri.name) || '" was added to the item catalogue');
      end if;
    end if;
    line_inv := coalesce(line_inv, inv);

    if inv is not null then
      select * into it from public.inventory_items where id = inv and organization_id = r.organization_id;
      if not found then raise exception 'That inventory item does not exist.'; end if;
    end if;
    if src = 'inventory' then
      select a.available into avail from public.inventory_available() a where a.item_id = inv;
      if q > coalesce(avail, 0) then raise exception 'Only % of "%" can still be promised from stock.', coalesce(avail, 0), it.name; end if;
    end if;
    insert into public.request_fulfilments (id, organization_id, request_id, item_id, source, qty, inventory_item_id)
    values ('rf-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), r.organization_id, r.id, p_item, src, q, inv);
    planned_qty := planned_qty + q;
  end loop;

  if done_qty + planned_qty <> ri.qty_approved then
    raise exception 'The parts add up to %, but % was approved.', done_qty + planned_qty, ri.qty_approved;
  end if;
  if line_inv is not null and ri.inventory_item_id is null then update public.request_items set inventory_item_id = line_inv where id = p_item; end if;

  perform public._req_event(r.id, 'planned', 'Arranged "' || ri.name || '": ' ||
    (select string_agg(x.s || ' ' || x.q, ' + ') from (
       select (p->>'source') as s, (p->>'qty') as q from jsonb_array_elements(p_plan) p) x));
  if exists (select 1 from jsonb_array_elements(p_plan) p where p->>'source' = 'purchase') then
    perform public._req_notify_group(r.id, 'purchase', 'Items to order: ' || r.title, r.number || ' · raise a purchase order', 'approval');
  end if;
end $$;
revoke all on function public.request_plan_line(text, jsonb) from public, anon;
grant execute on function public.request_plan_line(text, jsonb) to authenticated;

notify pgrst, 'reload schema';
