-- Carrier event tracking for request purchase orders (AfterShip webhooks).
-- Run after migration_v46_request_delivery_tasks.sql.

alter table public.purchase_receipts
  add column if not exists location text references public.inventory_locations(id) on delete set null;

create table if not exists public.purchase_trackings (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  po_id text not null references public.purchase_orders(id) on delete cascade,
  purchase_item_id text not null references public.purchase_items(id) on delete cascade,
  marketplace text not null check (marketplace in ('amazon','flipkart','other')),
  marketplace_order_number text not null default '',
  tracking_number text not null,
  courier_slug text not null default '',
  aftership_id text not null default '',
  status text not null default 'Pending',
  sub_status text not null default '',
  tracking_url text not null default '',
  estimated_delivery date,
  checkpoints jsonb not null default '[]'::jsonb,
  last_event_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(organization_id, tracking_number)
);

-- If a request item was not in the catalogue when ordered, create its inventory
-- record on first receipt so subsequent delivery and stock history stay linked.
create or replace function public.purchase_receipts_apply()
returns trigger language plpgsql security definer set search_path=public as $$
declare it record; po record; open_lines integer; new_inventory_item text; receipt_location text;
begin
  select * into it from public.purchase_items where id=new.item_id for update;
  if not found then raise exception 'That order line no longer exists.'; end if;
  select * into po from public.purchase_orders where id=it.po_id for update;
  new.po_id := it.po_id; new.organization_id := po.organization_id;
  new.done_by := coalesce(new.done_by,(select name from public.profiles where id=auth.uid()),'System');
  if po.status not in ('ordered','partial') then raise exception 'Goods can be received only after the order is marked as ordered.'; end if;
  if new.qty > it.qty_ordered-it.qty_received then raise exception 'Only % more % can be received on "%".',it.qty_ordered-it.qty_received,it.unit,it.name; end if;

  receipt_location := new.location;
  if receipt_location is null then
    select id into receipt_location from public.inventory_locations where organization_id=po.organization_id and lower(trim(name))='main store' limit 1;
    if receipt_location is null then
      receipt_location := 'loc-' || substr(md5(po.organization_id || ':main-store'),1,18);
      insert into public.inventory_locations(id,organization_id,name) values(receipt_location,po.organization_id,'Main Store') on conflict do nothing;
      select id into receipt_location from public.inventory_locations where organization_id=po.organization_id and lower(trim(name))='main store' limit 1;
    end if;
  end if;
  new.location := receipt_location;

  update public.purchase_items set qty_received=qty_received+new.qty where id=it.id;
  select count(*) into open_lines from public.purchase_items where po_id=po.id and qty_received<qty_ordered;
  update public.purchase_orders set status=case when open_lines=0 then 'received' else 'partial' end where id=po.id;

  if it.inventory_item_id is null then
    select id into new_inventory_item from public.inventory_items
      where organization_id=po.organization_id and lower(trim(name))=lower(trim(it.name)) order by created_at limit 1;
    if new_inventory_item is null then
      new_inventory_item := 'inv-' || substr(md5(random()::text || clock_timestamp()::text),1,18);
      insert into public.inventory_items(id,organization_id,name,unit,category)
        values(new_inventory_item,po.organization_id,it.name,it.unit,'General');
    end if;
    perform set_config('app.po_internal','1',true);
    update public.purchase_items set inventory_item_id=new_inventory_item where id=it.id;
    update public.request_fulfilments set inventory_item_id=new_inventory_item where purchase_item_id=it.id and status='planned';
    perform set_config('app.po_internal','',true);
    it.inventory_item_id := new_inventory_item;
  end if;
  insert into public.inventory_movements(id,organization_id,item_id,type,qty,location,given_by,received_by,ref,note,done_by)
    values('mv-' || substr(md5(random()::text || clock_timestamp()::text),1,16),po.organization_id,it.inventory_item_id,
      'receive',new.qty,receipt_location,new.given_by,new.received_by,po.po_number,
      'Purchase ' || po.po_number || case when new.challan<>'' then ' · challan ' || new.challan else '' end,new.done_by);
  return new;
end $$;

create index if not exists purchase_trackings_po_idx on public.purchase_trackings(organization_id,po_id,updated_at desc);
create index if not exists purchase_trackings_line_idx on public.purchase_trackings(purchase_item_id);
alter table public.purchase_trackings enable row level security;
drop policy if exists purchase_trackings_select on public.purchase_trackings;
create policy purchase_trackings_select on public.purchase_trackings for select
  using (organization_id=public.current_organization_id() and public.current_is_active() and public.current_approved());
revoke insert, update, delete on public.purchase_trackings from anon, authenticated;
do $$ begin
  begin execute 'alter publication supabase_realtime add table public.purchase_trackings';
  exception when duplicate_object then null; end;
end $$;
select pg_notify('pgrst','reload schema');
