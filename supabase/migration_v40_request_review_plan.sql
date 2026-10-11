-- Save the Department Admin's complete review plan before either approving it
-- or escalating the same plan to the Super Admin.
-- Apply after migration_v39_request_arrangement_returns.sql.

alter table public.request_items
  add column if not exists approved_budget numeric(12,2) check (approved_budget is null or approved_budget >= 0),
  add column if not exists review_plan jsonb not null default '[]'::jsonb;
alter table public.requests
  add column if not exists review_misc_budget numeric(12,2) not null default 0 check (review_misc_budget >= 0);
update public.requests r set department_id=p.department_id
from public.profiles p where p.id=r.requester_id and r.department_id is null and p.department_id is not null;

-- Convert legacy per-unit rates into the approved line total where quantity is known.
update public.request_items
set approved_budget = budget_rate * coalesce(qty_approved, qty_requested)
where approved_budget is null and budget_rate is not null;

-- The old escalation did not save its line plan. Put those requests back with the
-- Department Admin so they can be reviewed with a complete plan.
do $$
declare r record; h record;
begin
  for r in select id, title, number, department_id from public.requests where status in ('pending_owner','pending_sub') loop
    update public.requests set status = 'pending_it', updated_at = now() where id = r.id;
    perform public._req_event(r.id, 'reassigned', 'Routed to Department Admin review under the updated request flow.');
    for h in select id from public.profiles where organization_id=(select organization_id from public.requests where id=r.id) and department_id=r.department_id and level='dept_head' and approved and is_active loop
      perform public._req_notify(h.id,(select organization_id from public.requests where id=r.id),'Request to review: '||r.title,r.number||' needs a complete budget and arrangement plan.','approval',r.id);
    end loop;
  end loop;
end $$;

-- A request is routed only to a Department Admin assigned to its selected
-- Walkie-synced department.
create or replace function public.request_submit(
  p_title text, p_purpose text, p_needed_by date, p_priority text, p_deliver_to text, p_department_id text, p_items jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare me record; k integer; rid text; num text; pos integer := 0; it jsonb; inv text;
begin
  select * into me from public.profiles where id=auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if trim(coalesce(p_title,''))='' then raise exception 'Give the request a short title.'; end if;
  if trim(coalesce(p_purpose,''))='' then raise exception 'Say why this is needed.'; end if;
  if trim(coalesce(p_deliver_to,''))='' then raise exception 'Say where it should be delivered.'; end if;
  if nullif(trim(coalesce(p_department_id,'')),'') is null then raise exception 'Choose a department for this request.'; end if;
  if not exists(select 1 from public.departments d where d.id=p_department_id and d.organization_id=me.organization_id) then raise exception 'Choose a valid department from the Walkie Departments list.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0 then raise exception 'Add at least one item.'; end if;
  if jsonb_array_length(p_items)>60 then raise exception 'A request can have at most 60 lines.'; end if;
  if not exists(select 1 from public.profiles h where h.organization_id=me.organization_id and h.department_id=p_department_id and h.level='dept_head' and h.approved and h.is_active) then
    raise exception 'No active Department Admin is assigned to this department.';
  end if;
  insert into public.request_counters(organization_id,n) values(me.organization_id,1)
    on conflict(organization_id) do update set n=public.request_counters.n+1 returning n into k;
  num:='REQ-'||lpad(k::text,4,'0'); rid:='rq-'||substr(md5(random()::text||clock_timestamp()::text),1,16);
  insert into public.requests(id,organization_id,number,requester_id,requester_name,sub_department,department_id,title,purpose,deliver_to,needed_by,priority,status)
  values(rid,me.organization_id,num,me.id,me.name,me.sub_department,p_department_id,trim(p_title),trim(p_purpose),trim(p_deliver_to),p_needed_by,case when p_priority='urgent' then 'urgent' else 'normal' end,'pending_it');
  for it in select value from jsonb_array_elements(p_items) loop
    pos:=pos+1;
    if trim(coalesce(it->>'name',''))='' then raise exception 'Line % has no item name.',pos; end if;
    if coalesce((it->>'qty')::integer,0)<=0 then raise exception 'Line % needs a quantity above zero.',pos; end if;
    if trim(coalesce(it->>'reason',''))='' then raise exception 'Line % (%) needs a reason.',pos,trim(it->>'name'); end if;
    inv:=nullif(it->>'inventory_item_id','');
    if inv is not null and not exists(select 1 from public.inventory_items where id=inv and organization_id=me.organization_id) then inv:=null; end if;
    insert into public.request_items(id,organization_id,request_id,position,kind,name,unit,qty_requested,note,reason,inventory_item_id,return_required)
    values('ri-'||substr(md5(random()::text||clock_timestamp()::text||pos::text),1,16),me.organization_id,rid,pos,case when it->>'kind'='radio' then 'radio' else 'item' end,trim(it->>'name'),coalesce(nullif(trim(it->>'unit'),''),'pcs'),(it->>'qty')::integer,trim(coalesce(it->>'note','')),trim(it->>'reason'),inv,coalesce((it->>'return_required')::boolean,false));
  end loop;
  perform public._req_event(rid,'submitted','Request raised by '||me.name);
  for it in select to_jsonb(h) from public.profiles h where h.organization_id=me.organization_id and h.department_id=p_department_id and h.level='dept_head' and h.approved and h.is_active loop
    perform public._req_notify((it->>'id')::uuid,me.organization_id,'Request to review: '||trim(p_title),num||' from '||me.name,'approval',rid);
  end loop;
  return rid;
end $$;
revoke all on function public.request_submit(text,text,date,text,text,text,jsonb) from public,anon;
grant execute on function public.request_submit(text,text,date,text,text,text,jsonb) to authenticated;

create or replace function public._request_commit_review_plan(p_id text)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  r record; ri record; l jsonb; part jsonb; q integer; planned integer; src text; inv text;
  avail integer; inv_row record; total numeric := 0; purchase_needed boolean := false;
  has_radio boolean := false; has_item boolean := false; any_approved boolean := false;
begin
  select * into r from public.requests where id = p_id for update;
  if not found then raise exception 'Request not found.'; end if;
  if exists (select 1 from public.request_items where request_id = p_id and qty_approved < qty_requested and trim(coalesce(cut_reason,'')) = '') then
    raise exception 'A reason is required for every reduced quantity.';
  end if;
  if exists (select 1 from public.request_items where request_id = p_id and qty_approved > 0 and approved_budget is null) then
    raise exception 'Enter a total budget for every approved item.';
  end if;
  if coalesce((select sum(qty_approved) from public.request_items where request_id = p_id), 0) = 0 then
    raise exception 'Approve at least one item, or reject the request.';
  end if;
  total := total + coalesce(r.review_misc_budget, 0);

  delete from public.request_fulfilments where request_id = p_id and status = 'planned';
  for ri in select * from public.request_items where request_id = p_id order by position for update loop
    total := total + coalesce(ri.approved_budget, 0);
    if coalesce(ri.qty_approved, 0) = 0 then
      if jsonb_array_length(coalesce(ri.review_plan, '[]'::jsonb)) <> 0 then raise exception 'A zero-approved line cannot have an arrangement.'; end if;
      continue;
    end if;
    any_approved := true;
    if jsonb_typeof(ri.review_plan) is distinct from 'array' then raise exception 'Set the stock and purchase split for "%".', ri.name; end if;
    planned := 0;
    for part in select value from jsonb_array_elements(ri.review_plan) loop
      src := part->>'source'; q := (part->>'qty')::integer; inv := nullif(part->>'inventory_item_id','');
      if q is null or q <= 0 then raise exception 'Arrangement quantities must be positive whole numbers.'; end if;
      if ri.kind = 'radio' then
        if src <> 'walkie' then raise exception 'Walkie-talkie requests must be allocated through the Walkie pool.'; end if;
        inv := null;
      elsif src not in ('inventory','purchase') then raise exception 'Choose stock or purchase for "%".', ri.name;
      elsif src = 'inventory' then
        inv := coalesce(inv, ri.inventory_item_id, (select id from public.inventory_items where organization_id = r.organization_id and regexp_replace(lower(trim(name)), '[^a-z0-9]', '', 'g') = regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g') order by id limit 1));
        if inv is null then raise exception 'No matching inventory item was found for "%".', ri.name; end if;
        select * into inv_row from public.inventory_items where id = inv and organization_id = r.organization_id for update;
        if not found or regexp_replace(lower(trim(inv_row.name)), '[^a-z0-9]', '', 'g') <> regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g') then raise exception 'The matching inventory item for "%" is unavailable.', ri.name; end if;
        select available into avail from public.inventory_available() where item_id = inv;
        if q > coalesce(avail,0) then raise exception 'Only % of "%" are currently available.', coalesce(avail,0), ri.name; end if;
      else
        inv := coalesce(inv, ri.inventory_item_id, (select id from public.inventory_items where organization_id = r.organization_id and regexp_replace(lower(trim(name)), '[^a-z0-9]', '', 'g') = regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g') order by id limit 1));
        if inv is null then
          inv := 'it-' || substr(md5(random()::text || clock_timestamp()::text),1,16);
          insert into public.inventory_items (id, organization_id, name, unit) values (inv, r.organization_id, trim(ri.name), coalesce(nullif(trim(ri.unit),''),'pcs'));
        end if;
        purchase_needed := true;
      end if;
      insert into public.request_fulfilments (id, organization_id, request_id, item_id, source, qty, inventory_item_id)
      values ('rf-' || substr(md5(random()::text || clock_timestamp()::text || planned::text),1,16), r.organization_id, r.id, ri.id, src, q, inv);
      planned := planned + q;
      if src = 'walkie' then has_radio := true; elsif ri.kind = 'item' then has_item := true; end if;
    end loop;
    if planned <> ri.qty_approved then raise exception 'The arrangement for "%" must add up to %.', ri.name, ri.qty_approved; end if;
    if ri.kind = 'item' then
      update public.request_items set inventory_item_id = coalesce(inventory_item_id, (select inventory_item_id from public.request_fulfilments where item_id = ri.id and inventory_item_id is not null limit 1)) where id = ri.id;
    end if;
  end loop;
  if not any_approved then raise exception 'Approve at least one item, or reject the request.'; end if;

  update public.requests set status = 'approved', updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'approved', 'Approved with a total budget of ₹' || to_char(total, 'FM999,999,990.00') || ' and the saved stock/purchase plan.');
  perform public._req_notify(r.requester_id, r.organization_id, 'Request approved', r.number || ' was approved with a total budget of ₹' || to_char(total, 'FM999,999,990.00') || '.', 'info', p_id);
  if has_item then perform public._req_notify_group(p_id, 'inventory', 'Approved items to issue: ' || r.title, r.number || ' · stock is reserved and purchase quantities are in Procurement.', 'approval'); end if;
  if has_radio then perform public._req_notify_group(p_id, 'walkie', 'Walkie-talkies approved: ' || r.title, r.number || ' · allocate from the Walkie pool.', 'approval'); end if;
  if purchase_needed then perform public._req_notify_group(p_id, 'purchase', 'Items to order: ' || r.title, r.number || ' · the approved purchase quantities are ready.', 'approval'); end if;
  return total;
end $$;
revoke all on function public._request_commit_review_plan(text) from public, anon, authenticated;

create or replace function public.request_it_decide(p_id text, p_action text, p_note text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; r record; l jsonb; q integer; total numeric;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level <> 'dept_head' then raise exception 'Only an active Department Admin can review this.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.department_id is distinct from me.department_id then raise exception 'This request belongs to another department.'; end if;
  if r.status <> 'pending_it' then raise exception 'This request is no longer waiting for the Department Admin.'; end if;
  if p_action = 'reject' then
    if trim(coalesce(p_note,'')) = '' then raise exception 'Say why you are rejecting it.'; end if;
    update public.requests set status='rejected', it_note=trim(p_note), updated_at=now() where id=p_id;
    perform public._req_event(p_id,'rejected','Rejected by the Department Admin: '||trim(p_note));
    perform public._req_notify(r.requester_id,r.organization_id,'Request rejected',r.number||' was rejected: '||trim(p_note),'warning',p_id);
    return;
  end if;
  if p_action not in ('approve','escalate') then raise exception 'Choose approve, escalate, or reject.'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Complete the review plan for every item.'; end if;
  if jsonb_array_length(p_lines) <> (select count(*) from public.request_items where request_id=p_id) then raise exception 'Complete the review plan for every item.'; end if;
  update public.request_items set review_plan='[]'::jsonb where request_id=p_id;
  if nullif(p_lines->0->>'misc_budget','') is not null and (p_lines->0->>'misc_budget')::numeric < 0 then raise exception 'Miscellaneous addition cannot be negative.'; end if;
  update public.requests set review_misc_budget=coalesce(nullif(p_lines->0->>'misc_budget','')::numeric,0) where id=p_id;
  for l in select value from jsonb_array_elements(p_lines) loop
    q := (l->>'approved_qty')::integer;
    if q is null or q < 0 then raise exception 'Approved quantities must be zero or more.'; end if;
    if not exists (select 1 from public.request_items where id=l->>'id' and request_id=p_id and q <= qty_requested) then raise exception 'An approved quantity exceeds the amount requested.'; end if;
    if q < (select qty_requested from public.request_items where id=l->>'id') and trim(coalesce(l->>'cut_reason','')) = '' then raise exception 'Give a reason for every reduced quantity.'; end if;
    if q > 0 and (nullif(l->>'budget_rate','') is null or (l->>'budget_rate')::numeric < 0) then raise exception 'Enter a non-negative item budget for every approved item.'; end if;
    if q = 0 and jsonb_array_length(coalesce(l->'plan','[]'::jsonb)) > 0 then raise exception 'A zero-approved line cannot have an arrangement.'; end if;
    update public.request_items set qty_approved=q, cut_reason=trim(coalesce(l->>'cut_reason','')), budget_rate=case when q=0 then null else (l->>'budget_rate')::numeric end, approved_budget=case when q=0 then null else q * (l->>'budget_rate')::numeric end, review_plan=coalesce(l->'plan','[]'::jsonb) where id=l->>'id' and request_id=p_id;
  end loop;
  if exists (select 1 from public.request_items where request_id=p_id and qty_approved is null) then raise exception 'Complete the review plan for every item.'; end if;
  if exists (
    select 1 from public.request_items i
    where i.request_id=p_id and coalesce((select sum((part->>'qty')::integer) from jsonb_array_elements(i.review_plan) part),0) <> i.qty_approved
  ) then raise exception 'Each stock and purchase split must add up to the approved quantity.'; end if;
  if exists (
    select 1 from public.request_items i cross join lateral jsonb_array_elements(i.review_plan) part
    where i.request_id=p_id and ((i.kind='radio' and part->>'source'<>'walkie') or (i.kind='item' and part->>'source' not in ('inventory','purchase')) or coalesce((part->>'qty')::integer,0)<=0)
  ) then raise exception 'Choose a valid arrangement source and positive quantity for every item.'; end if;
  if exists (
    select 1 from (
      select i.id, i.name, coalesce(nullif(p.value->>'inventory_item_id',''),i.inventory_item_id) as inventory_id,
             sum((p.value->>'qty')::integer) as quantity
      from public.request_items i cross join lateral jsonb_array_elements(i.review_plan) p(value)
      where i.request_id=p_id and i.kind='item' and p.value->>'source'='inventory'
      group by i.id,i.name,coalesce(nullif(p.value->>'inventory_item_id',''),i.inventory_item_id)
    ) stock
    left join public.inventory_items ii on ii.id=stock.inventory_id and ii.organization_id=(select organization_id from public.requests where id=p_id)
    left join public.inventory_available() av on av.item_id=stock.inventory_id
    where stock.inventory_id is null or ii.id is null
       or regexp_replace(lower(trim(ii.name)),'[^a-z0-9]','','g') <> regexp_replace(lower(trim(stock.name)),'[^a-z0-9]','','g')
       or coalesce(av.available,0) < stock.quantity
  ) then raise exception 'The matching inventory stock is missing or no longer available.'; end if;
  if p_action='escalate' then
    select coalesce(sum(approved_budget),0) + coalesce((select review_misc_budget from public.requests where id=p_id),0) into total from public.request_items where request_id=p_id;
    update public.requests set status='pending_owner', it_note=trim(coalesce(p_note,'')), updated_at=now() where id=p_id;
    perform public._req_event(p_id,'escalated','Department Admin saved the budget and arrangement plan and escalated it to the Super Admin.');
    perform public._req_notify_group(p_id,'owner','Request escalated: '||r.title,r.number||' is ready for your decision.','approval');
    perform public._req_notify(r.requester_id,r.organization_id,'Request escalated',r.number||' was sent to the Super Admin with the Department Admin plan.','info',p_id);
    return;
  end if;
  total := public._request_commit_review_plan(p_id);
  update public.requests set it_note=trim(coalesce(p_note,'')), updated_at=now() where id=p_id;
end $$;
revoke all on function public.request_it_decide(text,text,text,jsonb) from public, anon;
grant execute on function public.request_it_decide(text,text,text,jsonb) to authenticated;

create or replace function public.request_owner_decide(p_id text, p_approve boolean, p_note text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r record; total numeric;
begin
  if not public.is_org_owner() then raise exception 'Only the Super Admin can approve escalated requests.'; end if;
  select * into r from public.requests where id=p_id for update;
  if not found or r.organization_id <> public.current_organization_id() then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_owner' then raise exception 'This request has not been escalated to the Super Admin.'; end if;
  if not p_approve then
    if trim(coalesce(p_note,'')) = '' then raise exception 'Say why you are rejecting it.'; end if;
    update public.requests set status='rejected', owner_note=trim(p_note), updated_at=now() where id=p_id;
    perform public._req_event(p_id,'rejected','Rejected by the Super Admin: '||trim(p_note));
    perform public._req_notify(r.requester_id,r.organization_id,'Request rejected',r.number||' was rejected: '||trim(p_note),'warning',p_id);
    return;
  end if;
  total := public._request_commit_review_plan(p_id);
  update public.requests set owner_note=trim(coalesce(p_note,'')), updated_at=now() where id=p_id;
end $$;
revoke all on function public.request_owner_decide(text,boolean,text,jsonb) from public, anon;
grant execute on function public.request_owner_decide(text,boolean,text,jsonb) to authenticated;

select pg_notify('pgrst','reload schema');
