-- The request's selected department is descriptive/routing data for fulfilment.
-- Every request is reviewed by the organization's IT Department Head, so the
-- review permission must not require the reviewer and requester departments to match.
-- Apply after migrations v41 and v42.

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
  if not exists(select 1 from public.profiles h where h.organization_id=me.organization_id and h.level='dept_head' and h.approved and h.is_active) then
    raise exception 'No active IT Department Head is available to review requests.';
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
  for it in select to_jsonb(h) from public.profiles h where h.organization_id=me.organization_id and h.level='dept_head' and h.approved and h.is_active loop
    perform public._req_notify((it->>'id')::uuid,me.organization_id,'Request to review: '||trim(p_title),num||' from '||me.name,'approval',rid);
  end loop;
  return rid;
end $$;
revoke all on function public.request_submit(text,text,date,text,text,text,jsonb) from public,anon;
grant execute on function public.request_submit(text,text,date,text,text,text,jsonb) to authenticated;

create or replace function public.request_it_decide(p_id text, p_action text, p_note text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; r record; l jsonb; q integer; total numeric;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level <> 'dept_head' then raise exception 'Only the active IT Department Head can review this request.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  -- Do not compare r.department_id to the IT Head's department_id. Requests
  -- deliberately keep the requesting department while the IT Head reviews them.
  if r.status <> 'pending_it' then raise exception 'This request is no longer waiting for the IT Department Head.'; end if;
  if p_action = 'reject' then
    if trim(coalesce(p_note,'')) = '' then raise exception 'Say why you are rejecting it.'; end if;
    update public.requests set status='rejected', it_note=trim(p_note), updated_at=now() where id=p_id;
    perform public._req_event(p_id,'rejected','Rejected by the IT Department Head: '||trim(p_note));
    perform public._req_notify(r.requester_id,r.organization_id,'Request rejected',r.number||' was rejected: '||trim(p_note),'warning',p_id);
    return;
  end if;
  if p_action not in ('approve','escalate') then raise exception 'Choose approve, escalate, or reject.'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Complete the review plan for every item.'; end if;
  if jsonb_array_length(p_lines) <> (select count(*) from public.request_items where request_id=p_id) then raise exception 'Complete the review plan for every item.'; end if;
  update public.request_items set review_plan='[]'::jsonb where request_id=p_id;
  if nullif(p_lines->0->>'misc_budget','') is not null and (p_lines->0->>'misc_budget')::numeric < 0 then raise exception 'Miscellaneous addition cannot be negative.'; end if;
  update public.requests
    set review_misc_budget=coalesce(nullif(p_lines->0->>'misc_budget','')::numeric,0),
        review_misc_items=left(trim(coalesce(p_lines->0->>'misc_items','')),300)
    where id=p_id;
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
    update public.requests set status='pending_owner', it_note=trim(coalesce(p_note,'')), updated_at=now() where id=p_id;
    perform public._req_event(p_id,'escalated','IT Department Head saved the budget and arrangement plan and escalated it to the Super Admin.');
    perform public._req_notify_group(p_id,'owner','Request escalated: '||r.title,r.number||' is ready for your decision.','approval');
    perform public._req_notify(r.requester_id,r.organization_id,'Request escalated',r.number||' was sent to the Super Admin with the IT Department Head plan.','info',p_id);
    return;
  end if;
  total := public._request_commit_review_plan(p_id);
  update public.requests set it_note=trim(coalesce(p_note,'')), updated_at=now() where id=p_id;
end $$;
revoke all on function public.request_it_decide(text,text,text,jsonb) from public, anon;
grant execute on function public.request_it_decide(text,text,text,jsonb) to authenticated;

-- Ensure open requests that predate this routing fix are visible to every
-- active IT Department Head, without duplicating a notification already sent.
do $$
declare r record; h record;
begin
  for r in select id, number, title, organization_id from public.requests where status='pending_it' loop
    for h in select id from public.profiles where organization_id=r.organization_id and level='dept_head' and approved and is_active loop
      if not exists (select 1 from public.notifications n where n.ref_id=r.id and n.user_id=h.id and n.type='approval') then
        perform public._req_notify(h.id,r.organization_id,'Request to review: '||r.title,r.number||' needs your review.','approval',r.id);
      end if;
    end loop;
  end loop;
end $$;

select pg_notify('pgrst','reload schema');
