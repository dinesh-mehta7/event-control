-- ============================================================================
-- v98 · Only the request's own Department Head can review it
-- ----------------------------------------------------------------------------
-- v43 let ANY Department Head review any request (written when there was one IT Head).
-- With several departments, each with its own head, that let unrelated heads approve.
-- Now:
-- 1. A trigger on requests stops a Department Head from deciding a request at the
--    department stage, or assigning its delivery, unless they lead the request's department.
--    (Old requests with no department keep the previous behaviour.)
-- 2. request_submit only notifies that department's head(s), and refuses a department
--    that has no active head, so requests can't get stuck.
-- The Super Admin is not affected.
-- Apply after migration_v97_sub_department_rename_hide.sql.
-- ============================================================================

create or replace function public._request_department_head_guard()
returns trigger language plpgsql set search_path = public as $$
declare me record; v_dept_name text;
begin
  if old.department_id is null then return new; end if;
  select * into me from public.profiles where id = auth.uid();
  if not found or me.level <> 'dept_head' then return new; end if;
  if me.department_id is not distinct from old.department_id then return new; end if;
  if (old.status = 'pending_it' and new.status is distinct from old.status)
     or new.delivery_team is distinct from old.delivery_team
     or new.delivery_member_id is distinct from old.delivery_member_id then
    select name into v_dept_name from public.departments where id = old.department_id;
    raise exception 'Only the Department Head of % can review this request.', coalesce(v_dept_name, 'its department');
  end if;
  return new;
end $$;
drop trigger if exists requests_department_head_guard on public.requests;
create trigger requests_department_head_guard before update on public.requests
  for each row execute function public._request_department_head_guard();

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
  if not exists(select 1 from public.profiles h where h.organization_id=me.organization_id and h.level='dept_head' and h.department_id=p_department_id and h.approved and h.is_active) then
    raise exception 'That department has no active Department Head to review requests. Choose another department or ask the Super Admin to assign one.';
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
  for it in select to_jsonb(h) from public.profiles h where h.organization_id=me.organization_id and h.level='dept_head' and h.department_id=p_department_id and h.approved and h.is_active loop
    perform public._req_notify((it->>'id')::uuid,me.organization_id,'Request to review: '||trim(p_title),num||' from '||me.name,'approval',rid);
  end loop;
  return rid;
end $$;
revoke all on function public.request_submit(text,text,date,text,text,text,jsonb) from public,anon;
grant execute on function public.request_submit(text,text,date,text,text,text,jsonb) to authenticated;

notify pgrst, 'reload schema';
