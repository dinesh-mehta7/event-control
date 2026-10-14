-- Store each request's approved miscellaneous / installation allowance once
-- on its linked purchase order. This is included in PO totals without a fake
-- purchase item line.
alter table public.purchase_orders
  add column if not exists misc_amount numeric(12,2) not null default 0
  check (misc_amount >= 0);

notify pgrst, 'reload schema';
