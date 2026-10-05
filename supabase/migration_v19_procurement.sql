-- ============================================================================
-- migration_v19_procurement.sql
-- Requests + Purchase + Payments become ONE flow. Run AFTER migration_v18. Safe to run more than once.
--
--   Request -> owner approves quantities -> store team arranges (stock / buy) -> Purchase builds an ORDER from the
--   "buy list" (lines of several tickets can go into one order) -> Purchase adds vendor + rates -> the OWNER APPROVES
--   EVERY ORDER -> ordered -> goods received -> handed over -> requester confirms.
--   Payment: Purchase ASKS for a payment, the OWNER APPROVES it, then Purchase pays and records it.
--
--   * There are no stand-alone orders any more: every order and every order line comes from a request.
--   * Only the owner approves orders and payments.
--   * Payments can only be recorded from an approved payment request.
--   * Payment data is visible to the owner, IT head and the Purchase team only.
-- ============================================================================

-- 1. Only the owner approves (orders + payments) -------------------------------------------------
create or replace function public.can_approve_purchase()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_org_owner();
$$;

-- 2. Columns ---------------------------------------------------------------------------------------
alter table public.purchase_orders add column if not exists decision_note text not null default '';
alter table public.purchase_items
  add column if not exists request_id     text references public.requests(id) on delete set null,
  add column if not exists request_number text not null default '';

-- 3. A generic "tell this group" helper (links to any page) ---------------------------------------------
create or replace function public._org_notify(p_org text, p_who text, p_title text, p_msg text, p_type text, p_link text, p_ref text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select p_org, p.id, p_title, p_msg, p_type, p_link, p_ref
  from public.profiles p
  where p.organization_id = p_org and p.approved and p.is_active and p.id is distinct from auth.uid()
    and case p_who when 'owner' then p.level = 'owner' when 'purchase' then p.sub_department = 'purchase'
                   when 'inventory' then p.sub_department = 'inventory' else false end;
$$;
revoke all on function public._org_notify(text, text, text, text, text, text, text) from public, anon, authenticated;

-- 4. Orders: the guard. Every order goes to the owner; rates must be filled in first. -------------------
create or replace function public.purchase_orders_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare me text;
begin
  if pg_trigger_depth() > 1 then return new; end if;   -- internal updates (receiving / paying)
  me := coalesce((select name from public.profiles where id = auth.uid()), 'System');

  new.po_number := old.po_number; new.created_by := old.created_by;
  new.organization_id := old.organization_id; new.paid_amount := old.paid_amount;
  new.request_id := old.request_id;

  if new.status is distinct from old.status then
    if new.status = 'pending' then
      if old.status not in ('draft','rejected') then raise exception 'Only a draft or rejected order can be sent for approval.'; end if;
      if not exists (select 1 from public.purchase_items where po_id = old.id) then raise exception 'This order has no items.'; end if;
      if new.vendor_id is null then raise exception 'Choose a vendor first.'; end if;
      if exists (select 1 from public.purchase_items where po_id = old.id and rate <= 0) then raise exception 'Enter the rate for every item first.'; end if;
    elsif new.status in ('approved','rejected') then
      if old.status <> 'pending' then raise exception 'Only an order awaiting approval can be approved or rejected.'; end if;
      if not public.can_approve_purchase() then raise exception 'Only the owner can approve or reject orders.'; end if;
      if new.status = 'rejected' and trim(coalesce(new.decision_note, '')) = '' then raise exception 'Say why you are rejecting this order.'; end if;
    elsif new.status = 'ordered' then
      if old.status <> 'approved' then raise exception 'Only an approved order can be marked as ordered.'; end if;
    elsif new.status = 'draft' then
      if old.status <> 'pending' then raise exception 'Only a pending order can go back to draft.'; end if;
    elsif new.status = 'cancelled' then
      if old.status not in ('draft','pending','approved','rejected','ordered') then raise exception 'This order can no longer be cancelled.'; end if;
      if exists (select 1 from public.purchase_receipts where po_id = old.id) then raise exception 'Goods were already received against this order.'; end if;
    else
      raise exception 'That status can only be set by receiving goods.';
    end if;
  end if;

  if new.status = 'approved' and old.status <> 'approved' then new.approved_by := me; new.approved_at := now();
  elsif new.status = 'rejected' and old.status <> 'rejected' then new.approved_by := me; new.approved_at := now();
  elsif new.status in ('pending','draft') then new.approved_by := null; new.approved_at := null;
  else new.approved_by := old.approved_by; new.approved_at := old.approved_at; end if;

  -- The owner's note belongs to his decision; any other change keeps the old one, and sending it again clears it.
  if new.status in ('approved','rejected') and old.status = 'pending' then new.decision_note := trim(coalesce(new.decision_note, ''));
  elsif new.status in ('pending','draft') then new.decision_note := '';
  else new.decision_note := old.decision_note; end if;

  if old.status not in ('draft','pending','rejected') and (
       new.vendor_id is distinct from old.vendor_id or new.title is distinct from old.title
    or new.requested_by is distinct from old.requested_by or new.deliver_to is distinct from old.deliver_to) then
    raise exception 'This order is locked. Only the expected date and notes can still change.';
  end if;
  -- While the owner is deciding, the order cannot be edited under his hands.
  if old.status = 'pending' and new.status = 'pending' and (new.vendor_id is distinct from old.vendor_id or new.expected_date is distinct from old.expected_date) then
    raise exception 'The order is with the owner. Wait for his decision first.';
  end if;
  return new;
end $$;

-- 5. Order lines come from requests. Afterwards only the rate can change, and only before approval. -----------
create or replace function public.purchase_items_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare st text;
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;   -- receiving updates qty_received; cascades
  if coalesce(current_setting('app.po_internal', true), '') = '1' then return coalesce(new, old); end if;   -- migrations / the order builder
  if tg_op = 'INSERT' then
    if coalesce(current_setting('app.po_internal', true), '') <> '1' then raise exception 'Order lines come from requests. Create the order from the buy list.'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then raise exception 'An order line cannot be removed. Cancel the order and it goes back to the buy list.'; end if;
  select status into st from public.purchase_orders where id = old.po_id;
  if st is null then raise exception 'That order no longer exists.'; end if;
  if st not in ('draft','rejected') then raise exception 'Rates can only be changed while the order is a draft or was rejected.'; end if;
  -- Only the rate may change.
  new.qty_received := old.qty_received; new.po_id := old.po_id; new.organization_id := old.organization_id;
  new.name := old.name; new.unit := old.unit; new.qty_ordered := old.qty_ordered; new.inventory_item_id := old.inventory_item_id;
  new.position := old.position; new.request_id := old.request_id; new.request_number := old.request_number;
  return new;
end $$;

-- Orders that already exist keep working: fill in the ticket of their lines.
do $$ begin
  perform set_config('app.po_internal', '1', true);
  update public.purchase_items pi set request_id = f.request_id, request_number = r.number
  from public.request_fulfilments f join public.requests r on r.id = f.request_id
  where f.purchase_item_id = pi.id and pi.request_id is null;
  perform set_config('app.po_internal', '', true);
end $$;

-- No stand-alone orders: nobody inserts orders or lines from the browser any more.
drop policy if exists "purchase_orders_insert" on public.purchase_orders;
drop policy if exists "purchase_items_insert"  on public.purchase_items;
drop policy if exists "purchase_payments_insert" on public.purchase_payments;

-- Payments are visible to the money people only.
drop policy if exists "purchase_payments_select" on public.purchase_payments;
create policy "purchase_payments_select" on public.purchase_payments for select
  using (organization_id = public.current_organization_id() and public.can_manage_purchase());

-- 6. Build one order from the lines on the buy list (several tickets are fine) --------------------------------
create or replace function public.purchase_create_po(p_parts text[])
returns text language plpgsql security definer set search_path = public as $$
declare
  me record; n integer; po_id text; pos integer := 0; pi_id text; pf record;
  nums text; places text; reqs integer; single text; need date; who text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if not (me.level in ('owner','dept_head') or me.sub_department = 'purchase') then raise exception 'Only the Purchase team can create orders.'; end if;
  if p_parts is null or array_length(p_parts, 1) is null then raise exception 'Choose at least one item from the buy list.'; end if;

  select count(*) into n from public.request_fulfilments f join public.requests r on r.id = f.request_id
  where f.id = any(p_parts) and r.organization_id = me.organization_id and r.status = 'approved'
    and f.source = 'purchase' and f.status = 'planned' and f.purchase_item_id is null;
  if n <> array_length(p_parts, 1) then raise exception 'Some of these items are not waiting to be ordered any more. Refresh the buy list.'; end if;

  select string_agg(distinct r.number, ', '), count(distinct r.id), min(r.id), min(r.needed_by),
         case when count(distinct r.deliver_to) = 1 then min(r.deliver_to) else 'Several places' end,
         string_agg(distinct r.requester_name, ', ')
    into nums, reqs, single, need, places, who
  from public.request_fulfilments f join public.requests r on r.id = f.request_id where f.id = any(p_parts);

  po_id := 'po-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  insert into public.purchase_orders (id, organization_id, title, requested_by, deliver_to, expected_date, status, notes, request_id)
  values (po_id, me.organization_id, 'For ' || nums, left(who, 120), left(places, 120), need, 'draft', '', case when reqs = 1 then single else null end);

  perform set_config('app.po_internal', '1', true);
  for pf in select x.id as part_id, x.qty as part_qty, x.inventory_item_id as part_inv, x.request_id as rid, r.number as rnum,
                   ri.name as line_name, ri.unit as line_unit
            from public.request_fulfilments x join public.request_items ri on ri.id = x.item_id join public.requests r on r.id = x.request_id
            where x.id = any(p_parts) order by r.number, ri.position loop
    pos := pos + 1;
    pi_id := 'pi-' || substr(md5(random()::text || clock_timestamp()::text || pos::text), 1, 16);
    insert into public.purchase_items (id, organization_id, po_id, inventory_item_id, name, unit, qty_ordered, rate, position, request_id, request_number)
    values (pi_id, me.organization_id, po_id, pf.part_inv, pf.line_name, pf.line_unit, pf.part_qty, 0, pos, pf.rid, pf.rnum);
    update public.request_fulfilments set purchase_item_id = pi_id where id = pf.part_id;
  end loop;
  perform set_config('app.po_internal', '', true);

  for pf in select distinct r.id as rid, r.number as rnum, r.requester_id as uid, r.organization_id as org
            from public.request_fulfilments x join public.requests r on r.id = x.request_id where x.id = any(p_parts) loop
    perform public._req_event(pf.rid, 'po_created', 'The items that are not in stock were put on a purchase order');
    perform public._req_notify(pf.uid, pf.org, 'Items are being ordered', pf.rnum || ': what was not in stock is being purchased.', 'info', pf.rid);
  end loop;
  return po_id;
end $$;
revoke all on function public.purchase_create_po(text[]) from public, anon;
grant execute on function public.purchase_create_po(text[]) to authenticated;

-- The old "create purchase order" button on one ticket keeps working: it orders everything of that ticket.
create or replace function public.request_create_po(p_request text)
returns text language plpgsql security definer set search_path = public as $$
declare ids text[];
begin
  select array_agg(id) into ids from public.request_fulfilments
  where request_id = p_request and source = 'purchase' and status = 'planned' and purchase_item_id is null;
  if ids is null then raise exception 'Nothing is waiting to be ordered for this request.'; end if;
  return public.purchase_create_po(ids);
end $$;
revoke all on function public.request_create_po(text) from public, anon;
grant execute on function public.request_create_po(text) to authenticated;

-- 7. Tell the right people at every step of an order; a cancelled order puts its lines back on the buy list ----
create or replace function public.purchase_orders_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare total numeric; nums text; r record;
begin
  if new.status is not distinct from old.status then return new; end if;
  select coalesce(sum(qty_ordered * rate), 0), coalesce(string_agg(distinct request_number, ', ') filter (where request_number <> ''), '')
    into total, nums from public.purchase_items where po_id = new.id;

  if new.status = 'pending' then
    perform public._org_notify(new.organization_id, 'owner', 'Order to approve: ' || new.po_number,
      'Rs ' || to_char(total, 'FM99,99,99,990.00') || ' · for ' || nums, 'approval', 'requests/review', new.id);
  elsif new.status = 'approved' then
    perform public._org_notify(new.organization_id, 'purchase', 'Order approved: ' || new.po_number, 'Place it with the vendor, then mark it as ordered.', 'info', 'requests/orders', new.id);
  elsif new.status = 'rejected' then
    perform public._org_notify(new.organization_id, 'purchase', 'Order rejected: ' || new.po_number, 'Reason: ' || new.decision_note, 'warning', 'requests/orders', new.id);
  elsif new.status = 'ordered' then
    for r in select distinct q.id, q.number, q.requester_id, q.organization_id from public.purchase_items i join public.requests q on q.id = i.request_id where i.po_id = new.id loop
      perform public._req_event(r.id, 'ordered', 'Items ordered from the vendor' || case when new.expected_date is not null then ', expected ' || to_char(new.expected_date, 'DD Mon') else '' end);
      perform public._req_notify(r.requester_id, r.organization_id, 'Items ordered', r.number || ': your items have been ordered' || case when new.expected_date is not null then ', expected ' || to_char(new.expected_date, 'DD Mon') else '' end || '.', 'info', r.id);
    end loop;
  elsif new.status = 'cancelled' then
    update public.request_fulfilments set purchase_item_id = null
    where status = 'planned' and purchase_item_id in (select id from public.purchase_items where po_id = new.id);
    for r in select distinct q.id, q.number, q.requester_id, q.organization_id from public.purchase_items i join public.requests q on q.id = i.request_id where i.po_id = new.id loop
      perform public._req_event(r.id, 'po_cancelled', 'The order was cancelled. The items are back on the buy list');
      perform public._req_notify(r.requester_id, r.organization_id, 'Order cancelled', r.number || ': the order was cancelled and will be placed again.', 'warning', r.id);
    end loop;
    perform public._org_notify(new.organization_id, 'purchase', 'Order cancelled: ' || new.po_number, 'Its items are back on the buy list.', 'info', 'requests/buy', new.id);
  end if;
  return new;
end $$;
drop trigger if exists purchase_orders_notify on public.purchase_orders;
create trigger purchase_orders_notify after update of status on public.purchase_orders
  for each row execute function public.purchase_orders_notify();

-- 8. Payments: Purchase asks, the owner approves, Purchase pays ---------------------------------------------------
create table if not exists public.purchase_payment_requests (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  po_id           text not null references public.purchase_orders(id) on delete cascade,
  amount          numeric(14,2) not null check (amount > 0),
  note            text not null default '',
  status          text not null default 'pending' check (status in ('pending','approved','rejected','paid','cancelled')),
  requested_by    text not null default '',
  requested_by_id uuid,
  requested_at    timestamptz not null default now(),
  decided_by      text not null default '',
  decided_at      timestamptz,
  decision_note   text not null default '',
  payment_id      text references public.purchase_payments(id) on delete set null,
  paid_at         timestamptz
);
create index if not exists purchase_payment_requests_po_idx on public.purchase_payment_requests (po_id, requested_at desc);
create index if not exists purchase_payment_requests_org_idx on public.purchase_payment_requests (organization_id, status);
alter table public.purchase_payment_requests enable row level security;
grant select on public.purchase_payment_requests to authenticated;
drop policy if exists "purchase_payment_requests_select" on public.purchase_payment_requests;
create policy "purchase_payment_requests_select" on public.purchase_payment_requests for select
  using (organization_id = public.current_organization_id() and public.can_manage_purchase());
do $$ begin
  begin alter publication supabase_realtime add table public.purchase_payment_requests; exception when duplicate_object then null; end;
end $$;

-- A payment row can only be created by "pay" below.
create or replace function public.purchase_payments_apply()
returns trigger language plpgsql security definer set search_path = public as $$
declare po record; total numeric;
begin
  if coalesce(current_setting('app.pay_internal', true), '') <> '1' then raise exception 'Payments are made from an approved payment request.'; end if;
  select * into po from public.purchase_orders where id = new.po_id for update;
  if not found then raise exception 'That order no longer exists.'; end if;
  new.organization_id := po.organization_id;
  new.done_by := coalesce(new.done_by, (select name from public.profiles where id = auth.uid()), 'System');
  if po.status not in ('approved','ordered','partial','received') then raise exception 'Payments can be made only for approved orders.'; end if;
  select coalesce(sum(qty_ordered * rate), 0) into total from public.purchase_items where po_id = po.id;
  if po.paid_amount + new.amount > total + 0.009 then raise exception 'Only % is still due on this order.', round(total - po.paid_amount, 2); end if;
  update public.purchase_orders set paid_amount = paid_amount + new.amount where id = po.id;
  return new;
end $$;

create or replace function public.payment_request_create(p_po text, p_amount numeric, p_note text)
returns text language plpgsql security definer set search_path = public as $$
declare me record; po record; total numeric; asked numeric; due numeric; pid text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if not (me.level in ('owner','dept_head') or me.sub_department = 'purchase') then raise exception 'Only the Purchase team can ask for a payment.'; end if;
  select * into po from public.purchase_orders where id = p_po for update;
  if not found or po.organization_id <> me.organization_id then raise exception 'Order not found.'; end if;
  if po.status not in ('approved','ordered','partial','received') then raise exception 'You can ask for a payment only once the order is approved.'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount above zero.'; end if;
  select coalesce(sum(qty_ordered * rate), 0) into total from public.purchase_items where po_id = po.id;
  select coalesce(sum(amount), 0) into asked from public.purchase_payment_requests where po_id = po.id and status in ('pending','approved');
  due := total - po.paid_amount - asked;
  if p_amount > due + 0.009 then raise exception 'Only Rs % can still be asked for on this order.', round(greatest(due, 0), 2); end if;
  pid := 'pr-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  insert into public.purchase_payment_requests (id, organization_id, po_id, amount, note, requested_by, requested_by_id)
  values (pid, po.organization_id, po.id, p_amount, trim(coalesce(p_note, '')), me.name, me.id);
  perform public._org_notify(po.organization_id, 'owner', 'Payment to approve: ' || po.po_number,
    'Rs ' || to_char(p_amount, 'FM99,99,99,990.00') || ' asked by ' || me.name || case when trim(coalesce(p_note, '')) <> '' then ' · ' || trim(p_note) else '' end, 'approval', 'requests/review', pid);
  return pid;
end $$;
revoke all on function public.payment_request_create(text, numeric, text) from public, anon;
grant execute on function public.payment_request_create(text, numeric, text) to authenticated;

create or replace function public.payment_request_review(p_id text, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare pr record; po record;
begin
  if not public.is_org_owner() then raise exception 'Only the Organization Head can approve payments.'; end if;
  select * into pr from public.purchase_payment_requests where id = p_id for update;
  if not found or pr.organization_id <> public.current_organization_id() then raise exception 'Payment request not found.'; end if;
  if pr.status <> 'pending' then raise exception 'This payment request has already been decided.'; end if;
  if not p_approve and trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting this payment.'; end if;
  select * into po from public.purchase_orders where id = pr.po_id;
  update public.purchase_payment_requests set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = public.current_name(), decided_at = now(), decision_note = trim(coalesce(p_note, '')) where id = p_id;
  if pr.requested_by_id is not null and pr.requested_by_id is distinct from auth.uid() then
    insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
    values (pr.organization_id, pr.requested_by_id,
            case when p_approve then 'Payment approved: ' else 'Payment rejected: ' end || po.po_number,
            'Rs ' || to_char(pr.amount, 'FM99,99,99,990.00') || case when p_approve then '. You can pay it now.' else '. Reason: ' || trim(p_note) end,
            case when p_approve then 'info' else 'warning' end, 'requests/payments', pr.id);
  end if;
end $$;
revoke all on function public.payment_request_review(text, boolean, text) from public, anon;
grant execute on function public.payment_request_review(text, boolean, text) to authenticated;

create or replace function public.payment_request_pay(p_id text, p_mode text, p_ref text, p_paid_by text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; pr record; po record; pay_id text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if not (me.level in ('owner','dept_head') or me.sub_department = 'purchase') then raise exception 'Only the Purchase team can make a payment.'; end if;
  select * into pr from public.purchase_payment_requests where id = p_id for update;
  if not found or pr.organization_id <> me.organization_id then raise exception 'Payment request not found.'; end if;
  if pr.status <> 'approved' then raise exception 'This payment is not approved yet.'; end if;
  select * into po from public.purchase_orders where id = pr.po_id;
  pay_id := 'pay-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  perform set_config('app.pay_internal', '1', true);
  insert into public.purchase_payments (id, organization_id, po_id, amount, mode, ref, paid_by, note)
  values (pay_id, pr.organization_id, pr.po_id, pr.amount, coalesce(nullif(trim(p_mode), ''), 'bank'), trim(coalesce(p_ref, '')),
          coalesce(nullif(trim(p_paid_by), ''), me.name), trim(coalesce(p_note, '')));
  perform set_config('app.pay_internal', '', true);
  update public.purchase_payment_requests set status = 'paid', payment_id = pay_id, paid_at = now() where id = p_id;
  perform public._org_notify(pr.organization_id, 'owner', 'Payment made: ' || po.po_number, 'Rs ' || to_char(pr.amount, 'FM99,99,99,990.00') || ' paid by ' || me.name, 'info', 'requests/payments', pr.id);
end $$;
revoke all on function public.payment_request_pay(text, text, text, text, text) from public, anon;
grant execute on function public.payment_request_pay(text, text, text, text, text) to authenticated;

create or replace function public.payment_request_cancel(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare pr record;
begin
  select * into pr from public.purchase_payment_requests where id = p_id for update;
  if not found or pr.organization_id <> public.current_organization_id() then raise exception 'Payment request not found.'; end if;
  if not (pr.requested_by_id = auth.uid() or public.is_org_owner() or public.can_manage_purchase()) then raise exception 'Not allowed.'; end if;
  if pr.status <> 'pending' then raise exception 'Only a payment request that is still waiting can be withdrawn.'; end if;
  update public.purchase_payment_requests set status = 'cancelled' where id = p_id;
end $$;
revoke all on function public.payment_request_cancel(text) from public, anon;
grant execute on function public.payment_request_cancel(text) to authenticated;

notify pgrst, 'reload schema';
