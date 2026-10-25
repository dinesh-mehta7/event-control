-- ============================================================================
-- v115 · Event walkie requests are approved by the IT department, not by the requester's own
-- ----------------------------------------------------------------------------
-- The radios belong to the IT department (departments.it_services), so its Department Head (or the
-- Super Admin) approves or declines a department's walkie request. Before, the requesting
-- department's own head approved it. The "to approve" notification now goes to the IT head(s).
-- Apply after migration_v114_one_walkie_request_per_event.sql. Safe to re-run.
-- ============================================================================

create or replace function public.event_radio_request_decide(p_id text, p_approve boolean, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare r public.event_radio_requests%rowtype; p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = auth.uid() and organization_id = public.current_organization_id() and is_active and approved;
  if not found then raise exception 'Not allowed.'; end if;
  select * into r from public.event_radio_requests where id=p_id and organization_id=public.current_organization_id() for update;
  if not found then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_approval' then raise exception 'This request has already been reviewed.'; end if;
  if not (p.level = 'owner' or (p.level = 'dept_head' and p.department_id = public._it_department(r.organization_id))) then
    raise exception 'Only the IT Department Head or the Super Admin can approve walkie requests.';
  end if;
  if p_approve then
    update public.event_radio_requests set status='approved', approval_note=coalesce(p_note,''), approved_by=p.id, approved_at=now(), updated_at=now() where id=p_id;
  else
    update public.event_radio_requests set status='rejected', approval_note=coalesce(p_note,''), rejected_by=p.id, rejected_at=now(), updated_at=now() where id=p_id;
  end if;
end $$;
revoke all on function public.event_radio_request_decide(text,boolean,text) from public, anon;
grant execute on function public.event_radio_request_decide(text,boolean,text) to authenticated;

-- The IT head must see the requests to decide them (the select policy only covered the requesting department).
drop policy if exists event_radio_requests_select on public.event_radio_requests;
create policy event_radio_requests_select on public.event_radio_requests for select using (
  organization_id = public.current_organization_id()
  and public.current_is_active() and public.current_approved()
  and (public.current_level() = 'owner' or requester_id = auth.uid()
       or department_id = (select p.department_id from public.profiles p where p.id = auth.uid())
       or (public.current_level() = 'dept_head'
           and (select p.department_id from public.profiles p where p.id = auth.uid()) = public._it_department(organization_id))
       or (public.current_level() = 'sub_dept_head' and public.current_sub_department() = 'walkie'))
);

-- New request → notify the IT Department Head(s); the other steps are unchanged from v112.
create or replace function public._event_radio_request_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare what text;
begin
  what := new.walkie_count || ' walkie(s)' ||
          case when new.charger_count > 0 then ', ' || new.charger_count || ' charger(s)' else '' end ||
          case when new.earphone_count > 0 then ', ' || new.earphone_count || ' earphone(s)' else '' end;
  if tg_op = 'INSERT' then
    insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
    select new.organization_id, p.id, 'Walkie request to approve',
           new.department_name || ' (' || new.requester_name || ') asked for ' || what || '.', 'approval', 'requests/review', new.id
    from public.profiles p
    where p.organization_id = new.organization_id and p.approved and p.is_active and p.id is distinct from new.requester_id
      and p.level = 'dept_head' and p.department_id = public._it_department(new.organization_id);
    return new;
  end if;
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'approved' then
    insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
    values (new.organization_id, new.requester_id, 'Walkie request approved',
            what || ' approved by IT. The Walkie team will allocate them and tell you where to collect.', 'info', 'requests/mine', new.id);
    insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
    select new.organization_id, p.id, 'Walkies to allocate: ' || new.department_name, what || ' approved for ' || new.department_name || '.',
           'approval', 'walkie/requests', new.id
    from public.profiles p
    where p.organization_id = new.organization_id and p.approved and p.is_active and p.sub_department = 'walkie';
  elsif new.status = 'rejected' then
    insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
    values (new.organization_id, new.requester_id, 'Walkie request declined',
            what || ' declined by IT' || case when coalesce(new.approval_note,'') <> '' then ': ' || new.approval_note else '.' end, 'warning', 'requests/mine', new.id);
  elsif new.status = 'ready' then
    insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
    values (new.organization_id, new.requester_id, 'Walkies ready',
            what || ' are ready' || case when coalesce(new.collect_from,'') <> '' then '. Collect from ' || new.collect_from || '.' else '. The Walkie team will hand them over.' end,
            'info', 'requests/mine', new.id);
  elsif new.status = 'delivered' then
    insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
    values (new.organization_id, new.requester_id, 'Walkies handed over',
            what || ' handed over' || case when coalesce(new.signed_by,'') <> '' then ' to ' || new.signed_by else '' end || '. Return them after the event.', 'info', 'requests/mine', new.id);
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
