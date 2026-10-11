-- Distinguish online and offline procurement orders.
-- Apply after migration_v50_fix_delivery_assignment.sql.

alter table public.purchase_orders add column if not exists vendor_mode text;

-- Preserve existing tracking behavior for orders already placed; existing open drafts start offline.
update public.purchase_orders
  set vendor_mode = case when status in ('ordered','partial','received') then 'online' else 'offline' end
  where vendor_mode is null and status <> 'draft';

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.purchase_orders'::regclass and conname='purchase_orders_vendor_mode_check') then
    alter table public.purchase_orders add constraint purchase_orders_vendor_mode_check check (vendor_mode is null or vendor_mode in ('online','offline'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.purchase_orders'::regclass and conname='purchase_orders_vendor_mode_for_placed_check') then
    alter table public.purchase_orders add constraint purchase_orders_vendor_mode_for_placed_check check (status not in ('ordered','partial','received') or vendor_mode is not null);
  end if;
end $$;

select pg_notify('pgrst','reload schema');
