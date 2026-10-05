-- ============================================================================
-- migration_v11_inventory.sql
-- Inventory module: items, a stock ledger (every receive / issue / return /
-- damage is a row), and per-department holdings (who holds how many).
--
-- Run AFTER migration_v7. Safe to run more than once.
-- WHO CAN DO WHAT (enforced here, not just in the UI):
--   * any active, approved member of the organization -> can VIEW
--   * owner, IT dept head, and anyone whose sub_department = 'inventory' -> can edit
-- Stock numbers can only change through the ledger (the trigger below), never by
-- editing an item directly, so counts can always be traced and never go negative.
-- ============================================================================

create or replace function public.can_manage_inventory()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select approved and is_active and (level in ('owner','dept_head') or sub_department = 'inventory')
    from public.profiles where id = auth.uid()
  ), false);
$$;

create table if not exists public.inventory_items (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  code            text not null default '',
  category        text not null default 'General',
  unit            text not null default 'pcs',
  location        text not null default '',
  min_level       integer not null default 0 check (min_level >= 0),
  in_stock        integer not null default 0 check (in_stock >= 0),
  issued          integer not null default 0 check (issued >= 0),
  damaged         integer not null default 0 check (damaged >= 0),
  created_at      timestamptz not null default now()
);
create index if not exists inventory_items_org_idx on public.inventory_items (organization_id);
create unique index if not exists inventory_items_org_code_uidx
  on public.inventory_items (organization_id, lower(code)) where code <> '';

create table if not exists public.inventory_holdings (
  item_id         text not null references public.inventory_items(id) on delete cascade,
  department      text not null check (department in
                    ('cctv','wifi','walkie','control','inventory','purchase','accommodation','sewadars')),
  organization_id text not null references public.organizations(id) on delete cascade,
  qty             integer not null default 0 check (qty >= 0),
  primary key (item_id, department)
);

create table if not exists public.inventory_movements (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  item_id         text not null references public.inventory_items(id) on delete cascade,
  type            text not null check (type in
                    ('receive','issue','return','return_damaged','damage','repair','write_off','adjust')),
  qty             integer not null,
  department      text check (department in
                    ('cctv','wifi','walkie','control','inventory','purchase','accommodation','sewadars')),
  person          text not null default '',   -- issued to / received from / returned by
  ref             text not null default '',   -- challan / PO / ticket number
  note            text not null default '',
  done_by         text,
  done_at         timestamptz not null default now(),
  constraint inventory_movements_qty check ((type = 'adjust' and qty <> 0) or (type <> 'adjust' and qty > 0))
);
create index if not exists inventory_movements_item_idx on public.inventory_movements (item_id, done_at desc);

-- Direct edits can never change the counts: only the ledger trigger (depth 2) can.
create or replace function public.inventory_items_guard()
returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() = 1 then
    new.in_stock := old.in_stock; new.issued := old.issued; new.damaged := old.damaged;
  end if;
  return new;
end $$;
drop trigger if exists inventory_items_guard on public.inventory_items;
create trigger inventory_items_guard before update on public.inventory_items
  for each row execute function public.inventory_items_guard();

-- Applying a ledger row updates the item + department holdings atomically ----------
create or replace function public.inventory_apply_movement()
returns trigger language plpgsql security definer set search_path = public as $$
declare it record; held integer; ds integer := 0; di integer := 0; dd integer := 0;
begin
  new.done_by := coalesce(new.done_by, (select name from public.profiles where id = auth.uid()), 'System');
  select * into it from public.inventory_items where id = new.item_id for update;
  if not found then raise exception 'That item no longer exists.'; end if;
  if it.organization_id <> new.organization_id then raise exception 'That item belongs to a different organization.'; end if;

  case new.type
    when 'receive'        then ds :=  new.qty;
    when 'issue'          then ds := -new.qty; di :=  new.qty;
    when 'return'         then ds :=  new.qty; di := -new.qty;
    when 'return_damaged' then di := -new.qty; dd :=  new.qty;
    when 'damage'         then ds := -new.qty; dd :=  new.qty;
    when 'repair'         then dd := -new.qty; ds :=  new.qty;
    when 'write_off'      then dd := -new.qty;
    when 'adjust'         then ds :=  new.qty;
  end case;

  if it.in_stock + ds < 0 then raise exception 'Only % % in store.', it.in_stock, it.unit; end if;
  if it.damaged + dd < 0 then raise exception 'Only % damaged on record.', it.damaged; end if;

  if new.type in ('issue','return','return_damaged') then
    if new.department is null then raise exception 'Choose a department.'; end if;
    if new.type = 'issue' then
      insert into public.inventory_holdings (item_id, department, organization_id, qty)
        values (new.item_id, new.department, new.organization_id, new.qty)
        on conflict (item_id, department) do update set qty = public.inventory_holdings.qty + new.qty;
    else
      select qty into held from public.inventory_holdings where item_id = new.item_id and department = new.department;
      if coalesce(held, 0) < new.qty then
        raise exception '% holds only % of this item.', new.department, coalesce(held, 0);
      end if;
      update public.inventory_holdings set qty = qty - new.qty
        where item_id = new.item_id and department = new.department;
    end if;
  end if;

  update public.inventory_items set in_stock = in_stock + ds, issued = issued + di, damaged = damaged + dd
    where id = new.item_id;
  return new;
end $$;
drop trigger if exists inventory_apply_movement on public.inventory_movements;
create trigger inventory_apply_movement before insert on public.inventory_movements
  for each row execute function public.inventory_apply_movement();

-- Row Level Security ---------------------------------------------------------------
alter table public.inventory_items     enable row level security;
alter table public.inventory_holdings  enable row level security;
alter table public.inventory_movements enable row level security;

drop policy if exists "inv_items_select" on public.inventory_items;
create policy "inv_items_select" on public.inventory_items for select
  using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());
drop policy if exists "inv_items_insert" on public.inventory_items;
create policy "inv_items_insert" on public.inventory_items for insert
  with check (public.can_manage_inventory() and organization_id = public.current_organization_id());
drop policy if exists "inv_items_update" on public.inventory_items;
create policy "inv_items_update" on public.inventory_items for update
  using (public.can_manage_inventory() and organization_id = public.current_organization_id())
  with check (public.can_manage_inventory() and organization_id = public.current_organization_id());
drop policy if exists "inv_items_delete" on public.inventory_items;
create policy "inv_items_delete" on public.inventory_items for delete
  using (public.can_manage_inventory() and organization_id = public.current_organization_id());

drop policy if exists "inv_holdings_select" on public.inventory_holdings;
create policy "inv_holdings_select" on public.inventory_holdings for select
  using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());

drop policy if exists "inv_moves_select" on public.inventory_movements;
create policy "inv_moves_select" on public.inventory_movements for select
  using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());
drop policy if exists "inv_moves_insert" on public.inventory_movements;
create policy "inv_moves_insert" on public.inventory_movements for insert
  with check (public.can_manage_inventory() and organization_id = public.current_organization_id());

-- Realtime ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['inventory_items','inventory_holdings']
  loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

notify pgrst, 'reload schema';
