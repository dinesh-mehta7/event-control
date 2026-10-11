-- Event radio request lifecycle: request -> one department/owner approval ->
-- consolidated allocation -> delivery -> return + feedback.
-- Run after migration_v33_event_planning.sql.

alter table public.profiles add column if not exists department_id text references public.departments(id) on delete set null;
alter table public.departments add column if not exists code text;
alter table public.walkies add column if not exists is_rented boolean not null default false;
alter table public.allocations add column if not exists event_radio_request_id text;

create or replace function public.department_set_channel(p_department_id text, p_channel text)
returns void language plpgsql security definer set search_path = public as $$
declare normalized text;
begin
  if auth.uid() is null or not public.current_is_active() or not public.current_approved() or public.current_role()='Client' then
    raise exception 'Only active non-member accounts can set department channels.';
  end if;
  normalized := trim(coalesce(p_channel,''));
  if normalized = '' then raise exception 'Channel cannot be empty.'; end if;
  if exists(select 1 from public.departments where organization_id=public.current_organization_id() and id<>p_department_id and lower(channel_number)=lower(normalized)) then
    raise exception 'That channel is already assigned to another department.';
  end if;
  update public.departments set channel_number=normalized where id=p_department_id and organization_id=public.current_organization_id();
  if not found then raise exception 'Department not found.'; end if;
  update public.walkies set channel=normalized where department_id=p_department_id and organization_id=public.current_organization_id() and status='Allocated';
end $$;

create table if not exists public.event_radio_requests (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text not null,
  department_id text not null references public.departments(id) on delete restrict,
  department_name text not null,
  requester_id uuid not null references public.profiles(id),
  requester_name text not null default '',
  walkie_count integer not null check (walkie_count > 0),
  charger_count integer not null default 0 check (charger_count >= 0),
  earphone_count integer not null default 0 check (earphone_count >= 0),
  status text not null default 'pending_approval' check (status in ('pending_approval','approved','rejected','ready','delivered','partial_return','returned')),
  approval_note text not null default '',
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  rejected_by uuid references public.profiles(id),
  rejected_at timestamptz,
  allocated_walkie_ids jsonb not null default '[]'::jsonb,
  allocated_at timestamptz,
  delivered_walkies integer not null default 0 check (delivered_walkies >= 0),
  delivered_chargers integer not null default 0 check (delivered_chargers >= 0),
  delivered_earphones integer not null default 0 check (delivered_earphones >= 0),
  delivered_at timestamptz,
  signed_by text not null default '',
  returned_walkies integer not null default 0 check (returned_walkies >= 0),
  returned_chargers integer not null default 0 check (returned_chargers >= 0),
  returned_earphones integer not null default 0 check (returned_earphones >= 0),
  returned_at timestamptz,
  return_feedback text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (event_id, organization_id) references public.event_plans(id, organization_id) on delete cascade
);
create index if not exists event_radio_requests_event_idx on public.event_radio_requests(organization_id,event_id,department_name);
create index if not exists event_radio_requests_department_idx on public.event_radio_requests(organization_id,department_id,status);
alter table public.event_radio_requests enable row level security;

drop policy if exists event_radio_requests_select on public.event_radio_requests;
create policy event_radio_requests_select on public.event_radio_requests for select using (
  organization_id = public.current_organization_id()
  and public.current_is_active() and public.current_approved()
  and (public.current_level() = 'owner' or requester_id = auth.uid()
       or department_id = (select p.department_id from public.profiles p where p.id = auth.uid())
       or (public.current_level() = 'sub_dept_head' and public.current_sub_department() = 'walkie'))
);
drop policy if exists event_radio_requests_insert on public.event_radio_requests;
create policy event_radio_requests_insert on public.event_radio_requests for insert with check (false);
drop policy if exists event_radio_requests_update on public.event_radio_requests;
create policy event_radio_requests_update on public.event_radio_requests for update using (false) with check (false);
drop policy if exists event_radio_requests_delete on public.event_radio_requests;
create policy event_radio_requests_delete on public.event_radio_requests for delete using (false);

create or replace function public.event_radio_request_submit(p_event_id text, p_walkies integer, p_chargers integer, p_earphones integer)
returns text language plpgsql security definer set search_path = public as $$
declare p public.profiles%rowtype; d public.departments%rowtype; ev public.event_plans%rowtype; rid text;
begin
  select * into p from public.profiles where id = auth.uid() and organization_id = public.current_organization_id() and is_active and approved;
  if not found or p.role = 'Client' or p.level not in ('dept_head','sub_dept_head','owner') then raise exception 'Only department leads and admins can request event radios.'; end if;
  if p.department_id is null and p.level <> 'owner' then raise exception 'Ask an admin to assign your department first.'; end if;
  if p_walkies <= 0 or p_chargers < 0 or p_earphones < 0 then raise exception 'Enter valid whole-number quantities.'; end if;
  if p.level = 'owner' and p.department_id is null then raise exception 'Select the department this request is for.'; end if;
  select * into d from public.departments where id = p.department_id and organization_id = p.organization_id;
  if not found then raise exception 'Your assigned department could not be found.'; end if;
  select * into ev from public.event_plans where id = p_event_id and organization_id = p.organization_id and status <> 'cancelled';
  if not found then raise exception 'Select an active event.'; end if;
  rid := 'radio-' || gen_random_uuid()::text;
  insert into public.event_radio_requests(id,organization_id,event_id,department_id,department_name,requester_id,requester_name,walkie_count,charger_count,earphone_count)
  values(rid,p.organization_id,p_event_id,d.id,d.name,p.id,p.name,p_walkies,p_chargers,p_earphones);
  return rid;
end $$;

create or replace function public.event_radio_request_decide(p_id text, p_approve boolean, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare r public.event_radio_requests%rowtype; p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = auth.uid() and organization_id = public.current_organization_id() and is_active and approved;
  select * into r from public.event_radio_requests where id=p_id and organization_id=public.current_organization_id() for update;
  if not found then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_approval' then raise exception 'This request has already been reviewed.'; end if;
  if not (p.level='owner' or (p.level='dept_head' and p.department_id=r.department_id)) then raise exception 'Only this department owner or the Super Admin can decide.'; end if;
  if p_approve then
    update public.event_radio_requests set status='approved', approval_note=coalesce(p_note,''), approved_by=p.id, approved_at=now(), updated_at=now() where id=p_id;
  else
    update public.event_radio_requests set status='rejected', approval_note=coalesce(p_note,''), rejected_by=p.id, rejected_at=now(), updated_at=now() where id=p_id;
  end if;
end $$;

create or replace function public.event_radio_request_allocate(p_id text, p_walkie_ids jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r public.event_radio_requests%rowtype;
begin
  if not (public.current_role() in ('Admin','Operator') and (public.current_level()='owner' or (public.current_level()='sub_dept_head' and public.current_sub_department()='walkie'))) then raise exception 'Walkie team access required.'; end if;
  select * into r from public.event_radio_requests where id=p_id and organization_id=public.current_organization_id() for update;
  if not found or r.status <> 'approved' then raise exception 'Only approved requests can be allocated.'; end if;
  if jsonb_array_length(coalesce(p_walkie_ids,'[]'::jsonb)) <> r.walkie_count then raise exception 'Allocated radio count must match the approved request.'; end if;
  if (select count(*) from public.walkies where organization_id=public.current_organization_id() and department_id=r.department_id and status='Allocated'
      and id in (select jsonb_array_elements_text(coalesce(p_walkie_ids,'[]'::jsonb)))) <> r.walkie_count then
    raise exception 'Selected radios must already be allocated to this department.';
  end if;
  update public.event_radio_requests set status='ready', allocated_walkie_ids=p_walkie_ids, allocated_at=now(), updated_at=now() where id=p_id;
end $$;

create or replace function public.event_radio_request_deliver(p_id text, p_signed_by text default '')
returns void language plpgsql security definer set search_path = public as $$
declare r public.event_radio_requests%rowtype;
begin
  if not (public.current_role() in ('Admin','Operator') and (public.current_level()='owner' or (public.current_level()='sub_dept_head' and public.current_sub_department()='walkie'))) then raise exception 'Walkie team access required.'; end if;
  update public.event_radio_requests set status='delivered', delivered_walkies=walkie_count, delivered_chargers=charger_count, delivered_earphones=earphone_count, delivered_at=now(), signed_by=coalesce(p_signed_by,''), updated_at=now()
  where id=p_id and organization_id=public.current_organization_id() and status='ready';
  if not found then raise exception 'Only ready requests can be marked delivered.'; end if;
end $$;

create or replace function public.event_radio_request_return(p_id text, p_walkie_ids jsonb, p_walkies integer, p_chargers integer, p_earphones integer, p_feedback text default '')
returns void language plpgsql security definer set search_path = public as $$
declare r public.event_radio_requests%rowtype; nw integer; nc integer; ne integer; ns text; changed integer;
begin
  if not (public.current_role() in ('Admin','Operator') and (public.current_level()='owner' or (public.current_level()='sub_dept_head' and public.current_sub_department()='walkie'))) then raise exception 'Walkie team access required.'; end if;
  select * into r from public.event_radio_requests where id=p_id and organization_id=public.current_organization_id() for update;
  if not found or r.status not in ('delivered','partial_return') then raise exception 'This request has no delivered items to return.'; end if;
  nw := r.returned_walkies + p_walkies; nc := r.returned_chargers + p_chargers; ne := r.returned_earphones + p_earphones;
  if p_walkies < 0 or p_chargers < 0 or p_earphones < 0 or nw > r.delivered_walkies or nc > r.delivered_chargers or ne > r.delivered_earphones then raise exception 'Return counts cannot exceed the delivered quantities.'; end if;
  if jsonb_array_length(coalesce(p_walkie_ids,'[]'::jsonb)) <> p_walkies then raise exception 'Select exactly the number of returned radios.'; end if;
  update public.walkies set status='Available', department_id=null, channel='', assigned_person_name=null, assigned_person_contact=null
    where organization_id=public.current_organization_id() and id in (select jsonb_array_elements_text(coalesce(p_walkie_ids,'[]'::jsonb))) and status='Allocated'
      and id in (select jsonb_array_elements_text(r.allocated_walkie_ids));
  get diagnostics changed = row_count;
  if changed <> p_walkies then raise exception 'One or more selected radios are not allocated to this request.'; end if;
  update public.allocations a set
    walkie_ids=coalesce((select jsonb_agg(item) from jsonb_array_elements_text(a.walkie_ids) item where item not in (select jsonb_array_elements_text(coalesce(p_walkie_ids,'[]'::jsonb)))), '[]'::jsonb),
    status=case when not exists(select 1 from jsonb_array_elements_text(a.walkie_ids) item where item not in (select jsonb_array_elements_text(coalesce(p_walkie_ids,'[]'::jsonb)))) then 'Returned' else a.status end,
    returned_date=case when not exists(select 1 from jsonb_array_elements_text(a.walkie_ids) item where item not in (select jsonb_array_elements_text(coalesce(p_walkie_ids,'[]'::jsonb)))) then current_date else a.returned_date end
    where a.event_radio_request_id=p_id and a.status='Active';
  ns := case when nw=r.delivered_walkies and nc=r.delivered_chargers and ne=r.delivered_earphones then 'returned' else 'partial_return' end;
  update public.event_radio_requests set status=ns, returned_walkies=nw, returned_chargers=nc, returned_earphones=ne,
    returned_at=case when ns='returned' then now() else returned_at end,
    return_feedback=concat_ws(E'\n',nullif(return_feedback,''),nullif(trim(coalesce(p_feedback,'')),'')),updated_at=now() where id=p_id;
end $$;

revoke all on function public.event_radio_request_submit(text,integer,integer,integer) from public;
revoke all on function public.event_radio_request_decide(text,boolean,text) from public;
revoke all on function public.event_radio_request_allocate(text,jsonb) from public;
revoke all on function public.event_radio_request_deliver(text,text) from public;
revoke all on function public.event_radio_request_return(text,jsonb,integer,integer,integer,text) from public;
grant execute on function public.event_radio_request_submit(text,integer,integer,integer) to authenticated;
grant execute on function public.event_radio_request_decide(text,boolean,text) to authenticated;
grant execute on function public.event_radio_request_allocate(text,jsonb) to authenticated;
grant execute on function public.event_radio_request_deliver(text,text) to authenticated;
grant execute on function public.event_radio_request_return(text,jsonb,integer,integer,integer,text) to authenticated;
revoke all on function public.department_set_channel(text,text) from public;
grant execute on function public.department_set_channel(text,text) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.event_radio_requests;
exception when duplicate_object then null; end $$;
