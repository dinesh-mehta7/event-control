-- Connect approved request fulfilments to the Sewadar task board.
-- The IT Department Head chooses one delivery team or IT Sewadar before approval.
-- Apply after migration_v45_super_admin_three_actions.sql.

alter table public.requests
  add column if not exists delivery_team text not null default '',
  add column if not exists delivery_member_id text references public.accommodation_members(id) on delete set null;

alter table public.manpower_tasks
  add column if not exists request_fulfilment_id text references public.request_fulfilments(id) on delete set null;
create unique index if not exists manpower_tasks_request_fulfilment_uidx
  on public.manpower_tasks(request_fulfilment_id) where request_fulfilment_id is not null;

create or replace function public._manpower_task_is_assigned(p_task text, p_profile uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.manpower_tasks t
    left join public.accommodation_members direct_member on direct_member.id=t.member_id
    where t.id=p_task and direct_member.profile_id=p_profile
  ) or exists (
    select 1 from public.manpower_task_members tm
    join public.accommodation_members m on m.id=tm.member_id
    where tm.task_id=p_task and m.profile_id=p_profile
  );
$$;
revoke all on function public._manpower_task_is_assigned(text,uuid) from public,anon;
grant execute on function public._manpower_task_is_assigned(text,uuid) to authenticated;

do $$
declare fn text := 'public.manpower_tasks_guard()'; def text; updated text;
begin
  def := pg_get_functiondef(fn::regprocedure);
  updated := replace(def,
    'or old.assigned_to is distinct from (select name from public.profiles where id = auth.uid())',
    'or (old.assigned_to is distinct from (select name from public.profiles where id = auth.uid()) and not public._manpower_task_is_assigned(old.id,auth.uid()))');
  if updated=def then raise exception 'Could not allow assigned Sewadars to progress their delivery tasks.'; end if;
  execute updated;
end $$;

drop policy if exists "mp_tasks_update" on public.manpower_tasks;
create policy "mp_tasks_update" on public.manpower_tasks for update
  using (organization_id=public.current_organization_id() and public.current_is_active() and public.current_approved()
    and (public.can_manage_manpower() or assigned_to=(select name from public.profiles where id=auth.uid()) or public._manpower_task_is_assigned(id,auth.uid())))
  with check (organization_id=public.current_organization_id() and public.current_is_active() and public.current_approved());

create or replace function public._request_delivery_task_is_assigned(p_fulfilment text,p_profile uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.manpower_tasks t
    where t.request_fulfilment_id=p_fulfilment
      and (public._manpower_task_is_assigned(t.id,p_profile) or t.assigned_to=(select name from public.profiles where id=p_profile))
  );
$$;
revoke all on function public._request_delivery_task_is_assigned(text,uuid) from public,anon,authenticated;

do $$
declare fn text := 'public.request_deliver(text,text,text,text)'; def text; updated text;
begin
  def := pg_get_functiondef(fn::regprocedure);
  updated := replace(def,
    'if not (me.level in (''owner'',''dept_head'') or me.sub_department = ''walkie'') then',
    'if not (me.level in (''owner'',''dept_head'') or me.sub_department = ''walkie'') and not public._request_delivery_task_is_assigned(p_fulfilment,me.id) then');
  updated := replace(updated,
    'if not (me.level in (''owner'',''dept_head'') or me.sub_department = ''inventory'') then',
    'if not (me.level in (''owner'',''dept_head'') or me.sub_department = ''inventory'') and not public._request_delivery_task_is_assigned(p_fulfilment,me.id) then');
  if updated=def then raise exception 'Could not grant delivery to its assigned Sewadar.'; end if;
  execute updated;
end $$;

create or replace function public.request_complete_delivery_task(p_task text,p_location text,p_received_by text,p_note text)
returns void language plpgsql security definer set search_path=public as $$
declare me record; t record; f record; r record; location_id text;
begin
  select * into me from public.profiles where id=auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into t from public.manpower_tasks where id=p_task and organization_id=me.organization_id for update;
  if not found or t.request_fulfilment_id is null then raise exception 'This is not a request delivery task.'; end if;
  if t.status<>'in_progress' then raise exception 'Start the task before completing it.'; end if;
  if not (public.can_manage_manpower() or t.assigned_to=(select name from public.profiles where id=me.id) or public._manpower_task_is_assigned(t.id,me.id)) then
    raise exception 'Only the assigned Sewadar or a task manager can complete this delivery.';
  end if;
  select * into f from public.request_fulfilments where id=t.request_fulfilment_id;
  if f.source<>'walkie' and nullif(trim(coalesce(p_location,'')),'') is null then
    select * into r from public.requests where id=f.request_id;
    select id into location_id from public.inventory_locations where organization_id=me.organization_id and lower(trim(name))=lower(trim(r.deliver_to)) limit 1;
    if location_id is null then
      location_id := 'loc-' || substr(md5(me.organization_id || ':' || lower(trim(r.deliver_to))),1,18);
      insert into public.inventory_locations(id,organization_id,name) values(location_id,me.organization_id,trim(r.deliver_to)) on conflict do nothing;
      select id into location_id from public.inventory_locations where organization_id=me.organization_id and lower(trim(name))=lower(trim(r.deliver_to)) limit 1;
    end if;
    p_location := location_id;
  end if;
  perform public.request_deliver(t.request_fulfilment_id,p_location,p_received_by,p_note);
  update public.manpower_tasks set status='complete',updated_at=now() where id=t.id;
end $$;
revoke all on function public.request_complete_delivery_task(text,text,text,text) from public,anon;
grant execute on function public.request_complete_delivery_task(text,text,text,text) to authenticated;

create or replace function public.request_set_delivery_assignment(p_id text, p_team text, p_member text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; r record; team_name text := nullif(trim(coalesce(p_team,'')), ''); member_id text := nullif(trim(coalesce(p_member,'')), '');
begin
  select * into me from public.profiles where id=auth.uid();
  if not found or not me.approved or not me.is_active or me.level <> 'dept_head' then
    raise exception 'Only the active IT Department Head can assign delivery.';
  end if;
  select * into r from public.requests where id=p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_it' then raise exception 'Delivery can only be assigned during IT Department Head review.'; end if;
  if (team_name is null) = (member_id is null) then raise exception 'Choose either a team or an IT Sewadar.'; end if;
  if team_name is not null and not exists (
    select 1 from public.manpower_teams t where t.organization_id=r.organization_id and lower(trim(t.name))=lower(team_name)
  ) then raise exception 'Choose a valid delivery team.'; end if;
  if member_id is not null and not exists (
    select 1 from public.accommodation_members m
    where m.id=member_id and m.organization_id=r.organization_id and lower(coalesce(m.department,'')) like '%it%'
  ) then raise exception 'Choose an IT Sewadar from the roster.'; end if;
  update public.requests set delivery_team=coalesce(team_name,''), delivery_member_id=member_id, updated_at=now() where id=p_id;
end $$;
revoke all on function public.request_set_delivery_assignment(text,text,text) from public, anon;
grant execute on function public.request_set_delivery_assignment(text,text,text) to authenticated;

create or replace function public._request_create_delivery_task(p_fulfilment text)
returns void language plpgsql security definer set search_path = public as $$
declare f record; r record; i record; task_id text; task_team text; task_member text; task_assignee text; task_details text;
begin
  select * into f from public.request_fulfilments where id=p_fulfilment;
  if not found or f.status <> 'planned' then return; end if;
  if f.source not in ('inventory','walkie','purchase') then return; end if;
  select * into r from public.requests where id=f.request_id;
  if not found or r.status not in ('approved','fulfilled') then return; end if;
  if coalesce(r.delivery_team,'')='' and r.delivery_member_id is null then return; end if;
  if exists (select 1 from public.manpower_tasks where request_fulfilment_id=f.id) then return; end if;
  if f.source='purchase' then
    if not exists (select 1 from public.purchase_items pi where pi.id=f.purchase_item_id and pi.qty_received >= f.qty) then return; end if;
  end if;
  select * into i from public.request_items where id=f.item_id;
  if not found then return; end if;

  task_id := 'request-delivery-' || substr(md5(random()::text || clock_timestamp()::text),1,18);
  task_team := coalesce(r.delivery_team,'');
  task_member := r.delivery_member_id;
  select m.name into task_assignee from public.accommodation_members m where m.id=task_member and m.organization_id=r.organization_id;
  task_details := 'Deliver ' || f.qty || ' ' || i.unit || ' of ' || i.name || ' to ' || r.deliver_to || ' for ' || r.number || ' · requested by ' || r.requester_name;

  insert into public.manpower_tasks(id,organization_id,title,details,team,assigned_to,member_id,due_date,status,request_fulfilment_id)
  values(task_id,r.organization_id,'Deliver ' || i.name || ' · ' || r.number,task_details,task_team,coalesce(task_assignee,''),task_member,r.needed_by,'todo',f.id);

  if task_member is not null then
    insert into public.manpower_task_members(id,organization_id,task_id,member_id)
    values('request-task-member-' || substr(md5(task_id || task_member),1,18),r.organization_id,task_id,task_member)
    on conflict(task_id,member_id) do nothing;
  elsif task_team <> '' then
    insert into public.manpower_task_members(id,organization_id,task_id,member_id)
    select 'request-task-member-' || substr(md5(task_id || m.id),1,18),r.organization_id,task_id,m.id
    from public.accommodation_members m
    where m.organization_id=r.organization_id
      and (exists(select 1 from unnest(coalesce(m.team_names,'{}'::text[])) as team_names(name) where lower(trim(team_names.name))=lower(task_team))
        or lower(trim(coalesce(m.team_name,'')))=lower(task_team))
    on conflict(task_id,member_id) do nothing;
  end if;
end $$;
revoke all on function public._request_create_delivery_task(text) from public, anon, authenticated;

create or replace function public._request_delivery_tasks_on_approval()
returns trigger language plpgsql security definer set search_path = public as $$
declare f record;
begin
  if new.status='approved' and old.status is distinct from new.status then
    for f in select id from public.request_fulfilments where request_id=new.id and source in ('inventory','walkie') and status='planned' loop
      perform public._request_create_delivery_task(f.id);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists request_delivery_tasks_on_approval on public.requests;
create trigger request_delivery_tasks_on_approval after update of status on public.requests
for each row execute function public._request_delivery_tasks_on_approval();

create or replace function public._request_delivery_task_on_purchase_arrival()
returns trigger language plpgsql security definer set search_path = public as $$
declare f record;
begin
  if new.qty_received <= old.qty_received then return new; end if;
  for f in
    select rf.id from public.request_fulfilments rf
    where rf.purchase_item_id=new.id and rf.source='purchase' and rf.status='planned'
      and new.qty_received >= rf.qty and old.qty_received < rf.qty
  loop
    perform public._request_create_delivery_task(f.id);
  end loop;
  return new;
end $$;
drop trigger if exists request_delivery_task_on_purchase_arrival on public.purchase_items;
create trigger request_delivery_task_on_purchase_arrival after update of qty_received on public.purchase_items
for each row execute function public._request_delivery_task_on_purchase_arrival();

select pg_notify('pgrst','reload schema');
