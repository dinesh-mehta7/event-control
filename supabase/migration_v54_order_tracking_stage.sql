-- Allow marketplace order IDs to be saved before the seller assigns a courier AWB.
-- Run after migration_v52_vendor_categories.sql. Also removes the old marketplace check constraint.

alter table public.purchase_trackings
  alter column tracking_number set default '';
alter table public.purchase_trackings
  alter column tracking_number set not null;

alter table public.purchase_trackings
  drop constraint if exists purchase_trackings_organization_id_tracking_number_key;
drop index if exists public.purchase_trackings_org_tracking_number_unique;
create unique index purchase_trackings_org_tracking_number_unique
  on public.purchase_trackings(organization_id, tracking_number)
  where tracking_number <> '';

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

create or replace function public.purchase_tracking_notify_it_head()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  order_number text;
  item_name text;
  checkpoint jsonb;
  message_text text;
  notification_type text := 'info';
begin
  if tg_op = 'UPDATE'
     and old.status is not distinct from new.status
     and old.sub_status is not distinct from new.sub_status
     and old.last_event_at is not distinct from new.last_event_at
     and old.checkpoints is not distinct from new.checkpoints then
    return new;
  end if;

  select po.po_number, pi.name into order_number, item_name
  from public.purchase_orders po
  join public.purchase_items pi on pi.id = new.purchase_item_id
  where po.id = new.po_id and po.organization_id = new.organization_id;

  if new.tracking_number = '' then
    message_text := coalesce(item_name, 'Purchase item') || ': order ' || new.marketplace_order_number ||
      ' placed with ' || coalesce(nullif(new.marketplace, ''), 'online vendor') || '; waiting for shipment.';
  elsif tg_op = 'INSERT' then
    message_text := coalesce(item_name, 'Purchase item') || ': courier tracking started for AWB ' || new.tracking_number || '.';
  else
    checkpoint := new.checkpoints -> -1;
    message_text := coalesce(item_name, 'Purchase item') || ': ' ||
      coalesce(nullif(new.sub_status, ''), nullif(new.status, ''), 'shipment update') ||
      ' · AWB ' || new.tracking_number ||
      case when coalesce(checkpoint ->> 'location', '') <> '' then ' · ' || (checkpoint ->> 'location') else '' end ||
      case when coalesce(checkpoint ->> 'message', '') <> '' then ' · ' || (checkpoint ->> 'message') else '' end;
    if lower(new.status) like '%exception%' or lower(new.status) like '%failed%' then notification_type := 'warning'; end if;
  end if;

  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select new.organization_id, p.id, 'Purchase tracking · ' || coalesce(order_number, new.po_id), message_text,
    notification_type, 'purchase/tracking', new.po_id
  from public.profiles p
  where p.organization_id = new.organization_id and p.level = 'dept_head' and p.approved and p.is_active;
  return new;
end $$;

drop trigger if exists purchase_tracking_notify_it_head on public.purchase_trackings;
create trigger purchase_tracking_notify_it_head
after insert or update
on public.purchase_trackings
for each row execute function public.purchase_tracking_notify_it_head();
revoke all on function public.purchase_tracking_notify_it_head() from public, anon, authenticated;

select pg_notify('pgrst', 'reload schema');
