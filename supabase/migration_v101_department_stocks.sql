-- ============================================================================
-- v101 · Inventory and Procurement per department
-- ----------------------------------------------------------------------------
-- Every department keeps its own stock, categories, locations, purchase orders, receipts and
-- payments. The Super Admin sees all departments. Requests stay shared: a request is made TO a
-- department (requests.department_id) and is fulfilled from that department's stock and orders.
-- Vendors: one list; each vendor is Shared (department_id null) or belongs to one department.
--
-- How rows get their department, without changing the existing functions:
--   a BEFORE INSERT trigger stamps department_id from (1) the value given, (2) the parent row
--   (item → holdings/movements, order → its lines/receipts/payments/trackings, request → orders,
--   fulfilments), (3) the department already chosen earlier in the same transaction, (4) the
--   person's own department. A Super Admin (no department) must say which department.
-- Access: one extra RESTRICTIVE policy per table (ANDed with the existing ones).
-- Existing data goes to the IT department. Apply after migration_v100_department_sub_departments.sql.
-- Safe to re-run (a failed earlier run of this file can simply be run again).
-- ============================================================================

-- ── 1. Columns + backfill ───────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['inventory_items','inventory_holdings','inventory_movements','inventory_categories','inventory_locations',
                           'purchase_orders','purchase_items','purchase_receipts','purchase_payments','purchase_payment_requests',
                           'purchase_trackings','request_fulfilments','purchase_vendors'] loop
    execute format('alter table public.%I add column if not exists department_id text references public.departments(id) on delete restrict', t);
    execute format('create index if not exists %I on public.%I (department_id)', t || '_department_idx', t);
    if t <> 'purchase_vendors' then  -- vendors stay Shared unless someone assigns them
      -- One-time fill of existing rows: switch the tables' own guard triggers off for it (e.g. purchase_items_guard
      -- refuses any change to a placed order), then back on.
      execute format('alter table public.%I disable trigger user', t);
      execute format('update public.%I x set department_id = public._it_department(x.organization_id) where x.department_id is null', t);
      execute format('alter table public.%I enable trigger user', t);
    end if;
  end loop;
end $$;

-- Request fulfilments belong to the request's department when it has one.
alter table public.request_fulfilments disable trigger user;
update public.request_fulfilments f set department_id = r.department_id
from public.requests r where r.id = f.request_id and r.department_id is not null and f.department_id is distinct from r.department_id;
alter table public.request_fulfilments enable trigger user;

-- Not null where every row could be filled (organizations without an IT department keep nulls and get a notice).
do $$
declare t text; n bigint;
begin
  foreach t in array array['inventory_items','inventory_holdings','inventory_movements','inventory_categories','inventory_locations',
                           'purchase_orders','purchase_items','purchase_receipts','purchase_payments','purchase_payment_requests',
                           'purchase_trackings','request_fulfilments'] loop
    execute format('select count(*) from public.%I where department_id is null', t) into n;
    if n = 0 then execute format('alter table public.%I alter column department_id set not null', t);
    else raise notice '% rows in % have no department (no IT department found); column left nullable.', n, t; end if;
  end loop;
end $$;

-- ── 2. Unique per department instead of per organization ────────────────────
drop index if exists public.inventory_items_org_code_uidx;
create unique index if not exists inventory_items_dept_code_uidx on public.inventory_items (organization_id, department_id, lower(code)) where code <> '';
drop index if exists public.inventory_categories_org_name_uidx;
create unique index if not exists inventory_categories_dept_name_uidx on public.inventory_categories (organization_id, department_id, lower(name));
drop index if exists public.inventory_locations_org_name_uidx;
create unique index if not exists inventory_locations_dept_name_uidx on public.inventory_locations (organization_id, department_id, lower(name));

-- ── 3. Stamp the department on insert ───────────────────────────────────────
create or replace function public._stamp_department()
returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new); v text := j->>'department_id'; me record;
begin
  if v is null then
    v := case tg_table_name
      when 'inventory_holdings' then (select department_id from public.inventory_items where id = j->>'item_id')
      when 'inventory_movements' then (select department_id from public.inventory_items where id = j->>'item_id')
      when 'purchase_orders' then (select department_id from public.requests where id = j->>'request_id')
      when 'purchase_items' then (select department_id from public.purchase_orders where id = j->>'po_id')
      when 'purchase_receipts' then (select department_id from public.purchase_orders where id = j->>'po_id')
      when 'purchase_payments' then (select department_id from public.purchase_orders where id = j->>'po_id')
      when 'purchase_payment_requests' then (select department_id from public.purchase_orders where id = j->>'po_id')
      when 'purchase_trackings' then (select department_id from public.purchase_orders where id = j->>'po_id')
      when 'request_fulfilments' then (select department_id from public.requests where id = j->>'request_id')
    end;
  end if;
  if v is null and tg_table_name <> 'purchase_vendors' then
    v := coalesce(nullif(current_setting('app.department_id', true), ''), public.current_department_id());
  end if;
  if v is null and tg_table_name not in ('purchase_vendors','request_fulfilments') then
    raise exception 'Choose the department for this record.';
  end if;
  if v is not null then
    if not exists (select 1 from public.departments d where d.id = v and d.organization_id = (j->>'organization_id')) then
      raise exception 'That department is not in your organization.';
    end if;
    -- Rows created later in this transaction (e.g. stock added by a receipt) belong to the same department.
    perform set_config('app.department_id', v, true);
  end if;
  new := jsonb_populate_record(new, jsonb_build_object('department_id', v));
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['inventory_items','inventory_holdings','inventory_movements','inventory_categories','inventory_locations',
                           'purchase_orders','purchase_items','purchase_receipts','purchase_payments','purchase_payment_requests',
                           'purchase_trackings','request_fulfilments','purchase_vendors'] loop
    -- "a_" so it runs before the tables' other BEFORE INSERT triggers.
    execute format('drop trigger if exists a_stamp_department on public.%I', t);
    execute format('create trigger a_stamp_department before insert on public.%I for each row execute function public._stamp_department()', t);
  end loop;
end $$;

-- A request is fulfilled only from its own department's stock.
create or replace function public._fulfilment_same_department()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.inventory_item_id is not null and new.department_id is not null
     and exists (select 1 from public.inventory_items i where i.id = new.inventory_item_id and i.department_id is distinct from new.department_id) then
    raise exception 'That stock item belongs to another department. Use the requested department''s stock.';
  end if;
  return new;
end $$;
drop trigger if exists fulfilment_same_department on public.request_fulfilments;
create trigger fulfilment_same_department before insert or update of inventory_item_id on public.request_fulfilments
  for each row execute function public._fulfilment_same_department();

-- ── 4. Who sees what: an extra restrictive policy on each table ─────────────
create or replace function public.in_my_department(p_department text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_org_owner() or (p_department is not null and p_department = public.current_department_id());
$$;
grant execute on function public.in_my_department(text) to authenticated;

-- The person who raised a request may follow its order's delivery tracking.
create or replace function public._tracking_visible_to_requester(p_po text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.purchase_orders po join public.requests r on r.id = po.request_id
                 where po.id = p_po and r.requester_id = auth.uid())
      or exists (select 1 from public.purchase_items pi join public.requests r on r.id = pi.request_id
                 where pi.po_id = p_po and r.requester_id = auth.uid());
$$;

do $$
declare t text;
begin
  foreach t in array array['inventory_items','inventory_holdings','inventory_movements','inventory_categories','inventory_locations',
                           'purchase_orders','purchase_items','purchase_receipts','purchase_payments','purchase_payment_requests'] loop
    execute format('drop policy if exists department_scope on public.%I', t);
    execute format('create policy department_scope on public.%I as restrictive for all using (public.in_my_department(department_id)) with check (public.in_my_department(department_id))', t);
  end loop;
end $$;
drop policy if exists department_scope on public.purchase_trackings;
create policy department_scope on public.purchase_trackings as restrictive for all
  using (public.in_my_department(department_id) or public._tracking_visible_to_requester(po_id))
  with check (public.in_my_department(department_id));
drop policy if exists department_scope on public.purchase_vendors;
create policy department_scope on public.purchase_vendors as restrictive for all
  using (department_id is null or public.in_my_department(department_id))
  with check (department_id is null or public.in_my_department(department_id));
-- request_fulfilments keep their request-based visibility (the requester follows delivery).

-- ── 5. Functions the app calls that list stock ─────────────────────────────
drop function if exists public.catalogue_list();
create function public.catalogue_list()
returns table (id text, name text, unit text, category text, department_id text)
language sql stable security definer set search_path = public as $$
  select i.id, i.name, i.unit, i.category, i.department_id
  from public.inventory_items i
  where public.current_approved() and i.organization_id = public.current_organization_id()
  order by lower(i.name);
$$;
revoke all on function public.catalogue_list() from public, anon;
grant execute on function public.catalogue_list() to authenticated;

drop function if exists public.inventory_available();
create function public.inventory_available()
returns table (item_id text, in_stock integer, reserved integer, available integer, department_id text)
language sql stable security definer set search_path = public as $$
  select i.id, i.in_stock,
         coalesce(x.res, 0)::integer,
         greatest(i.in_stock - coalesce(x.res, 0), 0)::integer,
         i.department_id
  from public.inventory_items i
  left join (
    select f.inventory_item_id as iid,
           sum(case when f.source = 'inventory' then f.qty else least(f.qty, coalesce(pi.qty_received, 0)) end) as res
    from public.request_fulfilments f
    left join public.purchase_items pi on pi.id = f.purchase_item_id
    where f.status = 'planned' and f.inventory_item_id is not null
    group by f.inventory_item_id
  ) x on x.iid = i.id
  where i.organization_id = public.current_organization_id()
    and (public.req_is_exec() or public.req_team() in ('inventory','purchase'))
    and public.in_my_department(i.department_id);
$$;
revoke all on function public.inventory_available() from public, anon;
grant execute on function public.inventory_available() to authenticated;

-- Creating an order from buy-list lines: all lines must be from one department, which the order gets.
create or replace function public.purchase_create_po_for_parts(p_parts text[])
returns text language plpgsql security definer set search_path = public as $$
declare v_depts text[];
begin
  select array_agg(distinct f.department_id) into v_depts
  from public.request_fulfilments f where f.id = any(p_parts) and f.organization_id = public.current_organization_id();
  if coalesce(array_length(v_depts, 1), 0) > 1 then
    raise exception 'Order lines from one department at a time.';
  end if;
  if v_depts[1] is not null then
    if not public.in_my_department(v_depts[1]) then raise exception 'Those lines belong to another department.'; end if;
    perform set_config('app.department_id', v_depts[1], true);
  end if;
  return public.purchase_create_po(p_parts);
end $$;
revoke all on function public.purchase_create_po_for_parts(text[]) from public, anon;
grant execute on function public.purchase_create_po_for_parts(text[]) to authenticated;

notify pgrst, 'reload schema';

-- ── Sanity checks ───────────────────────────────────────────────────────────
select 'inventory_items' as table_name, count(*) filter (where department_id is null) as without_department from public.inventory_items
union all select 'purchase_orders', count(*) filter (where department_id is null) from public.purchase_orders
union all select 'request_fulfilments', count(*) filter (where department_id is null) from public.request_fulfilments;
