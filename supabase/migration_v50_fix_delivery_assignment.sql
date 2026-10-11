-- Fix PL/pgSQL record/SQL alias collision in post-approval delivery assignment.
-- Apply after migration_v49_procurement_no_owner_order_approval.sql.

create or replace function public.request_set_delivery_assignment(p_id text, p_team text, p_member text)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record;
  r record;
  fulfilment record;
  team_name text := nullif(trim(coalesce(p_team,'')), '');
  member_id text := nullif(trim(coalesce(p_member,'')), '');
begin
  select * into me from public.profiles where id=auth.uid();
  if not found or not me.approved or not me.is_active or me.level <> 'dept_head' then
    raise exception 'Only the active IT Department Head can assign delivery.';
  end if;
  select * into r from public.requests where id=p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'approved' then raise exception 'Delivery can only be assigned after final approval.'; end if;
  if (team_name is null) = (member_id is null) then raise exception 'Choose either a team or an IT Sewadar.'; end if;
  if team_name is not null and not exists (
    select 1 from public.manpower_teams t where t.organization_id=r.organization_id and lower(trim(t.name))=lower(team_name)
  ) then raise exception 'Choose a valid delivery team.'; end if;
  if member_id is not null and not exists (
    select 1 from public.accommodation_members m
    where m.id=member_id and m.organization_id=r.organization_id and lower(coalesce(m.department,'')) like '%it%'
  ) then raise exception 'Choose an IT Sewadar from the roster.'; end if;
  if exists (
    select 1 from public.manpower_tasks t
    join public.request_fulfilments existing_fulfilment on existing_fulfilment.id=t.request_fulfilment_id
    where existing_fulfilment.request_id=p_id and t.status <> 'complete'
      and (t.team is distinct from coalesce(team_name,'')
        or t.member_id is distinct from member_id)
  ) then raise exception 'Delivery tasks already exist with another assignee. Update them from Team tasks.'; end if;

  update public.requests
    set delivery_team=coalesce(team_name,''), delivery_member_id=member_id, updated_at=now()
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

select pg_notify('pgrst','reload schema');
