-- ============================================================================
-- migration_v14_purchase.sql
-- Purchase module: vendors, purchase orders (with line items), goods received
-- (GRN) and payments.
--
-- Run AFTER migration_v13. Safe to run more than once.
--
-- WHO CAN DO WHAT (enforced here, not just in the UI):
--   * view            : owner, IT dept head, sub_department = 'purchase' or 'inventory'
--   * create / edit   : owner, IT dept head, sub_department = 'purchase'
--   * approve / reject: owner, IT dept head only
--   * receive goods   : the above + sub_department = 'inventory' (store keeper)
--
-- ORDER LIFE:  draft -> pending (awaiting approval) -> approved -> ordered
--              -> partial -> received        (rejected / cancelled on the side)
-- "partial" and "received" are set by the database when goods are received;
-- nobody can set them by hand. Receiving a line that is linked to an inventory
-- item also books the stock into Inventory (a 'receive' movement, ref = PO no.).
-- ============================================================================

create or replace function public.can_view_purchase()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved and is_active and (level in ('owner','dept_head') or sub_department in ('purchase','inventory'))
                   from public.profiles where id = auth.uid()), false);
$$;
create or replace function public.can_manage_purchase()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved and is_active and (level in ('owner','dept_head') or sub_department = 'purchase')
                   from public.profiles where id = auth.uid()), false);
$$;
create or replace function public.can_approve_purchase()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved and is_active and level in ('owner','dept_head')
                   from public.profiles where id = auth.uid()), false);
$$;
create or replace function public.can_receive_purchase()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved and is_active and (level in ('owner','dept_head') or sub_department in ('purchase','inventory'))
                   from public.profiles where id = auth.uid()), false);
$$;

-- Tables ----------------------------------------------------------------------
create table if not exists public.purchase_vendors (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  contact_person  text not null default '',
  phone           text not null default '',
  email           text not null default '',
  address         text not null default '',
  notes           text not null default '',
  created_at      timestamptz not null default now()
);
create unique index if not exists purchase_vendors_org_name_uidx on public.purchase_vendors (organization_id, lower(name));

create table if not exists public.purchase_counters (
  organization_id text primary key references public.organizations(id) on delete cascade,
  n               integer not null default 0
);

create table if not exists public.purchase_orders (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  po_number       text not null default '',
  vendor_id       text references public.purchase_vendors(id) on delete restrict,
  title           text not null check (length(trim(title)) > 0),
  requested_by    text not null default '',
  deliver_to      text not null default '',
  expected_date   date,
  status          text not null default 'draft' check (status in
                    ('draft','pending','approved','rejected','ordered','partial','received','cancelled')),
  notes           text not null default '',
  paid_amount     numeric(14,2) not null default 0 check (paid_amount >= 0),
  created_by      text,
  approved_by     text,
  approved_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists purchase_orders_org_idx on public.purchase_orders (organization_id, created_at desc);
create unique index if not exists purchase_orders_org_number_uidx on public.purchase_orders (organization_id, po_number) where po_number <> '';

create table if not exists public.purchase_items (
  id                text primary key,
  organization_id   text not null references public.organizations(id) on delete cascade,
  po_id             text not null references public.purchase_orders(id) on delete cascade,
  inventory_item_id text references public.inventory_items(id) on delete set null,
  name              text not null check (length(trim(name)) > 0),
  unit              text not null default 'pcs',
  qty_ordered       integer not null check (qty_ordered > 0),
  qty_received      integer not null default 0 check (qty_received >= 0),
  rate              numeric(12,2) not null default 0 check (rate >= 0),
  position          integer not null default 0
);
create index if not exists purchase_items_po_idx on public.purchase_items (po_id);

create table if not exists public.purchase_receipts (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  po_id           text not null references public.purchase_orders(id) on delete cascade,
  item_id         text not null references public.purchase_items(id) on delete cascade,
  qty             integer not null check (qty > 0),
  given_by        text not null default '',   -- delivered by (vendor's person / transporter)
  received_by     text not null default '',   -- who in our team received it
  challan         text not null default '',
  note            text not null default '',
  done_by         text,
  done_at         timestamptz not null default now()
);
create index if not exists purchase_receipts_po_idx on public.purchase_receipts (po_id, done_at desc);

create table if not exists public.purchase_payments (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  po_id           text not null references public.purchase_orders(id) on delete cascade,
  amount          numeric(14,2) not null check (amount > 0),
  mode            text not null default 'bank',
  ref             text not null default '',   -- UTR / cheque no. / voucher no.
  paid_by         text not null default '',
  note            text not null default '',
  done_by         text,
  done_at         timestamptz not null default now()
);
create index if not exists purchase_payments_po_idx on public.purchase_payments (po_id, done_at desc);

-- Orders: numbering + status rules --------------------------------------------
create or replace function public.purchase_orders_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare k integer;
begin
  insert into public.purchase_counters (organization_id, n) values (new.organization_id, 1)
    on conflict (organization_id) do update set n = public.purchase_counters.n + 1
    returning n into k;
  new.po_number := 'PO-' || lpad(k::text, 4, '0');
  if new.status not in ('draft','pending') then new.status := 'draft'; end if;
  new.paid_amount := 0; new.approved_by := null; new.approved_at := null;
  new.created_by := coalesce((select name from public.profiles where id = auth.uid()), 'System');
  return new;
end $$;
drop trigger if exists purchase_orders_before_insert on public.purchase_orders;
create trigger purchase_orders_before_insert before insert on public.purchase_orders
  for each row execute function public.purchase_orders_before_insert();

create or replace function public.purchase_orders_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;   -- internal updates (receiving / paying)

  new.po_number := old.po_number; new.created_by := old.created_by;
  new.organization_id := old.organization_id; new.paid_amount := old.paid_amount;

  if new.status is distinct from old.status then
    if new.status = 'pending' then
      if old.status not in ('draft','rejected') then raise exception 'Only a draft or rejected order can be sent for approval.'; end if;
      if not exists (select 1 from public.purchase_items where po_id = old.id) then raise exception 'Add at least one item first.'; end if;
      if new.vendor_id is null then raise exception 'Choose a vendor first.'; end if;
    elsif new.status in ('approved','rejected') then
      if old.status <> 'pending' then raise exception 'Only an order awaiting approval can be approved or rejected.'; end if;
      if not public.can_approve_purchase() then raise exception 'Only the owner or IT head can approve or reject orders.'; end if;
    elsif new.status = 'ordered' then
      if old.status <> 'approved' then raise exception 'Only an approved order can be marked as ordered.'; end if;
    elsif new.status = 'draft' then
      if old.status <> 'pending' then raise exception 'Only a pending order can go back to draft.'; end if;
    elsif new.status = 'cancelled' then
      if old.status not in ('draft','pending','approved','rejected','ordered') then raise exception 'This order can no longer be cancelled.'; end if;
      if exists (select 1 from public.purchase_receipts where po_id = old.id) then raise exception 'Goods were already received against this order.'; end if;
    else
      raise exception 'That status can only be set by receiving goods.';
    end if;
  end if;

  if new.status = 'approved' and old.status <> 'approved' then
    new.approved_by := coalesce((select name from public.profiles where id = auth.uid()), 'System'); new.approved_at := now();
  elsif new.status = 'rejected' and old.status <> 'rejected' then
    new.approved_by := coalesce((select name from public.profiles where id = auth.uid()), 'System'); new.approved_at := now();
  elsif new.status in ('pending','draft') then
    new.approved_by := null; new.approved_at := null;
  else
    new.approved_by := old.approved_by; new.approved_at := old.approved_at;
  end if;

  if old.status not in ('draft','pending','rejected') and (
       new.vendor_id is distinct from old.vendor_id or new.title is distinct from old.title
    or new.requested_by is distinct from old.requested_by or new.deliver_to is distinct from old.deliver_to) then
    raise exception 'This order is locked. Only the expected date and notes can still change.';
  end if;
  return new;
end $$;
drop trigger if exists purchase_orders_guard on public.purchase_orders;
create trigger purchase_orders_guard before update on public.purchase_orders
  for each row execute function public.purchase_orders_guard();

-- Items can only change while the order is still being prepared -----------------
create or replace function public.purchase_items_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare st text;
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;   -- receiving updates qty_received
  select status into st from public.purchase_orders where id = coalesce(new.po_id, old.po_id);
  if tg_op = 'DELETE' then
    if st is not null and st not in ('draft','pending','rejected','cancelled') then
      raise exception 'Items can only be removed while the order is a draft, pending or rejected.';
    end if;
    return old;
  end if;
  if st is null then raise exception 'That order no longer exists.'; end if;
  if st not in ('draft','pending','rejected') then
    raise exception 'Items can only be changed while the order is a draft, pending or rejected.';
  end if;
  if tg_op = 'INSERT' then new.qty_received := 0;
  else new.qty_received := old.qty_received; new.po_id := old.po_id; new.organization_id := old.organization_id; end if;
  return new;
end $$;
drop trigger if exists purchase_items_guard on public.purchase_items;
create trigger purchase_items_guard before insert or update or delete on public.purchase_items
  for each row execute function public.purchase_items_guard();

-- Goods received: update the line + order, and book linked items into stock -------
create or replace function public.purchase_receipts_apply()
returns trigger language plpgsql security definer set search_path = public as $$
declare it record; po record; open_lines integer;
begin
  select * into it from public.purchase_items where id = new.item_id for update;
  if not found then raise exception 'That order line no longer exists.'; end if;
  select * into po from public.purchase_orders where id = it.po_id for update;
  new.po_id := it.po_id; new.organization_id := po.organization_id;
  new.done_by := coalesce(new.done_by, (select name from public.profiles where id = auth.uid()), 'System');

  if po.status not in ('ordered','partial') then
    raise exception 'Goods can be received only after the order is marked as ordered.';
  end if;
  if new.qty > it.qty_ordered - it.qty_received then
    raise exception 'Only % more % can be received on "%".', it.qty_ordered - it.qty_received, it.unit, it.name;
  end if;

  update public.purchase_items set qty_received = qty_received + new.qty where id = it.id;
  select count(*) into open_lines from public.purchase_items where po_id = po.id and qty_received < qty_ordered;
  update public.purchase_orders set status = case when open_lines = 0 then 'received' else 'partial' end where id = po.id;

  if it.inventory_item_id is not null then
    insert into public.inventory_movements (id, organization_id, item_id, type, qty, location, given_by, received_by, ref, note, done_by)
    values ('mv-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), po.organization_id, it.inventory_item_id,
            'receive', new.qty, null, new.given_by, new.received_by, po.po_number,
            'Purchase ' || po.po_number || case when new.challan <> '' then ' · challan ' || new.challan else '' end,
            new.done_by);
  end if;
  return new;
end $$;
drop trigger if exists purchase_receipts_apply on public.purchase_receipts;
create trigger purchase_receipts_apply before insert on public.purchase_receipts
  for each row execute function public.purchase_receipts_apply();

-- Payments: cannot exceed what is still due -------------------------------------
create or replace function public.purchase_payments_apply()
returns trigger language plpgsql security definer set search_path = public as $$
declare po record; total numeric;
begin
  select * into po from public.purchase_orders where id = new.po_id for update;
  if not found then raise exception 'That order no longer exists.'; end if;
  new.organization_id := po.organization_id;
  new.done_by := coalesce(new.done_by, (select name from public.profiles where id = auth.uid()), 'System');
  if po.status not in ('approved','ordered','partial','received') then
    raise exception 'Payments can be recorded only for approved orders.';
  end if;
  select coalesce(sum(qty_ordered * rate), 0) into total from public.purchase_items where po_id = po.id;
  if po.paid_amount + new.amount > total + 0.009 then
    raise exception 'Only % is still due on this order.', round(total - po.paid_amount, 2);
  end if;
  update public.purchase_orders set paid_amount = paid_amount + new.amount where id = po.id;
  return new;
end $$;
drop trigger if exists purchase_payments_apply on public.purchase_payments;
create trigger purchase_payments_apply before insert on public.purchase_payments
  for each row execute function public.purchase_payments_apply();

-- Row Level Security ---------------------------------------------------------------
alter table public.purchase_vendors  enable row level security;
alter table public.purchase_counters enable row level security;   -- no policies: only triggers touch it
alter table public.purchase_orders   enable row level security;
alter table public.purchase_items    enable row level security;
alter table public.purchase_receipts enable row level security;
alter table public.purchase_payments enable row level security;

do $$
declare t text;
begin
  foreach t in array array['purchase_vendors','purchase_orders','purchase_items','purchase_receipts','purchase_payments'] loop
    execute format('drop policy if exists "%1$s_select" on public.%1$I', t);
    execute format('create policy "%1$s_select" on public.%1$I for select using (organization_id = public.current_organization_id() and public.can_view_purchase())', t);
  end loop;
  foreach t in array array['purchase_vendors','purchase_orders','purchase_items','purchase_payments'] loop
    execute format('drop policy if exists "%1$s_insert" on public.%1$I', t);
    execute format('create policy "%1$s_insert" on public.%1$I for insert with check (public.can_manage_purchase() and organization_id = public.current_organization_id())', t);
  end loop;
  foreach t in array array['purchase_vendors','purchase_orders','purchase_items'] loop
    execute format('drop policy if exists "%1$s_update" on public.%1$I', t);
    execute format('create policy "%1$s_update" on public.%1$I for update using (public.can_manage_purchase() and organization_id = public.current_organization_id()) with check (public.can_manage_purchase() and organization_id = public.current_organization_id())', t);
  end loop;
  foreach t in array array['purchase_vendors','purchase_items'] loop
    execute format('drop policy if exists "%1$s_delete" on public.%1$I', t);
    execute format('create policy "%1$s_delete" on public.%1$I for delete using (public.can_manage_purchase() and organization_id = public.current_organization_id())', t);
  end loop;
end $$;

-- Approvers need to change status too (the trigger above decides which changes are legal).
drop policy if exists "purchase_orders_update" on public.purchase_orders;
create policy "purchase_orders_update" on public.purchase_orders for update
  using ((public.can_manage_purchase() or public.can_approve_purchase()) and organization_id = public.current_organization_id())
  with check ((public.can_manage_purchase() or public.can_approve_purchase()) and organization_id = public.current_organization_id());
drop policy if exists "purchase_orders_delete" on public.purchase_orders;
create policy "purchase_orders_delete" on public.purchase_orders for delete
  using (public.can_manage_purchase() and organization_id = public.current_organization_id() and status in ('draft','rejected','cancelled'));

drop policy if exists "purchase_receipts_insert" on public.purchase_receipts;
create policy "purchase_receipts_insert" on public.purchase_receipts for insert
  with check (public.can_receive_purchase() and organization_id = public.current_organization_id());

-- Realtime ------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['purchase_orders','purchase_items','purchase_vendors'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

notify pgrst, 'reload schema';
