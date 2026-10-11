-- Requests now start with the Department Admin. They can approve with a budget,
-- reject, or explicitly escalate to the Super Admin. Requests also retain the
-- selected Walkie department ID so names and channels stay live-synced.
-- Run after migration_v36_department_admin_arrangement.sql.

alter table public.requests
  add column if not exists department_id text references public.departments(id) on delete set null;
alter table public.request_items
  add column if not exists budget_rate numeric(12,2) check (budget_rate is null or budget_rate >= 0);
update public.requests r set department_id = p.department_id
from public.profiles p where p.id = r.requester_id and r.department_id is null and p.department_id is not null;

create or replace function public.request_submit(
  p_title text, p_purpose text, p_needed_by date, p_priority text, p_deliver_to text, p_department_id text, p_items jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare
  me record; k integer; rid text; num text; pos integer := 0; it jsonb; inv text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if trim(coalesce(p_title, '')) = '' then raise exception 'Give the request a short title.'; end if;
  if trim(coalesce(p_purpose, '')) = '' then raise exception 'Say why this is needed.'; end if;
  if trim(coalesce(p_deliver_to, '')) = '' then raise exception 'Say where it should be delivered.'; end if;
  if nullif(trim(coalesce(p_department_id, '')), '') is null then raise exception 'Choose a department for this request.'; end if;
  if not exists (select 1 from public.departments d where d.id = p_department_id and d.organization_id = me.organization_id) then raise exception 'Choose a valid department from the Walkie Departments list.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item.'; end if;
  if jsonb_array_length(p_items) > 60 then raise exception 'A request can have at most 60 lines.'; end if;
  if not exists (select 1 from public.profiles h where h.organization_id = me.organization_id and h.level = 'dept_head' and h.approved and h.is_active) then
    raise exception 'No active Department Admin is available to review requests.';
  end if;

  insert into public.request_counters (organization_id, n) values (me.organization_id, 1)
    on conflict (organization_id) do update set n = public.request_counters.n + 1 returning n into k;
  num := 'REQ-' || lpad(k::text, 4, '0');
  rid := 'rq-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  insert into public.requests (id, organization_id, number, requester_id, requester_name, sub_department, department_id, title, purpose, deliver_to, needed_by, priority, status)
  values (rid, me.organization_id, num, me.id, me.name, me.sub_department, p_department_id, trim(p_title), trim(p_purpose), trim(p_deliver_to), p_needed_by,
          case when p_priority = 'urgent' then 'urgent' else 'normal' end, 'pending_it');

  for it in select * from jsonb_array_elements(p_items) loop
    pos := pos + 1;
    if trim(coalesce(it->>'name', '')) = '' then raise exception 'Line % has no item name.', pos; end if;
    if coalesce((it->>'qty')::integer, 0) <= 0 then raise exception 'Line % needs a quantity above zero.', pos; end if;
    if trim(coalesce(it->>'reason', '')) = '' then raise exception 'Line % (%) needs a reason.', pos, trim(it->>'name'); end if;
    inv := nullif(it->>'inventory_item_id', '');
    if inv is not null and not exists (select 1 from public.inventory_items where id = inv and organization_id = me.organization_id) then inv := null; end if;
    insert into public.request_items (id, organization_id, request_id, position, kind, name, unit, qty_requested, note, reason, inventory_item_id)
    values ('ri-' || substr(md5(random()::text || clock_timestamp()::text || pos::text), 1, 16), me.organization_id, rid, pos,
            case when it->>'kind' = 'radio' then 'radio' else 'item' end, trim(it->>'name'), coalesce(nullif(trim(it->>'unit'), ''), 'pcs'),
            (it->>'qty')::integer, trim(coalesce(it->>'note', '')), trim(it->>'reason'), inv);
  end loop;

  perform public._req_event(rid, 'submitted', 'Request raised by ' || me.name);
  perform public._req_notify_group(rid, 'it_head', 'Request to review: ' || trim(p_title), num || ' from ' || me.name, 'approval');
  return rid;
end $$;
revoke all on function public.request_submit(text, text, date, text, text, text, jsonb) from public, anon;
grant execute on function public.request_submit(text, text, date, text, text, text, jsonb) to authenticated;

create or replace function public.request_it_decide(p_id text, p_action text, p_note text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; r record; l jsonb; q integer; total numeric;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if me.level <> 'dept_head' then raise exception 'Only a Department Admin can review this.'; end if;
  if coalesce(p_action, '') not in ('approve','escalate','reject') then raise exception 'Choose approve, escalate, or reject.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_it' then raise exception 'This request is no longer waiting for the Department Admin.'; end if;

  if p_action = 'reject' then
    if trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting it.'; end if;
    update public.requests set status = 'rejected', it_note = trim(p_note), updated_at = now() where id = p_id;
    perform public._req_event(p_id, 'rejected', 'Rejected by the Department Admin: ' || trim(p_note));
    perform public._req_notify(r.requester_id, r.organization_id, 'Request rejected', r.number || ' was rejected: ' || trim(p_note), 'warning', p_id);
    return;
  elsif p_action = 'escalate' then
    update public.requests set status = 'pending_owner', it_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
    perform public._req_event(p_id, 'escalated', 'Escalated to the Super Admin by the Department Admin' || case when trim(coalesce(p_note, '')) <> '' then ': ' || trim(p_note) else '' end);
    perform public._req_notify_group(p_id, 'owner', 'Request escalated: ' || r.title, r.number || ' needs your review.', 'approval');
    perform public._req_notify(r.requester_id, r.organization_id, 'Request escalated', r.number || ' was sent to the Super Admin for review.', 'info', p_id);
    return;
  end if;

  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Add a budget for each requested item.'; end if;
  update public.request_items set qty_approved = qty_requested, cut_reason = '' where request_id = p_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    if not (l ? 'budget_rate') or nullif(l->>'budget_rate', '') is null then raise exception 'Enter a budget per unit for every item.'; end if;
    if (l->>'budget_rate')::numeric < 0 then raise exception 'Budget cannot be negative.'; end if;
    update public.request_items set budget_rate = (l->>'budget_rate')::numeric where id = l->>'id' and request_id = p_id;
  end loop;
  if exists (select 1 from public.request_items where request_id = p_id and budget_rate is null) then raise exception 'Enter a budget per unit for every item.'; end if;
  select coalesce(sum(qty_requested * budget_rate), 0) into total from public.request_items where request_id = p_id;
  update public.requests set status = 'approved', it_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'approved', 'Approved by the Department Admin with a total budget of ₹' || to_char(total, 'FM999,999,990.00') || case when trim(coalesce(p_note, '')) <> '' then '. Note: ' || trim(p_note) else '' end);
  perform public._req_notify(r.requester_id, r.organization_id, 'Request approved', r.number || ' was approved with a budget of ₹' || to_char(total, 'FM999,999,990.00') || ' and is being arranged.', 'info', p_id);
  if exists (select 1 from public.request_items where request_id = p_id and kind = 'item' and qty_approved > 0) then
    perform public._req_notify_group(p_id, 'inventory', 'Approved list to arrange: ' || r.title, r.number || ' · choose stock or purchase', 'approval');
  end if;
  if exists (select 1 from public.request_items where request_id = p_id and kind = 'radio' and qty_approved > 0) then
    perform public._req_notify_group(p_id, 'walkie', 'Radios approved: ' || r.title, r.number || ' · allocate from the radio pool', 'approval');
  end if;
end $$;
revoke all on function public.request_it_decide(text, text, text, jsonb) from public, anon;
grant execute on function public.request_it_decide(text, text, text, jsonb) to authenticated;

-- Keep the previous RPC name safe for older app clients; approve now means escalate.
create or replace function public.request_it_review(p_id text, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.request_it_decide(p_id, case when p_approve then 'escalate' else 'reject' end, p_note, '[]'::jsonb);
end $$;
revoke all on function public.request_it_review(text, boolean, text) from public, anon;
grant execute on function public.request_it_review(text, boolean, text) to authenticated;

create or replace function public.request_owner_decide(p_id text, p_approve boolean, p_note text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r record; l jsonb; q integer; total integer; has_radio boolean; has_item boolean; summ text; budget numeric;
begin
  if not public.is_org_owner() then raise exception 'Only the Super Admin can approve escalated requests.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> public.current_organization_id() then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_owner' then raise exception 'This request has not been escalated to the Super Admin.'; end if;
  if not p_approve then
    if trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting it.'; end if;
    update public.requests set status = 'rejected', owner_note = trim(p_note), updated_at = now() where id = p_id;
    perform public._req_event(p_id, 'rejected', 'Rejected by the Super Admin: ' || trim(p_note));
    perform public._req_notify(r.requester_id, r.organization_id, 'Request rejected', r.number || ' was rejected. Reason: ' || trim(p_note), 'warning', p_id);
    return;
  end if;
  update public.request_items set qty_approved = qty_requested, cut_reason = '' where request_id = p_id;
  if jsonb_typeof(p_lines) = 'array' then
    for l in select * from jsonb_array_elements(p_lines) loop
      q := (l->>'qty')::integer;
      if q is null or q < 0 then raise exception 'Approved quantity cannot be negative.'; end if;
      if not (l ? 'budget_rate') or nullif(l->>'budget_rate', '') is null then raise exception 'Enter a budget per unit for every approved item.'; end if;
      if (l->>'budget_rate')::numeric < 0 then raise exception 'Budget cannot be negative.'; end if;
      update public.request_items set qty_approved = least(q, qty_requested), cut_reason = trim(coalesce(l->>'reason', '')), budget_rate = (l->>'budget_rate')::numeric where id = l->>'id' and request_id = p_id;
    end loop;
  end if;
  if exists (select 1 from public.request_items where request_id = p_id and qty_approved < qty_requested and trim(cut_reason) = '') then
    raise exception 'Give a reason for every line you reduce or leave out.';
  end if;
  if exists (select 1 from public.request_items where request_id = p_id and qty_approved > 0 and budget_rate is null) then
    raise exception 'Enter a budget per unit for every approved item.';
  end if;
  update public.request_items set cut_reason = '' where request_id = p_id and qty_approved >= qty_requested;
  select coalesce(sum(qty_approved), 0), coalesce(sum(qty_approved * budget_rate), 0) into total, budget from public.request_items where request_id = p_id;
  if total = 0 then raise exception 'Approve at least one line, or reject the request.'; end if;
  select string_agg(i.name || ' ' || i.qty_approved || ' of ' || i.qty_requested || case when i.qty_approved < i.qty_requested then ' (' || i.cut_reason || ')' else '' end, '; ' order by i.position)
    into summ from public.request_items i where i.request_id = p_id;
  update public.requests set status = 'approved', owner_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'approved', 'Approved by the Super Admin with a total budget of ₹' || to_char(budget, 'FM999,999,990.00') || ': ' || summ || case when trim(coalesce(p_note, '')) <> '' then '. Note: ' || trim(p_note) else '' end);
  select bool_or(kind = 'radio' and qty_approved > 0), bool_or(kind = 'item' and qty_approved > 0) into has_radio, has_item from public.request_items where request_id = p_id;
  perform public._req_notify(r.requester_id, r.organization_id, 'Request approved', r.number || ' approved with a budget of ₹' || to_char(budget, 'FM999,999,990.00') || ': ' || summ, 'info', p_id);
  if has_item then perform public._req_notify_group(p_id, 'inventory', 'Approved list to arrange: ' || r.title, r.number || ' · choose stock or purchase', 'approval'); end if;
  if has_radio then perform public._req_notify_group(p_id, 'walkie', 'Radios approved: ' || r.title, r.number || ' · allocate from the radio pool', 'approval'); end if;
end $$;
revoke all on function public.request_owner_decide(text, boolean, text, jsonb) from public, anon;
grant execute on function public.request_owner_decide(text, boolean, text, jsonb) to authenticated;

-- Existing requests waiting on Sub Admins now go directly to the Department Admin.
do $$
declare r record;
begin
  for r in select id, title, number from public.requests where status = 'pending_sub' loop
    update public.requests set status = 'pending_it', updated_at = now() where id = r.id;
    perform public._req_event(r.id, 'reassigned', 'Moved to the Department Admin review queue by the request-flow update.');
    perform public._req_notify_group(r.id, 'it_head', 'Request to review: ' || r.title, r.number || ' is awaiting the Department Admin.', 'approval');
  end loop;
end $$;

select pg_notify('pgrst', 'reload schema');
