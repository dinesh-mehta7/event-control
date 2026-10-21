-- ============================================================================
-- v108 · Super Admin approvals and arrangements create records in the request's department
-- ----------------------------------------------------------------------------
-- Approving (Department Head or Super Admin) and arranging a request can create a new catalogue
-- item for something to be purchased. v101 gives every stock record a department, but the Super
-- Admin has none, so approving failed with "Choose the department for this record". Both now set
-- the request's department first, so everything they create belongs to that department.
-- Also: only the requested department's head (or the Super Admin) may arrange a request.
-- Apply after migration_v107_requests_without_department.sql. Safe to re-run.
-- ============================================================================

create or replace function public._request_commit_review_plan(p_id text)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  r record; ri record; l jsonb; part jsonb; q integer; planned integer; src text; inv text;
  avail integer; inv_row record; total numeric := 0; purchase_needed boolean := false;
  has_radio boolean := false; has_item boolean := false; any_approved boolean := false;
begin
  select * into r from public.requests where id = p_id for update;
  if not found then raise exception 'Request not found.'; end if;
  -- New catalogue items, stock plans and purchase lines belong to the department the request was made to
  -- (also when the Super Admin approves, who has no department of their own).
  perform set_config('app.department_id', coalesce(r.department_id, public._it_department(r.organization_id)), true);
  if exists (select 1 from public.request_items where request_id = p_id and qty_approved < qty_requested and trim(coalesce(cut_reason,'')) = '') then
    raise exception 'A reason is required for every reduced quantity.';
  end if;
  if exists (select 1 from public.request_items where request_id = p_id and qty_approved > 0 and approved_budget is null) then
    raise exception 'Enter a total budget for every approved item.';
  end if;
  if coalesce((select sum(qty_approved) from public.request_items where request_id = p_id), 0) = 0 then
    raise exception 'Approve at least one item, or reject the request.';
  end if;
  total := total + coalesce(r.review_misc_budget, 0);

  delete from public.request_fulfilments where request_id = p_id and status = 'planned';
  for ri in select * from public.request_items where request_id = p_id order by position for update loop
    total := total + coalesce(ri.approved_budget, 0);
    if coalesce(ri.qty_approved, 0) = 0 then
      if jsonb_array_length(coalesce(ri.review_plan, '[]'::jsonb)) <> 0 then raise exception 'A zero-approved line cannot have an arrangement.'; end if;
      continue;
    end if;
    any_approved := true;
    if jsonb_typeof(ri.review_plan) is distinct from 'array' then raise exception 'Set the stock and purchase split for "%".', ri.name; end if;
    planned := 0;
    for part in select value from jsonb_array_elements(ri.review_plan) loop
      src := part->>'source'; q := (part->>'qty')::integer; inv := nullif(part->>'inventory_item_id','');
      if q is null or q <= 0 then raise exception 'Arrangement quantities must be positive whole numbers.'; end if;
      if ri.kind = 'radio' then
        if src <> 'walkie' then raise exception 'Walkie-talkie requests must be allocated through the Walkie pool.'; end if;
        inv := null;
      elsif src not in ('inventory','purchase') then raise exception 'Choose stock or purchase for "%".', ri.name;
      elsif src = 'inventory' then
        inv := coalesce(inv, ri.inventory_item_id, (select id from public.inventory_items where organization_id = r.organization_id and regexp_replace(lower(trim(name)), '[^a-z0-9]', '', 'g') = regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g') order by id limit 1));
        if inv is null then raise exception 'No matching inventory item was found for "%".', ri.name; end if;
        select * into inv_row from public.inventory_items where id = inv and organization_id = r.organization_id for update;
        if not found or regexp_replace(lower(trim(inv_row.name)), '[^a-z0-9]', '', 'g') <> regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g') then raise exception 'The matching inventory item for "%" is unavailable.', ri.name; end if;
        select available into avail from public.inventory_available() where item_id = inv;
        if q > coalesce(avail,0) then raise exception 'Only % of "%" are currently available.', coalesce(avail,0), ri.name; end if;
      else
        inv := coalesce(inv, ri.inventory_item_id, (select id from public.inventory_items where organization_id = r.organization_id and regexp_replace(lower(trim(name)), '[^a-z0-9]', '', 'g') = regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g') order by id limit 1));
        if inv is null then
          inv := 'it-' || substr(md5(random()::text || clock_timestamp()::text),1,16);
          insert into public.inventory_items (id, organization_id, name, unit) values (inv, r.organization_id, trim(ri.name), coalesce(nullif(trim(ri.unit),''),'pcs'));
        end if;
        purchase_needed := true;
      end if;
      insert into public.request_fulfilments (id, organization_id, request_id, item_id, source, qty, inventory_item_id)
      values ('rf-' || substr(md5(random()::text || clock_timestamp()::text || planned::text),1,16), r.organization_id, r.id, ri.id, src, q, inv);
      planned := planned + q;
      if src = 'walkie' then has_radio := true; elsif ri.kind = 'item' then has_item := true; end if;
    end loop;
    if planned <> ri.qty_approved then raise exception 'The arrangement for "%" must add up to %.', ri.name, ri.qty_approved; end if;
    if ri.kind = 'item' then
      update public.request_items set inventory_item_id = coalesce(inventory_item_id, (select inventory_item_id from public.request_fulfilments where item_id = ri.id and inventory_item_id is not null limit 1)) where id = ri.id;
    end if;
  end loop;
  if not any_approved then raise exception 'Approve at least one item, or reject the request.'; end if;

  update public.requests set status = 'approved', updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'approved', 'Approved with a total budget of ₹' || to_char(total, 'FM999,999,990.00') || ' and the saved stock/purchase plan.');
  perform public._req_notify(r.requester_id, r.organization_id, 'Request approved', r.number || ' was approved with a total budget of ₹' || to_char(total, 'FM999,999,990.00') || '.', 'info', p_id);
  if has_item then perform public._req_notify_group(p_id, 'inventory', 'Approved items to issue: ' || r.title, r.number || ' · stock is reserved and purchase quantities are in Procurement.', 'approval'); end if;
  if has_radio then perform public._req_notify_group(p_id, 'walkie', 'Walkie-talkies approved: ' || r.title, r.number || ' · allocate from the Walkie pool.', 'approval'); end if;
  if purchase_needed then perform public._req_notify_group(p_id, 'purchase', 'Items to order: ' || r.title, r.number || ' · the approved purchase quantities are ready.', 'approval'); end if;
  return total;
end $$;

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
  if me.level not in ('owner','dept_head') then
    raise exception 'Only the Department Admin can decide how this request is arranged.';
  end if;
  -- Only the head of the department the request was made to (or the Super Admin) arranges it, and anything
  -- it creates belongs to that department.
  if me.level = 'dept_head' and me.department_id is distinct from coalesce(r.department_id, public._it_department(r.organization_id)) then
    raise exception 'Only the Department Head of the requested department can arrange this request.';
  end if;
  perform set_config('app.department_id', coalesce(r.department_id, public._it_department(r.organization_id)), true);
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
      if ri.kind = 'item' and regexp_replace(lower(trim(it.name)), '[^a-z0-9]', '', 'g') <> regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g') then
        raise exception 'Choose a catalogue item that matches the requested product "%".', ri.name;
      end if;
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
