-- ============================================================================
-- v95 · Fix "column reference "member_id" is ambiguous" when assigning delivery
-- ----------------------------------------------------------------------------
-- request_set_delivery_assignment had a variable called member_id, the same name as
-- manpower_tasks.member_id, so Postgres could not tell them apart. The variable is
-- renamed to v_member. The task helper also gets #variable_conflict use_column, because
-- its task_id variable clashes with the column in "on conflict(task_id, member_id)".
-- Apply after migration_v94_org_profile_and_delete_member.sql.
-- ============================================================================

create or replace function public.request_set_delivery_assignment(p_id text, p_team text, p_member text)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record;
  r record;
  fulfilment record;
  team_name text := nullif(trim(coalesce(p_team,'')), '');
  v_member text := nullif(trim(coalesce(p_member,'')), '');
begin
  select * into me from public.profiles where id=auth.uid();
  if not found or not me.approved or not me.is_active or me.level <> 'dept_head' then
    raise exception 'Only the active IT Department Head can assign delivery.';
  end if;
  select * into r from public.requests where id=p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'approved' then raise exception 'Delivery can only be assigned after final approval.'; end if;
  if (team_name is null) = (v_member is null) then raise exception 'Choose either a team or an IT Sewadar.'; end if;
  if team_name is not null and not exists (
    select 1 from public.manpower_teams t where t.organization_id=r.organization_id and lower(trim(t.name))=lower(team_name)
  ) then raise exception 'Choose a valid delivery team.'; end if;
  if v_member is not null and not exists (
    select 1 from public.accommodation_members m
    where m.id=v_member and m.organization_id=r.organization_id and lower(coalesce(m.department,'')) like '%it%'
  ) then raise exception 'Choose an IT Sewadar from the roster.'; end if;
  if exists (
    select 1 from public.manpower_tasks t
    join public.request_fulfilments existing_fulfilment on existing_fulfilment.id=t.request_fulfilment_id
    where existing_fulfilment.request_id=p_id and t.status <> 'complete'
      and (t.team is distinct from coalesce(team_name,'')
        or t.member_id is distinct from v_member)
  ) then raise exception 'Delivery tasks already exist with another assignee. Update them from Team tasks.'; end if;

  update public.requests
    set delivery_team=coalesce(team_name,''), delivery_member_id=v_member, updated_at=now()
    where id=p_id;

  for fulfilment in
    select rf.id
    from public.request_fulfilments rf
    left join public.purchase_items pi on pi.id=rf.purchase_item_id
    where rf.request_id=p_id and rf.status='planned'
      and (rf.source in ('inventory','walkie') or (rf.source='purchase' and pi.qty_received >= rf.qty))
  loop
    perform public._request_create_delivery_task(fulfilment.id);
  end loop;
end $$;
revoke all on function public.request_set_delivery_assignment(text,text,text) from public, anon;
grant execute on function public.request_set_delivery_assignment(text,text,text) to authenticated;

create or replace function public._request_create_delivery_task(p_fulfilment text)
returns void language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
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

select pg_notify('pgrst','reload schema');
