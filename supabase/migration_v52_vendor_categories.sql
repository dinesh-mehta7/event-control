-- Store whether each vendor is Online or Offline.
-- Apply after migration_v51_vendor_order_mode.sql.

alter table public.purchase_vendors add column if not exists vendor_mode text;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.purchase_vendors'::regclass
      and conname = 'purchase_vendors_vendor_mode_check'
  ) then
    alter table public.purchase_vendors
      add constraint purchase_vendors_vendor_mode_check
      check (vendor_mode is null or vendor_mode in ('online', 'offline'));
  end if;
end $$;

select pg_notify('pgrst', 'reload schema');
