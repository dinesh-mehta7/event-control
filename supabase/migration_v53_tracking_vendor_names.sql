-- Allow shipment tracking to use online marketplace names from the vendor list.
-- Run after migration_v52_vendor_categories.sql.

do $$
declare
  check_constraint record;
begin
  for check_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.purchase_trackings'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%marketplace%'
  loop
    execute format('alter table public.purchase_trackings drop constraint %I', check_constraint.conname);
  end loop;
end $$;

select pg_notify('pgrst', 'reload schema');
