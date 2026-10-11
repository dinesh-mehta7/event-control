-- Purchase places and records approved request orders directly; Super Admin review ends at request approval.
-- Apply after migration_v48_assign_delivery_after_approval.sql.

create or replace function public.purchase_orders_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;

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
      if exists (select 1 from public.purchase_receipts where po_id = old.id) then raise exception 'Goods were already received against this order.'; end if;
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

create or replace function public.purchase_items_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare st text;
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  if coalesce(current_setting('app.po_internal', true), '') = '1' then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then
    if coalesce(current_setting('app.po_internal', true), '') <> '1' then raise exception 'Order lines come from requests. Create the order from the buy list.'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then raise exception 'An order line cannot be removed. Cancel the order and it goes back to the buy list.'; end if;
  select status into st from public.purchase_orders where id = old.po_id;
  if st is null then raise exception 'That order no longer exists.'; end if;
  if st not in ('draft','rejected','pending') then raise exception 'Rates can only be changed before the order is placed.'; end if;
  new.qty_received := old.qty_received;
  new.po_id := old.po_id;
  new.organization_id := old.organization_id;
  new.name := old.name;
  new.unit := old.unit;
  new.qty_ordered := old.qty_ordered;
  new.inventory_item_id := old.inventory_item_id;
  new.position := old.position;
  new.request_id := old.request_id;
  new.request_number := old.request_number;
  return new;
end $$;

-- Future purchase-order status changes never notify Super Admin for a second decision.
create or replace function public.purchase_orders_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'ordered' then
    for r in select distinct q.id, q.number, q.requester_id, q.organization_id
      from public.purchase_items i join public.requests q on q.id=i.request_id where i.po_id=new.id
    loop
      perform public._req_event(r.id, 'ordered', 'Items ordered from the vendor' || case when new.expected_date is not null then ', expected ' || to_char(new.expected_date, 'DD Mon') else '' end);
      perform public._req_notify(r.requester_id, r.organization_id, 'Items ordered', r.number || ': your items have been ordered' || case when new.expected_date is not null then ', expected ' || to_char(new.expected_date, 'DD Mon') else '' end || '.', 'info', r.id);
    end loop;
  elsif new.status = 'cancelled' then
    update public.request_fulfilments set purchase_item_id=null
      where status='planned' and purchase_item_id in (select id from public.purchase_items where po_id=new.id);
    for r in select distinct q.id, q.number, q.requester_id, q.organization_id
      from public.purchase_items i join public.requests q on q.id=i.request_id where i.po_id=new.id
    loop
      perform public._req_event(r.id, 'po_cancelled', 'The order was cancelled. The items are back on the buy list');
      perform public._req_notify(r.requester_id, r.organization_id, 'Order cancelled', r.number || ': the order was cancelled and will be placed again.', 'warning', r.id);
    end loop;
    perform public._org_notify(new.organization_id, 'purchase', 'Order cancelled: ' || new.po_number, 'Its items are back on the buy list.', 'info', 'purchase/buy', new.id);
  end if;
  return new;
end $$;

-- A payment request is saved as ready-to-pay immediately; it is no longer routed to Super Admin.
create or replace function public.payment_request_create(p_po text, p_amount numeric, p_note text)
returns text language plpgsql security definer set search_path = public as $$
declare me record; po record; total numeric; asked numeric; due numeric; pid text;
begin
  select * into me from public.profiles where id=auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if not (me.level in ('owner','dept_head') or me.sub_department='purchase') then raise exception 'Only the Purchase team can record a payment request.'; end if;
  select * into po from public.purchase_orders where id=p_po for update;
  if not found or po.organization_id<>me.organization_id then raise exception 'Order not found.'; end if;
  if po.status not in ('approved','ordered','partial','received') then raise exception 'You can record payment only after the order is placed.'; end if;
  if coalesce(p_amount,0)<=0 then raise exception 'Enter an amount above zero.'; end if;
  select coalesce(sum(qty_ordered*rate),0) into total from public.purchase_items where po_id=po.id;
  select coalesce(sum(amount),0) into asked from public.purchase_payment_requests where po_id=po.id and status in ('pending','approved');
  due := total-po.paid_amount-asked;
  if p_amount>due+0.009 then raise exception 'Only Rs % can still be asked for on this order.', round(greatest(due,0),2); end if;
  pid := 'pr-' || substr(md5(random()::text || clock_timestamp()::text),1,16);
  insert into public.purchase_payment_requests (id,organization_id,po_id,amount,note,status,requested_by,requested_by_id,decided_by,decided_at)
  values (pid,po.organization_id,po.id,p_amount,trim(coalesce(p_note,'')),'approved',me.name,me.id,me.name,now());
  return pid;
end $$;
revoke all on function public.payment_request_create(text,numeric,text) from public, anon;
grant execute on function public.payment_request_create(text,numeric,text) to authenticated;

create or replace function public.payment_request_pay(p_id text, p_mode text, p_ref text, p_paid_by text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; pr record; pay_id text;
begin
  select * into me from public.profiles where id=auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if not (me.level in ('owner','dept_head') or me.sub_department='purchase') then raise exception 'Only the Purchase team can make a payment.'; end if;
  select * into pr from public.purchase_payment_requests where id=p_id for update;
  if not found or pr.organization_id<>me.organization_id then raise exception 'Payment request not found.'; end if;
  if pr.status<>'approved' then raise exception 'This payment request is not ready to pay.'; end if;
  pay_id := 'pay-' || substr(md5(random()::text || clock_timestamp()::text),1,16);
  perform set_config('app.pay_internal','1',true);
  insert into public.purchase_payments (id,organization_id,po_id,amount,mode,ref,paid_by,note)
  values (pay_id,pr.organization_id,pr.po_id,pr.amount,coalesce(nullif(trim(p_mode),''),'bank'),trim(coalesce(p_ref,'')),coalesce(nullif(trim(p_paid_by),''),me.name),trim(coalesce(p_note,'')));
  perform set_config('app.pay_internal','',true);
  update public.purchase_payment_requests set status='paid',payment_id=pay_id,paid_at=now() where id=p_id;
end $$;
revoke all on function public.payment_request_pay(text,text,text,text,text) from public, anon;
grant execute on function public.payment_request_pay(text,text,text,text,text) to authenticated;

create or replace function public.payment_request_cancel(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare pr record;
begin
  select * into pr from public.purchase_payment_requests where id=p_id for update;
  if not found or pr.organization_id<>public.current_organization_id() then raise exception 'Payment request not found.'; end if;
  if not (pr.requested_by_id=auth.uid() or public.is_org_owner() or public.can_manage_purchase()) then raise exception 'Not allowed.'; end if;
  if pr.status not in ('pending','approved') then raise exception 'This payment request is already closed.'; end if;
  update public.purchase_payment_requests set status='cancelled' where id=p_id;
end $$;
revoke all on function public.payment_request_cancel(text) from public, anon;
grant execute on function public.payment_request_cancel(text) to authenticated;

create or replace function public.payment_request_review(p_id text, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Payment requests no longer need Super Admin approval.';
end $$;
revoke all on function public.payment_request_review(text,boolean,text) from public, anon, authenticated;

-- Clear any old payment queue so it cannot leave follow-up work with Super Admin.
update public.purchase_payment_requests
  set status='approved', decided_by='System', decided_at=coalesce(decided_at,now()), decision_note=''
  where status='pending';

select pg_notify('pgrst','reload schema');
