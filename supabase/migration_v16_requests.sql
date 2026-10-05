-- ============================================================================
-- migration_v16_requests.sql
-- The request flow:  requester -> sub-department head -> Organization Head
--                    -> Inventory / Walkie team splits the APPROVED list
--                    -> issued from stock  and/or  ordered through Purchase.
--
-- Run AFTER migration_v15. Safe to run more than once.
--
-- RULES (enforced here, not only in the screens):
--   * Requesters never read inventory. They only see their own requests.
--   * Every change goes through the functions below; nobody writes the tables directly.
--   * The Organization Head sets the approved quantity per line (never above what was asked).
--   * Stock is reserved only when the Inventory team confirms the split.
--   * A purchase order made from a request needs no second approval (the owner already signed off).
--   * Also in this file: set_meeting_status now checks approved / active like create_meeting does.
-- ============================================================================

-- 0. Helpers ------------------------------------------------------------------
create or replace function public.current_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select name from public.profiles where id = auth.uid()), 'System');
$$;

-- Which team does the caller belong to (null when not approved / active).
create or replace function public.req_team()
returns text language sql stable security definer set search_path = public as $$
  select case when p.approved and p.is_active then coalesce(p.sub_department, '') end
  from public.profiles p where p.id = auth.uid();
$$;
create or replace function public.req_is_exec()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved and is_active and level in ('owner','dept_head') from public.profiles where id = auth.uid()), false);
$$;

-- 1. Tables -------------------------------------------------------------------
create table if not exists public.request_counters (
  organization_id text primary key references public.organizations(id) on delete cascade,
  n integer not null default 0
);

create table if not exists public.requests (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  number          text not null default '',
  requester_id    uuid not null references public.profiles(id) on delete cascade,
  requester_name  text not null default '',
  sub_department  text,                                   -- requester's department (null = outside the IT sub-departments)
  title           text not null check (length(trim(title)) > 0),
  purpose         text not null default '',               -- why it is needed
  deliver_to      text not null default '',               -- where it should be delivered
  needed_by       date,
  priority        text not null default 'normal' check (priority in ('normal','urgent')),
  status          text not null default 'pending_sub' check (status in
                    ('pending_sub','pending_owner','approved','fulfilled','rejected','cancelled')),
  sub_note        text not null default '',
  owner_note      text not null default '',
  share_token     text unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists requests_org_idx on public.requests (organization_id, created_at desc);
create index if not exists requests_requester_idx on public.requests (requester_id);
create unique index if not exists requests_org_number_uidx on public.requests (organization_id, number) where number <> '';

create table if not exists public.request_items (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  request_id      text not null references public.requests(id) on delete cascade,
  position        integer not null default 0,
  kind            text not null default 'item' check (kind in ('item','radio')),   -- radio = walkie-talkies
  name            text not null check (length(trim(name)) > 0),
  unit            text not null default 'pcs',
  qty_requested   integer not null check (qty_requested > 0),
  qty_approved    integer check (qty_approved >= 0),
  note            text not null default ''
);
create index if not exists request_items_req_idx on public.request_items (request_id);

-- One approved line can be split: some from stock, some bought, radios from the Walkie pool.
create table if not exists public.request_fulfilments (
  id                text primary key,
  organization_id   text not null references public.organizations(id) on delete cascade,
  request_id        text not null references public.requests(id) on delete cascade,
  item_id           text not null references public.request_items(id) on delete cascade,
  source            text not null check (source in ('inventory','purchase','walkie')),
  qty               integer not null check (qty > 0),
  inventory_item_id text references public.inventory_items(id) on delete set null,
  purchase_item_id  text references public.purchase_items(id) on delete set null,
  status            text not null default 'planned' check (status in ('planned','done')),
  location_name     text not null default '',
  received_by       text not null default '',
  note              text not null default '',
  done_by           text,
  done_at           timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists request_fulfilments_req_idx on public.request_fulfilments (request_id);
create index if not exists request_fulfilments_inv_idx on public.request_fulfilments (inventory_item_id) where status = 'planned';

create table if not exists public.request_events (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  request_id      text not null references public.requests(id) on delete cascade,
  at              timestamptz not null default now(),
  actor_id        uuid,
  actor_name      text not null default '',
  kind            text not null default 'note',
  text            text not null default ''
);
create index if not exists request_events_req_idx on public.request_events (request_id, at);

-- Purchase orders remember which request they were raised for.
alter table public.purchase_orders add column if not exists request_id text references public.requests(id) on delete set null;
create index if not exists purchase_orders_request_idx on public.purchase_orders (request_id) where request_id is not null;

-- 2. Who may see a request ------------------------------------------------------
-- requester; the requester's sub-department head; owner / IT head;
-- the Inventory, Walkie and Purchase teams once it is approved.
create or replace function public.can_see_request(r public.requests)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.approved and p.is_active and r.organization_id = p.organization_id and (
         r.requester_id = p.id
      or p.level in ('owner','dept_head')
      or (p.level = 'sub_dept_head' and p.sub_department is not distinct from r.sub_department)
      or (r.status in ('approved','fulfilled') and p.sub_department in ('inventory','walkie','purchase'))
    ) from public.profiles p where p.id = auth.uid()
  ), false);
$$;

alter table public.request_counters     enable row level security;   -- no policies: functions only
alter table public.requests             enable row level security;
alter table public.request_items        enable row level security;
alter table public.request_fulfilments  enable row level security;
alter table public.request_events       enable row level security;

drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests for select using (public.can_see_request(requests));

do $$
declare t text;
begin
  foreach t in array array['request_items','request_fulfilments','request_events'] loop
    execute format('drop policy if exists "%1$s_select" on public.%1$I', t);
    execute format('create policy "%1$s_select" on public.%1$I for select using (exists (select 1 from public.requests r where r.id = %1$I.request_id and public.can_see_request(r)))', t);
  end loop;
end $$;

-- Nobody writes these tables from the browser.
revoke insert, update, delete on public.requests, public.request_items, public.request_fulfilments, public.request_events from anon, authenticated;
revoke all on public.request_counters from anon, authenticated;

-- 3. Small internal helpers -----------------------------------------------------
create or replace function public._req_event(p_req text, p_kind text, p_text text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.request_events (id, organization_id, request_id, actor_id, actor_name, kind, text)
  select 'ev-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), r.organization_id, r.id, auth.uid(), public.current_name(), p_kind, coalesce(p_text, '')
  from public.requests r where r.id = p_req;
  -- Also into the organization-wide audit log (history), so the owner sees requests there too.
  insert into public.history (id, action, details, type, organization_id)
  select 'hist-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16),
         'Request ' || r.number || ' · ' || p_kind, public.current_name() || ': ' || coalesce(p_text, ''),
         case when p_kind in ('rejected','cancelled') then 'warning' when p_kind in ('fulfilled','approved') then 'success' else 'info' end,
         r.organization_id
  from public.requests r where r.id = p_req;
end $$;
revoke all on function public._req_event(text, text, text) from public, anon, authenticated;

create or replace function public._req_notify(p_user uuid, p_org text, p_title text, p_msg text, p_type text, p_req text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select p_org, p_user, p_title, p_msg, p_type, 'requests/' || p_req, p_req
  where p_user is not null and p_user is distinct from auth.uid();
$$;
revoke all on function public._req_notify(uuid, text, text, text, text, text) from public, anon, authenticated;

-- Tell everyone in a group (owner / IT head / sub-department team) about a request.
create or replace function public._req_notify_group(p_req text, p_who text, p_title text, p_msg text, p_type text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.requests where id = p_req;
  if not found then return; end if;
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select r.organization_id, p.id, p_title, p_msg, p_type, 'requests/' || r.id, r.id
  from public.profiles p
  where p.organization_id = r.organization_id and p.approved and p.is_active and p.id is distinct from auth.uid()
    and case p_who
      when 'owner'     then p.level = 'owner'
      when 'sub_head'  then p.level = 'sub_dept_head' and p.sub_department is not distinct from r.sub_department
      when 'inventory' then p.sub_department = 'inventory'
      when 'walkie'    then p.sub_department = 'walkie'
      when 'purchase'  then p.sub_department = 'purchase'
      else false end;
end $$;
revoke all on function public._req_notify_group(text, text, text, text, text) from public, anon, authenticated;

-- 4. Submit ----------------------------------------------------------------------
-- p_items: [{ "name": "...", "unit": "pcs", "qty": 5, "kind": "item" | "radio", "note": "" }]
create or replace function public.request_submit(
  p_title text, p_purpose text, p_needed_by date, p_priority text, p_deliver_to text, p_items jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare
  me record; k integer; rid text; num text; pos integer := 0; it jsonb; first_status text; has_head boolean;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if trim(coalesce(p_title, '')) = '' then raise exception 'Give the request a short title.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item.'; end if;
  if jsonb_array_length(p_items) > 60 then raise exception 'A request can have at most 60 lines.'; end if;

  -- Heads and the owner skip the first step; so does anyone with no sub-department head to ask.
  select exists (select 1 from public.profiles h where h.organization_id = me.organization_id and h.level = 'sub_dept_head'
                 and h.sub_department is not distinct from me.sub_department and h.approved and h.is_active and h.id <> me.id) into has_head;
  first_status := case when me.level in ('owner','dept_head','sub_dept_head') or me.sub_department is null or not has_head
                       then 'pending_owner' else 'pending_sub' end;

  insert into public.request_counters (organization_id, n) values (me.organization_id, 1)
    on conflict (organization_id) do update set n = public.request_counters.n + 1 returning n into k;
  num := 'REQ-' || lpad(k::text, 4, '0');
  rid := 'rq-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);

  insert into public.requests (id, organization_id, number, requester_id, requester_name, sub_department, title, purpose, deliver_to, needed_by, priority, status)
  values (rid, me.organization_id, num, me.id, me.name, me.sub_department, trim(p_title), trim(coalesce(p_purpose, '')),
          trim(coalesce(p_deliver_to, '')), p_needed_by, case when p_priority = 'urgent' then 'urgent' else 'normal' end, first_status);

  for it in select * from jsonb_array_elements(p_items) loop
    pos := pos + 1;
    if trim(coalesce(it->>'name', '')) = '' then raise exception 'Line % has no item name.', pos; end if;
    if coalesce((it->>'qty')::integer, 0) <= 0 then raise exception 'Line % needs a quantity above zero.', pos; end if;
    insert into public.request_items (id, organization_id, request_id, position, kind, name, unit, qty_requested, note)
    values ('ri-' || substr(md5(random()::text || clock_timestamp()::text || pos::text), 1, 16), me.organization_id, rid, pos,
            case when it->>'kind' = 'radio' then 'radio' else 'item' end, trim(it->>'name'),
            coalesce(nullif(trim(it->>'unit'), ''), 'pcs'), (it->>'qty')::integer, trim(coalesce(it->>'note', '')));
  end loop;

  perform public._req_event(rid, 'submitted', 'Request raised by ' || me.name);
  if first_status = 'pending_sub' then
    perform public._req_notify_group(rid, 'sub_head', 'Request to review: ' || trim(p_title), num || ' from ' || me.name, 'approval');
  else
    perform public._req_notify_group(rid, 'owner', 'Request to approve: ' || trim(p_title), num || ' from ' || me.name, 'approval');
  end if;
  return rid;
end $$;
revoke all on function public.request_submit(text, text, date, text, text, jsonb) from public, anon;
grant execute on function public.request_submit(text, text, date, text, text, jsonb) to authenticated;

-- 5. Sub-department head: approve (forward to the owner) or reject ----------------
create or replace function public.request_sub_review(p_id text, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; r record;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_sub' then raise exception 'This request is not waiting for the sub-department head.'; end if;
  if not (me.level in ('owner','dept_head') or (me.level = 'sub_dept_head' and me.sub_department is not distinct from r.sub_department)) then
    raise exception 'Only the head of the requesting department can review this.';
  end if;
  if not p_approve and trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting it.'; end if;

  update public.requests set status = case when p_approve then 'pending_owner' else 'rejected' end,
         sub_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
  perform public._req_event(p_id, case when p_approve then 'sub_approved' else 'rejected' end,
    (case when p_approve then 'Approved by sub-department head' else 'Rejected by sub-department head' end)
    || case when trim(coalesce(p_note, '')) <> '' then ': ' || trim(p_note) else '' end);
  if p_approve then
    perform public._req_notify_group(p_id, 'owner', 'Request to approve: ' || r.title, r.number || ' from ' || r.requester_name, 'approval');
    perform public._req_notify(r.requester_id, r.organization_id, 'Request moved on', r.number || ' was approved by your department head and sent to the owner.', 'info', p_id);
  else
    perform public._req_notify(r.requester_id, r.organization_id, 'Request rejected', r.number || ' was rejected: ' || trim(p_note), 'warning', p_id);
  end if;
end $$;
revoke all on function public.request_sub_review(text, boolean, text) from public, anon;
grant execute on function public.request_sub_review(text, boolean, text) to authenticated;

-- 6. Owner: set the approved quantity per line, or reject ---------------------------
-- p_lines: [{ "id": "<request item id>", "qty": 3 }]   (omitted lines are approved in full)
create or replace function public.request_owner_review(p_id text, p_approve boolean, p_note text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r record; l jsonb; q integer; total integer; has_radio boolean; has_item boolean;
begin
  if not public.is_org_owner() then raise exception 'Only the Organization Head can approve requests.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> public.current_organization_id() then raise exception 'Request not found.'; end if;
  if r.status not in ('pending_owner', 'pending_sub') then raise exception 'This request has already been decided.'; end if;

  if not p_approve then
    if trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting it.'; end if;
    update public.requests set status = 'rejected', owner_note = trim(p_note), updated_at = now() where id = p_id;
    perform public._req_event(p_id, 'rejected', 'Rejected by the owner: ' || trim(p_note));
    perform public._req_notify(r.requester_id, r.organization_id, 'Request rejected', r.number || ' was rejected: ' || trim(p_note), 'warning', p_id);
    return;
  end if;

  update public.request_items set qty_approved = qty_requested where request_id = p_id;
  if jsonb_typeof(p_lines) = 'array' then
    for l in select * from jsonb_array_elements(p_lines) loop
      q := (l->>'qty')::integer;
      if q is null or q < 0 then raise exception 'Approved quantity cannot be negative.'; end if;
      update public.request_items set qty_approved = least(q, qty_requested) where id = l->>'id' and request_id = p_id;
    end loop;
  end if;
  select coalesce(sum(qty_approved), 0) into total from public.request_items where request_id = p_id;
  if total = 0 then raise exception 'Approve at least one line, or reject the request.'; end if;

  update public.requests set status = 'approved', owner_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'approved', 'Approved by the owner' || case when trim(coalesce(p_note, '')) <> '' then ': ' || trim(p_note) else '' end);
  select bool_or(kind = 'radio' and qty_approved > 0), bool_or(kind = 'item' and qty_approved > 0) into has_radio, has_item from public.request_items where request_id = p_id;
  perform public._req_notify(r.requester_id, r.organization_id, 'Request approved', r.number || ' was approved. The store will now arrange it.', 'info', p_id);
  if has_item then perform public._req_notify_group(p_id, 'inventory', 'Approved list to arrange: ' || r.title, r.number || ' · split it into stock and purchase', 'approval'); end if;
  if has_radio then perform public._req_notify_group(p_id, 'walkie', 'Radios approved: ' || r.title, r.number || ' · allocate from the radio pool', 'approval'); end if;
end $$;
revoke all on function public.request_owner_review(text, boolean, text, jsonb) from public, anon;
grant execute on function public.request_owner_review(text, boolean, text, jsonb) to authenticated;

-- 7. Requester cancels --------------------------------------------------------------
create or replace function public.request_cancel(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.requests where id = p_id for update;
  if not found or r.requester_id is distinct from auth.uid() then raise exception 'Only the person who raised it can cancel it.'; end if;
  if r.status not in ('pending_sub','pending_owner') then raise exception 'It is already decided, so it can no longer be cancelled.'; end if;
  update public.requests set status = 'cancelled', updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'cancelled', 'Cancelled by the requester');
end $$;
revoke all on function public.request_cancel(text) from public, anon;
grant execute on function public.request_cancel(text) to authenticated;

-- 8. Stock available to plan against (in store minus what is already promised) ------
create or replace function public.inventory_available()
returns table (item_id text, in_stock integer, reserved integer, available integer)
language sql stable security definer set search_path = public as $$
  select i.id, i.in_stock,
         coalesce(x.res, 0)::integer,
         greatest(i.in_stock - coalesce(x.res, 0), 0)::integer
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
    and (public.req_is_exec() or public.req_team() in ('inventory','purchase'));
$$;
revoke all on function public.inventory_available() from public, anon;
grant execute on function public.inventory_available() to authenticated;

-- 9. Plan one approved line --------------------------------------------------------
-- p_plan: [{ "source": "inventory" | "purchase" | "walkie", "qty": 4, "inventory_item_id": "..." }]
-- Replaces every NOT-yet-delivered part of the line. Parts already delivered stay.
create or replace function public.request_plan_line(p_item text, p_plan jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record; ri record; r record; part jsonb; src text; q integer; inv text; done_qty integer; planned_qty integer := 0;
  avail integer; it record;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into ri from public.request_items where id = p_item;
  if not found then raise exception 'Line not found.'; end if;
  select * into r from public.requests where id = ri.request_id for update;
  if r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'approved' then raise exception 'Only an approved request can be arranged.'; end if;
  if not (me.level in ('owner','dept_head')
          or (ri.kind = 'item'  and me.sub_department = 'inventory')
          or (ri.kind = 'radio' and me.sub_department = 'walkie')) then
    raise exception 'Only the % team can arrange this line.', case when ri.kind = 'radio' then 'Walkie-Talkie' else 'Inventory' end;
  end if;
  if coalesce(ri.qty_approved, 0) = 0 then raise exception 'This line was not approved.'; end if;
  if jsonb_typeof(p_plan) is distinct from 'array' or jsonb_array_length(p_plan) = 0 then raise exception 'Add at least one part.'; end if;

  select coalesce(sum(qty), 0) into done_qty from public.request_fulfilments where item_id = p_item and status = 'done';
  -- Free this line's earlier plan so it does not block itself.
  delete from public.request_fulfilments where item_id = p_item and status = 'planned';

  for part in select * from jsonb_array_elements(p_plan) loop
    src := part->>'source'; q := (part->>'qty')::integer; inv := nullif(part->>'inventory_item_id', '');
    if q is null or q <= 0 then raise exception 'Every part needs a quantity above zero.'; end if;
    if src not in ('inventory','purchase','walkie') then raise exception 'Unknown source.'; end if;
    if ri.kind = 'radio' and src = 'inventory' then raise exception 'Radios come from the Walkie pool or are purchased.'; end if;
    if ri.kind = 'item' and src = 'walkie' then raise exception 'Only radio lines can be allocated from the Walkie pool.'; end if;
    if src in ('inventory','purchase') and ri.kind = 'item' and inv is null then raise exception 'Pick the inventory item for "%".', ri.name; end if;
    if inv is not null then
      select * into it from public.inventory_items where id = inv and organization_id = r.organization_id;
      if not found then raise exception 'That inventory item does not exist.'; end if;
    end if;
    if src = 'inventory' then
      select a.available into avail from public.inventory_available() a where a.item_id = inv;
      if q > coalesce(avail, 0) then raise exception 'Only % of "%" can still be promised from stock.', coalesce(avail, 0), it.name; end if;
    end if;
    insert into public.request_fulfilments (id, organization_id, request_id, item_id, source, qty, inventory_item_id)
    values ('rf-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), r.organization_id, r.id, p_item, src, q, inv);
    planned_qty := planned_qty + q;
  end loop;

  if done_qty + planned_qty <> ri.qty_approved then
    raise exception 'The parts add up to %, but % was approved.', done_qty + planned_qty, ri.qty_approved;
  end if;
  perform public._req_event(r.id, 'planned', 'Arranged "' || ri.name || '": ' ||
    (select string_agg(x.s || ' ' || x.q, ' + ') from (
       select (p->>'source') as s, (p->>'qty') as q from jsonb_array_elements(p_plan) p) x));
  if exists (select 1 from jsonb_array_elements(p_plan) p where p->>'source' = 'purchase') then
    perform public._req_notify_group(r.id, 'purchase', 'Items to order: ' || r.title, r.number || ' · raise a purchase order', 'approval');
  end if;
end $$;
revoke all on function public.request_plan_line(text, jsonb) from public, anon;
grant execute on function public.request_plan_line(text, jsonb) to authenticated;

-- 10. Purchase team: one draft PO from every planned purchase part of a request -------
create or replace function public.request_create_po(p_request text)
returns text language plpgsql security definer set search_path = public as $$
declare me record; r record; f record; po_id text; pos integer := 0; pi_id text; n integer;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if not (me.level in ('owner','dept_head') or me.sub_department = 'purchase') then raise exception 'Only the Purchase team can raise the order.'; end if;
  select * into r from public.requests where id = p_request for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'approved' then raise exception 'This request is not open for ordering.'; end if;

  select count(*) into n from public.request_fulfilments where request_id = p_request and source = 'purchase' and status = 'planned' and purchase_item_id is null;
  if n = 0 then raise exception 'Nothing is waiting to be ordered for this request.'; end if;

  po_id := 'po-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  insert into public.purchase_orders (id, organization_id, title, requested_by, deliver_to, expected_date, status, notes, request_id)
  values (po_id, r.organization_id, r.number || ' · ' || r.title, r.requester_name, r.deliver_to, r.needed_by, 'draft',
          'Raised from request ' || r.number || '. Already approved by the owner.', r.id);

  for f in select f.*, ri.name as line_name, ri.unit as line_unit
           from public.request_fulfilments f join public.request_items ri on ri.id = f.item_id
           where f.request_id = p_request and f.source = 'purchase' and f.status = 'planned' and f.purchase_item_id is null
           order by ri.position loop
    pos := pos + 1;
    pi_id := 'pi-' || substr(md5(random()::text || clock_timestamp()::text || pos::text), 1, 16);
    insert into public.purchase_items (id, organization_id, po_id, inventory_item_id, name, unit, qty_ordered, rate, position)
    values (pi_id, r.organization_id, po_id, f.inventory_item_id, f.line_name, f.line_unit, f.qty, 0, pos);
    update public.request_fulfilments set purchase_item_id = pi_id where id = f.id;
  end loop;

  perform public._req_event(p_request, 'po_created', 'Purchase order raised for the items that are not in stock');
  perform public._req_notify(r.requester_id, r.organization_id, 'Items are being ordered', r.number || ': what was not in stock is being purchased.', 'info', p_request);
  return po_id;
end $$;
revoke all on function public.request_create_po(text) from public, anon;
grant execute on function public.request_create_po(text) to authenticated;

-- 11. Hand over a part (issue from stock, or confirm a radio allocation) ---------------
create or replace function public.request_deliver(p_fulfilment text, p_location text, p_received_by text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record; f record; r record; ri record; loc_id text; loc_name text; got integer := 0; open_parts integer;
  all_done boolean;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into f from public.request_fulfilments where id = p_fulfilment for update;
  if not found then raise exception 'Part not found.'; end if;
  select * into r from public.requests where id = f.request_id for update;
  select * into ri from public.request_items where id = f.item_id;
  if r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if f.status = 'done' then raise exception 'Already handed over.'; end if;
  if r.status <> 'approved' then raise exception 'This request is not open.'; end if;

  if ri.kind = 'radio' then
    -- Radios: the Walkie team confirms the allocation (from the pool, or once the purchased radios arrive).
    if not (me.level in ('owner','dept_head') or me.sub_department = 'walkie') then raise exception 'Only the Walkie-Talkie team can confirm radios.'; end if;
    if f.source = 'purchase' then
      if f.purchase_item_id is null then raise exception 'The purchase order has not been raised yet.'; end if;
      select coalesce(qty_received, 0) into got from public.purchase_items where id = f.purchase_item_id;
      if coalesce(got, 0) < f.qty then raise exception 'Only % of % have arrived so far.', coalesce(got, 0), f.qty; end if;
    end if;
    update public.request_fulfilments set status = 'done', location_name = trim(coalesce(p_location, '')), received_by = trim(coalesce(p_received_by, '')),
           note = trim(coalesce(p_note, '')), done_by = me.name, done_at = now() where id = f.id;
  else
    if not (me.level in ('owner','dept_head') or me.sub_department = 'inventory') then raise exception 'Only the Inventory team can issue stock.'; end if;
    if f.inventory_item_id is null then raise exception 'This part is not linked to an inventory item.'; end if;
    if f.source = 'purchase' then
      if f.purchase_item_id is null then raise exception 'The purchase order has not been raised yet.'; end if;
      select coalesce(qty_received, 0) into got from public.purchase_items where id = f.purchase_item_id;
      if coalesce(got, 0) < f.qty then raise exception 'Only % of % have arrived so far.', coalesce(got, 0), f.qty; end if;
    end if;
    loc_id := nullif(trim(coalesce(p_location, '')), '');
    if loc_id is null then raise exception 'Choose where it is being sent.'; end if;
    select name into loc_name from public.inventory_locations where id = loc_id and organization_id = r.organization_id;
    if loc_name is null then raise exception 'That location does not exist.'; end if;
    perform set_config('app.request_issue', '1', true);
    insert into public.inventory_movements (id, organization_id, item_id, type, qty, location, given_by, received_by, ref, note, done_by)
    values ('mv-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), r.organization_id, f.inventory_item_id, 'issue', f.qty, loc_id,
            me.name, trim(coalesce(p_received_by, '')), r.number, 'Request ' || r.number || ' · ' || ri.name, me.name);
    update public.request_fulfilments set status = 'done', location_name = loc_name, received_by = trim(coalesce(p_received_by, '')),
           note = trim(coalesce(p_note, '')), done_by = me.name, done_at = now() where id = f.id;
  end if;

  perform public._req_event(r.id, 'delivered', 'Handed over ' || f.qty || ' × ' || ri.name || ' (' || f.source || ')' ||
    case when coalesce(trim(p_received_by), '') <> '' then ' to ' || trim(p_received_by) else '' end);

  -- Finished when every approved line is fully delivered.
  select not exists (
    select 1 from public.request_items i
    where i.request_id = r.id and coalesce(i.qty_approved, 0) > 0
      and coalesce((select sum(x.qty) from public.request_fulfilments x where x.item_id = i.id and x.status = 'done'), 0) < i.qty_approved
  ) into all_done;
  if all_done then
    update public.requests set status = 'fulfilled', updated_at = now() where id = r.id;
    perform public._req_event(r.id, 'fulfilled', 'Everything approved has been delivered');
    perform public._req_notify(r.requester_id, r.organization_id, 'Request fulfilled', r.number || ' has been delivered.', 'info', r.id);
  end if;
end $$;
revoke all on function public.request_deliver(text, text, text, text) from public, anon;
grant execute on function public.request_deliver(text, text, text, text) to authenticated;

-- 12. Direct stock issues cannot take what a request has already reserved -----------------
create or replace function public.inventory_reserve_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare avail integer;
begin
  if new.type <> 'issue' then return new; end if;
  if coalesce(current_setting('app.request_issue', true), '') = '1' then return new; end if;
  select a.available into avail from (
    select i.in_stock - coalesce((
      select sum(case when f.source = 'inventory' then f.qty else least(f.qty, coalesce(pi.qty_received, 0)) end)
      from public.request_fulfilments f left join public.purchase_items pi on pi.id = f.purchase_item_id
      where f.status = 'planned' and f.inventory_item_id = i.id), 0) as available
    from public.inventory_items i where i.id = new.item_id) a;
  if avail is not null and new.qty > avail then
    raise exception 'Only % can be issued right now; the rest is reserved for approved requests.', greatest(avail, 0);
  end if;
  return new;
end $$;
-- Named so it fires BEFORE the ledger trigger (inventory_apply_movement): triggers of the same kind run in name
-- order, and this check must see the stock as it was before the issue is booked.
drop trigger if exists inventory_reserve_guard on public.inventory_movements;
drop trigger if exists inventory_a0_reserve_guard on public.inventory_movements;
create trigger inventory_a0_reserve_guard before insert on public.inventory_movements
  for each row execute function public.inventory_reserve_guard();

-- 13. Purchase orders raised from a request skip the second approval --------------------
-- Purchase fills vendor + rates in the draft, then "sends for approval"; because the owner
-- already approved the request, the order goes straight to approved.
create or replace function public.purchase_orders_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare from_req boolean;
begin
  if pg_trigger_depth() > 1 then return new; end if;   -- internal updates (receiving / paying)

  new.po_number := old.po_number; new.created_by := old.created_by;
  new.organization_id := old.organization_id; new.paid_amount := old.paid_amount;
  new.request_id := old.request_id;
  from_req := old.request_id is not null;

  if new.status is distinct from old.status then
    if new.status = 'pending' then
      if old.status not in ('draft','rejected') then raise exception 'Only a draft or rejected order can be sent for approval.'; end if;
      if not exists (select 1 from public.purchase_items where po_id = old.id) then raise exception 'Add at least one item first.'; end if;
      if new.vendor_id is null then raise exception 'Choose a vendor first.'; end if;
      if from_req then new.status := 'approved'; end if;    -- owner already approved this on the request
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
    new.approved_by := case when from_req then 'Owner (via request)' else coalesce((select name from public.profiles where id = auth.uid()), 'System') end;
    new.approved_at := now();
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

-- 14. Share a request as a read-only link (the owner can switch it off) ---------------------
create or replace function public.request_share(p_id text, p_on boolean)
returns text language plpgsql security definer set search_path = public as $$
declare r public.requests; tok text;
begin
  select * into r from public.requests where id = p_id for update;
  if not found or not public.can_see_request(r) then raise exception 'Request not found.'; end if;
  if not (r.requester_id = auth.uid() or public.req_is_exec()) then raise exception 'Only the requester, the owner or the IT head can share this.'; end if;
  if p_on then
    tok := coalesce(r.share_token, replace(gen_random_uuid()::text, '-', '') || substr(md5(random()::text), 1, 8));
    update public.requests set share_token = tok where id = p_id;
    perform public._req_event(p_id, 'shared', 'Read-only link turned on');
    return tok;
  end if;
  update public.requests set share_token = null where id = p_id;
  perform public._req_event(p_id, 'shared', 'Read-only link turned off');
  return null;
end $$;
revoke all on function public.request_share(text, boolean) from public, anon;
grant execute on function public.request_share(text, boolean) to authenticated;

-- Anyone holding the link can read this one request (no email, no internal ids).
create or replace function public.get_shared_request(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r record; out jsonb;
begin
  if p_token is null or length(p_token) < 20 then return null; end if;
  select * into r from public.requests where share_token = p_token;
  if not found then return null; end if;
  select jsonb_build_object(
    'number', r.number, 'title', r.title, 'purpose', r.purpose, 'deliverTo', r.deliver_to, 'neededBy', r.needed_by,
    'priority', r.priority, 'status', r.status, 'requester', r.requester_name, 'createdAt', r.created_at,
    'subNote', r.sub_note, 'ownerNote', r.owner_note,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'name', i.name, 'unit', i.unit, 'kind', i.kind, 'requested', i.qty_requested, 'approved', i.qty_approved,
        'parts', coalesce((select jsonb_agg(jsonb_build_object('source', f.source, 'qty', f.qty, 'status', f.status) order by f.created_at)
                           from public.request_fulfilments f where f.item_id = i.id), '[]'::jsonb)
      ) order by i.position) from public.request_items i where i.request_id = r.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'by', e.actor_name, 'kind', e.kind, 'text', e.text) order by e.at)
                        from public.request_events e where e.request_id = r.id), '[]'::jsonb)
  ) into out;
  return out;
end $$;
revoke all on function public.get_shared_request(text) from public;
grant execute on function public.get_shared_request(text) to anon, authenticated;

-- 15. Meetings: a disabled / unapproved person can no longer change one (matches create_meeting) --
create or replace function public.set_meeting_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; m record;
begin
  if p_status not in ('scheduled','live','done','cancelled') then raise exception 'Unknown status.'; end if;
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into m from public.meetings where id = p_id;
  if not found or m.organization_id is distinct from me.organization_id then raise exception 'Meeting not found.'; end if;
  if not (m.created_by = me.id or me.level in ('owner','dept_head')) then raise exception 'Only the person who called it, or the owner / IT head, can change this meeting.'; end if;
  update public.meetings set status = p_status where id = p_id;
  if p_status = 'cancelled' and m.status <> 'cancelled' then
    insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
    select m.organization_id, r, 'Cancelled: ' || m.title, 'This meeting was cancelled by ' || me.name || '.', 'warning', 'meetings', m.id::text
    from public.meeting_recipients(p_id) r;
  end if;
end $$;
revoke all on function public.set_meeting_status(uuid, text) from public, anon;
grant execute on function public.set_meeting_status(uuid, text) to authenticated;

-- 16. Realtime ------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['requests','request_items','request_fulfilments','request_events'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

notify pgrst, 'reload schema';
