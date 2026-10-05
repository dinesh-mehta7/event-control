-- Requests approval chain: branch head (when configured) -> IT department head -> organization owner.
-- Run after migration_v27_cctv_wifi_assets.sql. Existing open requests that reached the
-- organization owner before this step are sent back to the IT owner for the missing review.

alter table public.requests add column if not exists it_note text not null default '';
alter table public.requests drop constraint if exists requests_status_check;
alter table public.requests add constraint requests_status_check check (status in
  ('pending_sub','pending_it','pending_owner','approved','fulfilled','rejected','cancelled'));

-- Include the IT department head in the existing notification-group helper.
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
      when 'it_head'   then p.level = 'dept_head'
      when 'sub_head'  then p.level = 'sub_dept_head' and p.sub_department is not distinct from r.sub_department
      when 'inventory' then p.sub_department = 'inventory'
      when 'walkie'    then p.sub_department = 'walkie'
      when 'purchase'  then p.sub_department = 'purchase'
      else false end;
end $$;
revoke all on function public._req_notify_group(text, text, text, text, text) from public, anon, authenticated;

create or replace function public.request_submit(
  p_title text, p_purpose text, p_needed_by date, p_priority text, p_deliver_to text, p_items jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare
  me record; k integer; rid text; num text; pos integer := 0; it jsonb; first_status text; has_head boolean; inv text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if trim(coalesce(p_title, '')) = '' then raise exception 'Give the request a short title.'; end if;
  if trim(coalesce(p_purpose, '')) = '' then raise exception 'Say why this is needed.'; end if;
  if trim(coalesce(p_deliver_to, '')) = '' then raise exception 'Say where it should be delivered.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item.'; end if;
  if jsonb_array_length(p_items) > 60 then raise exception 'A request can have at most 60 lines.'; end if;

  select exists (select 1 from public.profiles h where h.organization_id = me.organization_id and h.level = 'sub_dept_head'
                 and h.sub_department is not distinct from me.sub_department and h.approved and h.is_active and h.id <> me.id) into has_head;
  first_status := case
    when me.level = 'owner' then 'pending_owner'
    when me.level = 'dept_head' then 'pending_owner'
    when me.level = 'sub_dept_head' or me.sub_department is null then 'pending_it'
    when has_head then 'pending_sub'
    else 'pending_it' end;

  insert into public.request_counters (organization_id, n) values (me.organization_id, 1)
    on conflict (organization_id) do update set n = public.request_counters.n + 1 returning n into k;
  num := 'REQ-' || lpad(k::text, 4, '0');
  rid := 'rq-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  insert into public.requests (id, organization_id, number, requester_id, requester_name, sub_department, title, purpose, deliver_to, needed_by, priority, status)
  values (rid, me.organization_id, num, me.id, me.name, me.sub_department, trim(p_title), trim(p_purpose), trim(p_deliver_to), p_needed_by,
          case when p_priority = 'urgent' then 'urgent' else 'normal' end, first_status);

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
  if first_status = 'pending_sub' then
    perform public._req_notify_group(rid, 'sub_head', 'Request to review: ' || trim(p_title), num || ' from ' || me.name, 'approval');
  elsif first_status = 'pending_it' then
    perform public._req_notify_group(rid, 'it_head', 'Request for IT review: ' || trim(p_title), num || ' from ' || me.name, 'approval');
  else
    perform public._req_notify_group(rid, 'owner', 'Request to approve: ' || trim(p_title), num || ' from ' || me.name || ' · ' || jsonb_array_length(p_items) || ' item(s)', 'approval');
  end if;
  return rid;
end $$;
revoke all on function public.request_submit(text, text, date, text, text, jsonb) from public, anon;
grant execute on function public.request_submit(text, text, date, text, text, jsonb) to authenticated;

create or replace function public.request_sub_review(p_id text, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; r record;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_sub' then raise exception 'This request is not waiting for the branch head.'; end if;
  if not (public.is_org_owner() or (me.level = 'sub_dept_head' and me.sub_department is not distinct from r.sub_department)) then
    raise exception 'Only the head of the requesting branch can review this.';
  end if;
  if not p_approve and trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting it.'; end if;
  update public.requests set status = case when p_approve then 'pending_it' else 'rejected' end, sub_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
  perform public._req_event(p_id, case when p_approve then 'sub_approved' else 'rejected' end,
    (case when p_approve then 'Approved by branch head' else 'Rejected by branch head' end) || case when trim(coalesce(p_note, '')) <> '' then ': ' || trim(p_note) else '' end);
  if p_approve then
    perform public._req_notify_group(p_id, 'it_head', 'Request for IT review: ' || r.title, r.number || ' from ' || r.requester_name, 'approval');
    perform public._req_notify(r.requester_id, r.organization_id, 'Request moved on', r.number || ' was approved by the branch head and sent to the IT owner.', 'info', p_id);
  else
    perform public._req_notify(r.requester_id, r.organization_id, 'Request rejected', r.number || ' was rejected: ' || trim(p_note), 'warning', p_id);
  end if;
end $$;
revoke all on function public.request_sub_review(text, boolean, text) from public, anon;
grant execute on function public.request_sub_review(text, boolean, text) to authenticated;

create or replace function public.request_it_review(p_id text, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; r record;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if me.level <> 'dept_head' and not public.is_org_owner() then raise exception 'Only the IT department owner can review this.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_it' then raise exception 'This request is not waiting for IT review.'; end if;
  if not p_approve and trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting it.'; end if;
  update public.requests set status = case when p_approve then 'pending_owner' else 'rejected' end, it_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
  perform public._req_event(p_id, case when p_approve then 'it_approved' else 'rejected' end,
    (case when p_approve then 'Approved by IT department owner' else 'Rejected by IT department owner' end) || case when trim(coalesce(p_note, '')) <> '' then ': ' || trim(p_note) else '' end);
  if p_approve then
    perform public._req_notify_group(p_id, 'owner', 'Final request approval: ' || r.title, r.number || ' has IT approval and is ready for your decision.', 'approval');
    perform public._req_notify(r.requester_id, r.organization_id, 'Request moved on', r.number || ' was approved by the IT owner and sent for final approval.', 'info', p_id);
  else
    perform public._req_notify(r.requester_id, r.organization_id, 'Request rejected', r.number || ' was rejected by the IT owner: ' || trim(p_note), 'warning', p_id);
  end if;
end $$;
revoke all on function public.request_it_review(text, boolean, text) from public, anon;
grant execute on function public.request_it_review(text, boolean, text) to authenticated;

create or replace function public.request_owner_review(p_id text, p_approve boolean, p_note text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r record; l jsonb; q integer; total integer; has_radio boolean; has_item boolean; summ text;
begin
  if not public.is_org_owner() then raise exception 'Only the Organization Head can approve requests.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> public.current_organization_id() then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_owner' then raise exception 'This request is not ready for the organization owner.'; end if;
  if not p_approve then
    if trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting it.'; end if;
    update public.requests set status = 'rejected', owner_note = trim(p_note), updated_at = now() where id = p_id;
    perform public._req_event(p_id, 'rejected', 'Rejected by the organization owner: ' || trim(p_note));
    perform public._req_notify(r.requester_id, r.organization_id, 'Request rejected', r.number || ' was rejected. Reason: ' || trim(p_note), 'warning', p_id);
    return;
  end if;
  update public.request_items set qty_approved = qty_requested, cut_reason = '' where request_id = p_id;
  if jsonb_typeof(p_lines) = 'array' then
    for l in select * from jsonb_array_elements(p_lines) loop
      q := (l->>'qty')::integer;
      if q is null or q < 0 then raise exception 'Approved quantity cannot be negative.'; end if;
      update public.request_items set qty_approved = least(q, qty_requested), cut_reason = trim(coalesce(l->>'reason', '')) where id = l->>'id' and request_id = p_id;
    end loop;
  end if;
  if exists (select 1 from public.request_items where request_id = p_id and qty_approved < qty_requested and trim(cut_reason) = '') then
    raise exception 'Give a reason for every line you reduce or leave out.';
  end if;
  update public.request_items set cut_reason = '' where request_id = p_id and qty_approved >= qty_requested;
  select coalesce(sum(qty_approved), 0) into total from public.request_items where request_id = p_id;
  if total = 0 then raise exception 'Approve at least one line, or reject the request.'; end if;
  select string_agg(i.name || ' ' || i.qty_approved || ' of ' || i.qty_requested || case when i.qty_approved < i.qty_requested then ' (' || i.cut_reason || ')' else '' end, '; ' order by i.position)
    into summ from public.request_items i where i.request_id = p_id;
  update public.requests set status = 'approved', owner_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'approved', 'Approved by the organization owner: ' || summ || case when trim(coalesce(p_note, '')) <> '' then '. Note: ' || trim(p_note) else '' end);
  select bool_or(kind = 'radio' and qty_approved > 0), bool_or(kind = 'item' and qty_approved > 0) into has_radio, has_item from public.request_items where request_id = p_id;
  perform public._req_notify(r.requester_id, r.organization_id, 'Request approved', r.number || ' approved: ' || summ, 'info', p_id);
  if has_item then perform public._req_notify_group(p_id, 'inventory', 'Approved list to arrange: ' || r.title, r.number || ' · split it into stock and purchase', 'approval'); end if;
  if has_radio then perform public._req_notify_group(p_id, 'walkie', 'Radios approved: ' || r.title, r.number || ' · allocate from the radio pool', 'approval'); end if;
end $$;
revoke all on function public.request_owner_review(text, boolean, text, jsonb) from public, anon;
grant execute on function public.request_owner_review(text, boolean, text, jsonb) to authenticated;

create or replace function public.request_cancel(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.requests where id = p_id for update;
  if not found or r.requester_id is distinct from auth.uid() then raise exception 'Only the person who raised it can cancel it.'; end if;
  if r.status not in ('pending_sub','pending_it','pending_owner') then raise exception 'It is already decided, so it can no longer be cancelled.'; end if;
  update public.requests set status = 'cancelled', updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'cancelled', 'Cancelled by the requester');
end $$;
revoke all on function public.request_cancel(text) from public, anon;
grant execute on function public.request_cancel(text) to authenticated;

-- Current open requests have not had the IT owner's review yet.
update public.requests r set status = 'pending_it', updated_at = now()
where r.status = 'pending_owner'
  and exists (select 1 from public.profiles p where p.id = r.requester_id and p.level not in ('owner','dept_head'));
do $$
declare r record;
begin
  for r in select id, title, number from public.requests where status = 'pending_it' loop
    perform public._req_notify_group(r.id, 'it_head', 'Request for IT review: ' || r.title, r.number || ' is awaiting IT approval.', 'approval');
  end loop;
end $$;
