-- Request viewers can always see the vendor and rate for purchased items.
-- Run after migration_v54_order_tracking_stage.sql.

drop function if exists public.request_set_visibility(text, boolean, boolean);

create or replace function public.request_order_info()
returns table (purchase_item_id text, request_id text, item_id text, ordered integer, received integer,
               po_number text, po_status text, expected_date date, vendor text, rate numeric)
language sql stable security definer set search_path = public as $$
  select f.purchase_item_id, f.request_id, f.item_id, pi.qty_ordered, pi.qty_received,
         case when me.level in ('owner','dept_head') or me.sub_department in ('purchase','inventory') then po.po_number end,
         po.status, po.expected_date, v.name, pi.rate
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

notify pgrst, 'reload schema';
