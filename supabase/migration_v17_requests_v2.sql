-- ============================================================================
-- migration_v17_requests_v2.sql
-- Requests, second version. Run AFTER migration_v16. Safe to run more than once.
--
--   * Every line carries a reason; lines can point at a catalogue item (inventory_items).
--   * The owner gives a reason for every line he reduces or leaves out.
--   * The approval notification now carries the approved quantities and the reasons.
--   * New notifications: item arrived in store, every delivery (also partial).
--   * The requester confirms receipt (requests.confirmed_at) - that closes the ticket.
--   * Order progress per line for the ticket (request_order_info). The vendor name and the rate are
--     shown to the requester ONLY when the owner switches them on for that ticket.
--   * The public read-only share link is removed.
-- ============================================================================

-- 1. Columns ------------------------------------------------------------------
alter table public.request_items
  add column if not exists reason            text not null default '',
  add column if not exists cut_reason        text not null default '',
  add column if not exists inventory_item_id text references public.inventory_items(id) on delete set null;

alter table public.requests
  add column if not exists show_vendor  boolean not null default false,
  add column if not exists show_rate    boolean not null default false,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by text not null default '';

-- 2. The catalogue, for the "pick an item" box. Names and units only: no stock, no prices. -----
create or replace function public.catalogue_list()
returns table (id text, name text, unit text, category text)
language sql stable security definer set search_path = public as $$
  select i.id, i.name, i.unit, i.category
  from public.inventory_items i
  where public.current_approved() and i.organization_id = public.current_organization_id()
  order by lower(i.name);
$$;
revoke all on function public.catalogue_list() from public, anon;
grant execute on function public.catalogue_list() to authenticated;

-- 3. Submit: a reason on the request and on every line ----------------------------------------
-- p_items: [{ "name": "...", "unit": "pcs", "qty": 5, "kind": "item"|"radio", "reason": "...", "note": "", "inventory_item_id": "..." }]
create or replace function public.request_submit(
  p_title text, p_purpose text, p_needed_by date, p_priority text, p_deliver_to text, p_items jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare
  me record; k integer; rid text; num text; pos integer := 0; it jsonb; first_status text; has_head boolean; inv text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if trim(coalesce(p_title, '')) = '' then raise exception 'Give the request a short title.'; end if;
  if trim(coalesce(p_purpose, '')) = '' then raise exception 'Say why this is needed.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item.'; end if;
  if jsonb_array_length(p_items) > 60 then raise exception 'A request can have at most 60 lines.'; end if;

  -- Heads and the owner skip the first step; so does anyone with no sub-department head to ask
  -- (this includes the owners of other departments).
  select exists (select 1 from public.profiles h where h.organization_id = me.organization_id and h.level = 'sub_dept_head'
                 and h.sub_department is not distinct from me.sub_department and h.approved and h.is_active and h.id <> me.id) into has_head;
  first_status := case when me.level in ('owner','dept_head','sub_dept_head') or me.sub_department is null or not has_head
                       then 'pending_owner' else 'pending_sub' end;

  insert into public.request_counters (organization_id, n) values (me.organization_id, 1)
    on conflict (organization_id) do update set n = public.request_counters.n + 1 returning n into k;
  num := 'REQ-' || lpad(k::text, 4, '0');
  rid := 'rq-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);

  insert into public.requests (id, organization_id, number, requester_id, requester_name, sub_department, title, purpose, deliver_to, needed_by, priority, status)
  values (rid, me.organization_id, num, me.id, me.name, me.sub_department, trim(p_title), trim(p_purpose),
          trim(coalesce(p_deliver_to, '')), p_needed_by, case when p_priority = 'urgent' then 'urgent' else 'normal' end, first_status);

  for it in select * from jsonb_array_elements(p_items) loop
    pos := pos + 1;
    if trim(coalesce(it->>'name', '')) = '' then raise exception 'Line % has no item name.', pos; end if;
    if coalesce((it->>'qty')::integer, 0) <= 0 then raise exception 'Line % needs a quantity above zero.', pos; end if;
    if trim(coalesce(it->>'reason', '')) = '' then raise exception 'Line % (%) needs a reason.', pos, trim(it->>'name'); end if;
    inv := nullif(it->>'inventory_item_id', '');
    if inv is not null and not exists (select 1 from public.inventory_items where id = inv and organization_id = me.organization_id) then inv := null; end if;
    insert into public.request_items (id, organization_id, request_id, position, kind, name, unit, qty_requested, note, reason, inventory_item_id)
    values ('ri-' || substr(md5(random()::text || clock_timestamp()::text || pos::text), 1, 16), me.organization_id, rid, pos,
            case when it->>'kind' = 'radio' then 'radio' else 'item' end, trim(it->>'name'),
            coalesce(nullif(trim(it->>'unit'), ''), 'pcs'), (it->>'qty')::integer, trim(coalesce(it->>'note', '')), trim(it->>'reason'), inv);
  end loop;

  perform public._req_event(rid, 'submitted', 'Request raised by ' || me.name);
  if first_status = 'pending_sub' then
    perform public._req_notify_group(rid, 'sub_head', 'Request to review: ' || trim(p_title), num || ' from ' || me.name, 'approval');
  else
    perform public._req_notify_group(rid, 'owner', 'Request to approve: ' || trim(p_title), num || ' from ' || me.name || ' · ' || jsonb_array_length(p_items) || ' item(s)', 'approval');
  end if;
  return rid;
end $$;
revoke all on function public.request_submit(text, text, date, text, text, jsonb) from public, anon;
grant execute on function public.request_submit(text, text, date, text, text, jsonb) to authenticated;

-- 4. Owner: approved quantity per line + a reason for every line that is cut ------------------
-- p_lines: [{ "id": "<request item id>", "qty": 3, "reason": "only 3 free until the 12th" }]
create or replace function public.request_owner_review(p_id text, p_approve boolean, p_note text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r record; l jsonb; q integer; total integer; has_radio boolean; has_item boolean; summ text;
begin
  if not public.is_org_owner() then raise exception 'Only the Organization Head can approve requests.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> public.current_organization_id() then raise exception 'Request not found.'; end if;
  if r.status not in ('pending_owner', 'pending_sub') then raise exception 'This request has already been decided.'; end if;

  if not p_approve then
    if trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting it.'; end if;
    update public.requests set status = 'rejected', owner_note = trim(p_note), updated_at = now() where id = p_id;
    perform public._req_event(p_id, 'rejected', 'Rejected by the owner: ' || trim(p_note));
    perform public._req_notify(r.requester_id, r.organization_id, 'Request rejected', r.number || ' was rejected. Reason: ' || trim(p_note), 'warning', p_id);
    return;
  end if;

  update public.request_items set qty_approved = qty_requested, cut_reason = '' where request_id = p_id;
  if jsonb_typeof(p_lines) = 'array' then
    for l in select * from jsonb_array_elements(p_lines) loop
      q := (l->>'qty')::integer;
      if q is null or q < 0 then raise exception 'Approved quantity cannot be negative.'; end if;
      update public.request_items set qty_approved = least(q, qty_requested), cut_reason = trim(coalesce(l->>'reason', ''))
      where id = l->>'id' and request_id = p_id;
    end loop;
  end if;
  if exists (select 1 from public.request_items where request_id = p_id and qty_approved < qty_requested and trim(cut_reason) = '') then
    raise exception 'Give a reason for every line you reduce or leave out.';
  end if;
  update public.request_items set cut_reason = '' where request_id = p_id and qty_approved >= qty_requested;
  select coalesce(sum(qty_approved), 0) into total from public.request_items where request_id = p_id;
  if total = 0 then raise exception 'Approve at least one line, or reject the request.'; end if;

  select string_agg(i.name || ' ' || i.qty_approved || ' of ' || i.qty_requested
                    || case when i.qty_approved < i.qty_requested then ' (' || i.cut_reason || ')' else '' end, '; ' order by i.position)
    into summ from public.request_items i where i.request_id = p_id;

  update public.requests set status = 'approved', owner_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'approved', 'Approved by the owner: ' || summ || case when trim(coalesce(p_note, '')) <> '' then '. Note: ' || trim(p_note) else '' end);
  select bool_or(kind = 'radio' and qty_approved > 0), bool_or(kind = 'item' and qty_approved > 0) into has_radio, has_item from public.request_items where request_id = p_id;
  perform public._req_notify(r.requester_id, r.organization_id, 'Request approved',
    r.number || ' approved: ' || summ || case when trim(coalesce(p_note, '')) <> '' then '. Note: ' || trim(p_note) else '' end, 'info', p_id);
  if has_item then perform public._req_notify_group(p_id, 'inventory', 'Approved list to arrange: ' || r.title, r.number || ' · split it into stock and purchase', 'approval'); end if;
  if has_radio then perform public._req_notify_group(p_id, 'walkie', 'Radios approved: ' || r.title, r.number || ' · allocate from the radio pool', 'approval'); end if;
end $$;
revoke all on function public.request_owner_review(text, boolean, text, jsonb) from public, anon;
grant execute on function public.request_owner_review(text, boolean, text, jsonb) to authenticated;

-- 5. Hand over: tell the requester about every delivery, and ask for the confirmation at the end ----
create or replace function public.request_deliver(p_fulfilment text, p_location text, p_received_by text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record; f record; r record; ri record; loc_id text; loc_name text; got integer := 0; all_done boolean;
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

  if ri.kind = 'radio' then
    if not (me.level in ('owner','dept_head') or me.sub_department = 'walkie') then raise exception 'Only the Walkie-Talkie team can confirm radios.'; end if;
    if f.source = 'purchase' then
      if f.purchase_item_id is null then raise exception 'The purchase order has not been raised yet.'; end if;
      select coalesce(qty_received, 0) into got from public.purchase_items where id = f.purchase_item_id;
      if coalesce(got, 0) < f.qty then raise exception 'Only % of % have arrived so far.', coalesce(got, 0), f.qty; end if;
    end if;
    update public.request_fulfilments set status = 'done', location_name = trim(coalesce(p_location, '')), received_by = trim(coalesce(p_received_by, '')),
           note = trim(coalesce(p_note, '')), done_by = me.name, done_at = now() where id = f.id;
  else
    if not (me.level in ('owner','dept_head') or me.sub_department = 'inventory') then raise exception 'Only the Inventory team can issue stock.'; end if;
    if f.inventory_item_id is null then raise exception 'This part is not linked to an inventory item.'; end if;
    if f.source = 'purchase' then
      if f.purchase_item_id is null then raise exception 'The purchase order has not been raised yet.'; end if;
      select coalesce(qty_received, 0) into got from public.purchase_items where id = f.purchase_item_id;
      if coalesce(got, 0) < f.qty then raise exception 'Only % of % have arrived so far.', coalesce(got, 0), f.qty; end if;
    end if;
    loc_id := nullif(trim(coalesce(p_location, '')), '');
    if loc_id is null then raise exception 'Choose where it is being sent.'; end if;
    select name into loc_name from public.inventory_locations where id = loc_id and organization_id = r.organization_id;
    if loc_name is null then raise exception 'That location does not exist.'; end if;
    perform set_config('app.request_issue', '1', true);
    insert into public.inventory_movements (id, organization_id, item_id, type, qty, location, given_by, received_by, ref, note, done_by)
    values ('mv-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), r.organization_id, f.inventory_item_id, 'issue', f.qty, loc_id,
            me.name, trim(coalesce(p_received_by, '')), r.number, 'Request ' || r.number || ' · ' || ri.name, me.name);
    update public.request_fulfilments set status = 'done', location_name = loc_name, received_by = trim(coalesce(p_received_by, '')),
           note = trim(coalesce(p_note, '')), done_by = me.name, done_at = now() where id = f.id;
  end if;

  perform public._req_event(r.id, 'delivered', 'Handed over ' || f.qty || ' × ' || ri.name || ' (' || f.source || ')' ||
    case when coalesce(trim(p_received_by), '') <> '' then ' to ' || trim(p_received_by) else '' end);

  select not exists (
    select 1 from public.request_items i
    where i.request_id = r.id and coalesce(i.qty_approved, 0) > 0
      and coalesce((select sum(x.qty) from public.request_fulfilments x where x.item_id = i.id and x.status = 'done'), 0) < i.qty_approved
  ) into all_done;

  if all_done then
    update public.requests set status = 'fulfilled', updated_at = now() where id = r.id;
    perform public._req_event(r.id, 'fulfilled', 'Everything approved has been delivered');
    perform public._req_notify(r.requester_id, r.organization_id, 'Everything delivered', r.number || ': all approved items are delivered. Please open the ticket and confirm you received them.', 'info', r.id);
    perform public._req_notify_group(r.id, 'owner', 'Delivered: ' || r.title, r.number || ' is fully delivered. Waiting for ' || r.requester_name || ' to confirm.', 'info');
  else
    perform public._req_notify(r.requester_id, r.organization_id, 'Item delivered',
      r.number || ': ' || f.qty || ' × ' || ri.name || ' delivered' || case when coalesce(trim(p_received_by), '') <> '' then ' to ' || trim(p_received_by) else '' end || '.', 'info', r.id);
  end if;
end $$;
revoke all on function public.request_deliver(text, text, text, text) from public, anon;
grant execute on function public.request_deliver(text, text, text, text) to authenticated;

-- 6. Goods arrive in store: tell the requester and the team that hands them over ----------------
create or replace function public.request_goods_arrived()
returns trigger language plpgsql security definer set search_path = public as $$
declare f record; r record; ri record;
begin
  if new.qty_received <= old.qty_received then return new; end if;
  for f in select * from public.request_fulfilments where purchase_item_id = new.id and status = 'planned' loop
    if new.qty_received >= f.qty and old.qty_received < f.qty then
      select * into r from public.requests where id = f.request_id;
      select * into ri from public.request_items where id = f.item_id;
      perform public._req_event(r.id, 'arrived', ri.name || ' has arrived in store');
      perform public._req_notify(r.requester_id, r.organization_id, 'Item arrived', r.number || ': ' || ri.name || ' has arrived and will be handed over soon.', 'info', r.id);
      perform public._req_notify_group(r.id, case when ri.kind = 'radio' then 'walkie' else 'inventory' end,
        'Ready to hand over: ' || r.title, r.number || ' · ' || ri.name || ' has arrived', 'approval');
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists request_goods_arrived on public.purchase_items;
create trigger request_goods_arrived after update of qty_received on public.purchase_items
  for each row execute function public.request_goods_arrived();

-- 7. The requester confirms receipt (the owner can also close it) ---------------------------------
create or replace function public.request_confirm_receipt(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id is distinct from public.current_organization_id() then raise exception 'Request not found.'; end if;
  if not (r.requester_id = auth.uid() or public.req_is_exec()) then raise exception 'Only the person who raised it, or the owner, can confirm receipt.'; end if;
  if r.status <> 'fulfilled' then raise exception 'You can confirm once everything has been delivered.'; end if;
  if r.confirmed_at is not null then return; end if;
  update public.requests set confirmed_at = now(), confirmed_by = public.current_name(), updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'confirmed', 'Receipt confirmed. Ticket closed.');
  perform public._req_notify_group(p_id, 'owner', 'Received: ' || r.title, r.number || ' confirmed by ' || public.current_name(), 'info');
end $$;
revoke all on function public.request_confirm_receipt(text) from public, anon;
grant execute on function public.request_confirm_receipt(text) to authenticated;

-- 8. The owner decides whether the vendor name / the rate are visible on a ticket ------------------
create or replace function public.request_set_visibility(p_id text, p_vendor boolean, p_rate boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_org_owner() then raise exception 'Only the Organization Head can change this.'; end if;
  update public.requests set show_vendor = coalesce(p_vendor, false), show_rate = coalesce(p_rate, false)
  where id = p_id and organization_id = public.current_organization_id();
  if not found then raise exception 'Request not found.'; end if;
  perform public._req_event(p_id, 'visibility', 'Vendor name ' || case when p_vendor then 'shown' else 'hidden' end || ', rate ' || case when p_rate then 'shown' else 'hidden' end || ' on this ticket');
end $$;
revoke all on function public.request_set_visibility(text, boolean, boolean) from public, anon;
grant execute on function public.request_set_visibility(text, boolean, boolean) to authenticated;

-- 9. Order progress per purchased line --------------------------------------------------------------
-- Owner, IT head and the Purchase team always get vendor + rate. Everyone else only when the owner switched
-- them on for that ticket. The PO number is for the owner, IT head, Purchase and Inventory teams.
create or replace function public.request_order_info()
returns table (purchase_item_id text, request_id text, item_id text, ordered integer, received integer,
               po_number text, po_status text, expected_date date, vendor text, rate numeric)
language sql stable security definer set search_path = public as $$
  select f.purchase_item_id, f.request_id, f.item_id, pi.qty_ordered, pi.qty_received,
         case when me.level in ('owner','dept_head') or me.sub_department in ('purchase','inventory') then po.po_number end,
         po.status, po.expected_date,
         case when me.level in ('owner','dept_head') or me.sub_department = 'purchase' or r.show_vendor then v.name end,
         case when me.level in ('owner','dept_head') or me.sub_department = 'purchase' or r.show_rate then pi.rate end
  from (select p.id, p.organization_id, p.level, p.sub_department from public.profiles p
        where p.id = auth.uid() and p.approved and p.is_active) me
  join public.requests r on r.organization_id = me.organization_id and public.can_see_request(r)
  join public.request_fulfilments f on f.request_id = r.id and f.purchase_item_id is not null
  join public.purchase_items pi on pi.id = f.purchase_item_id
  join public.purchase_orders po on po.id = pi.po_id
  left join public.purchase_vendors v on v.id = po.vendor_id;
$$;
revoke all on function public.request_order_info() from public, anon;
grant execute on function public.request_order_info() to authenticated;

-- 10. The public share link is gone ----------------------------------------------------------------------
drop function if exists public.get_shared_request(text);
drop function if exists public.request_share(text, boolean);
update public.requests set share_token = null where share_token is not null;

notify pgrst, 'reload schema';
