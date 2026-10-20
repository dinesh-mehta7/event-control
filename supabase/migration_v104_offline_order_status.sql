-- ============================================================================
-- v104 · Progress of offline-vendor orders
-- ----------------------------------------------------------------------------
-- Online orders get their shipment status from the marketplace / courier tracking. Offline
-- (local) vendors have none, so Procurement now records it by hand while the order waits:
--   confirmed  → the vendor confirmed the order
--   ready      → goods are ready for pickup
--   dispatched → the vendor sent the goods
-- Receiving the goods still happens with "Receive" on the order (unchanged).
-- Apply after migration_v103_request_from_department.sql. Safe to re-run.
-- ============================================================================

alter table public.purchase_orders add column if not exists offline_status text;
alter table public.purchase_orders add column if not exists offline_status_at timestamptz;
alter table public.purchase_orders add column if not exists offline_status_by text not null default '';
alter table public.purchase_orders drop constraint if exists purchase_orders_offline_status_check;
alter table public.purchase_orders add constraint purchase_orders_offline_status_check
  check (offline_status is null or offline_status in ('confirmed','ready','dispatched'));

-- Purchase or the receiving (Inventory) team of the order's department; p_status null clears it.
create or replace function public.purchase_set_offline_status(p_po text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; o record;
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
end $$;
revoke all on function public.purchase_set_offline_status(text, text) from public, anon;
grant execute on function public.purchase_set_offline_status(text, text) to authenticated;

notify pgrst, 'reload schema';
