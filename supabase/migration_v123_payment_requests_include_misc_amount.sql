-- Match payment request limits to the PO total shown in Procurement.
-- Miscellaneous / installation costs are stored on the PO, outside item lines.
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
  total := total + coalesce(po.misc_amount,0);
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

notify pgrst, 'reload schema';
