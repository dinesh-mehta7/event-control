-- One shared member roster for Accommodation and Sewadars.
-- Requires migrations v10, v22, v24 and v25. Safe to re-run.

alter table public.accommodation_members
  add column if not exists device_type text not null default 'none',
  add column if not exists device_ref text not null default '',
  add column if not exists badge_issued boolean not null default false,
  add column if not exists badge_at timestamptz,
  add column if not exists last_call_by text not null default '';

-- Normalize prior member type constraints before sharing records across both workspaces.
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.accommodation_members'::regclass
    and contype='c' and pg_get_constraintdef(oid) ilike '%last_call_outcome%'
  loop execute format('alter table public.accommodation_members drop constraint %I', c.conname); end loop;
  alter table public.accommodation_members add constraint accommodation_members_last_call_outcome_v26_check
    check (last_call_outcome in ('','answered','coming','later','not_coming','no_answer','busy','off','wrong','wrong_number'));
end $$;

-- Preserve the old Sewadars list in the accommodation roster. Match by normalized phone
-- where possible; otherwise retain the original sewadar ID as the shared member ID.
insert into public.accommodation_members (
  id, organization_id, name, department, room_id, member_type, serial_no, batch_no, relation,
  relation_name, mobile, village_city, branch, occupation, remarks, joining_date, employee_code,
  employee_id, address, address2, call_count, last_call_outcome, last_call_at, last_call_by,
  expected_arrival, arrival_status, arrived_at, team_name, team_lead, device_type, device_ref,
  badge_issued, badge_at
)
select s.id, s.organization_id, s.name, coalesce(s.department,''), null, 'salary_based', '', '', '',
  '', s.phone, '', '', '', '', null, '', '', '', '', s.call_count, coalesce(s.last_call_outcome,''),
  s.last_call_at, coalesce(s.last_call_by,''), null, s.arrival, s.arrived_at, '', '', s.device_type,
  s.device_ref, s.badge_issued, s.badge_at
from public.manpower_sewadars s
where not exists (select 1 from public.accommodation_members m where m.id=s.id)
  and not exists (
    select 1 from public.accommodation_members m where m.organization_id=s.organization_id and s.phone<>''
      and regexp_replace(coalesce(m.mobile,''),'[^0-9+]','','g')=regexp_replace(s.phone,'[^0-9+]','','g')
  )
on conflict (id) do nothing;

-- Keep the most advanced shared arrival/badge/call information when phone matching merged rows.
update public.accommodation_members m set
  call_count = greatest(m.call_count, s.call_count),
  last_call_outcome = coalesce(nullif(m.last_call_outcome,''), s.last_call_outcome, ''),
  last_call_at = greatest(m.last_call_at, s.last_call_at),
  last_call_by = coalesce(nullif(m.last_call_by,''), s.last_call_by, ''),
  arrival_status = case when s.arrival='arrived' then 'arrived' when m.arrival_status='pending' then s.arrival else m.arrival_status end,
  arrived_at = coalesce(m.arrived_at, s.arrived_at),
  badge_issued = m.badge_issued or s.badge_issued,
  badge_at = coalesce(m.badge_at, s.badge_at),
  device_type = case when m.device_type='none' then s.device_type else m.device_type end,
  device_ref = case when m.device_ref='' then s.device_ref else m.device_ref end
from public.manpower_sewadars s
where m.organization_id=s.organization_id and (
  m.id=s.id or (s.phone<>'' and regexp_replace(coalesce(m.mobile,''),'[^0-9+]','','g')=regexp_replace(s.phone,'[^0-9+]','','g'))
);

create table if not exists public.accommodation_member_calls (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  member_id text not null references public.accommodation_members(id) on delete cascade,
  outcome text not null check (outcome in ('answered','coming','later','not_coming','no_answer','busy','off','wrong','wrong_number')),
  note text not null default '',
  called_by text not null default '',
  called_at timestamptz not null default now()
);
create index if not exists accommodation_member_calls_member_idx on public.accommodation_member_calls (member_id, called_at desc);

-- Copy old call history to the shared member IDs before adding the counter trigger.
insert into public.accommodation_member_calls (id, organization_id, member_id, outcome, note, called_by, called_at)
select c.id, c.organization_id,
  coalesce((select m.id from public.accommodation_members m where m.id=c.sewadar_id and m.organization_id=c.organization_id limit 1),
    (select m.id from public.manpower_sewadars s join public.accommodation_members m on m.organization_id=s.organization_id
      and s.phone<>'' and regexp_replace(coalesce(m.mobile,''),'[^0-9+]','','g')=regexp_replace(s.phone,'[^0-9+]','','g')
      where s.id=c.sewadar_id and s.organization_id=c.organization_id order by m.created_at limit 1)),
  c.outcome, c.note, coalesce(c.called_by,''), c.called_at
from public.manpower_calls c
where coalesce((select m.id from public.accommodation_members m where m.id=c.sewadar_id and m.organization_id=c.organization_id limit 1),
    (select m.id from public.manpower_sewadars s join public.accommodation_members m on m.organization_id=s.organization_id
      and s.phone<>'' and regexp_replace(coalesce(m.mobile,''),'[^0-9+]','','g')=regexp_replace(s.phone,'[^0-9+]','','g')
      where s.id=c.sewadar_id and s.organization_id=c.organization_id order by m.created_at limit 1)) is not null
on conflict (id) do nothing;

alter table public.manpower_tasks add column if not exists member_id text references public.accommodation_members(id) on delete set null;
update public.manpower_tasks t set member_id = coalesce(
  (select m.id from public.accommodation_members m where m.id=t.sewadar_id and m.organization_id=t.organization_id limit 1),
  (select m.id from public.manpower_sewadars s join public.accommodation_members m on m.organization_id=s.organization_id
    and s.phone<>'' and regexp_replace(coalesce(m.mobile,''),'[^0-9+]','','g')=regexp_replace(s.phone,'[^0-9+]','','g')
    where s.id=t.sewadar_id and s.organization_id=t.organization_id order by m.created_at limit 1)
) where t.member_id is null and t.sewadar_id is not null;

-- Both accommodation and Sewadars leads manage this single roster and its member tasks.
create or replace function public.can_manage_rooms()
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select approved and is_active and
    (level in ('owner','dept_head') or sub_department in ('accommodation','sewadars'))
    from public.profiles where id=auth.uid()), false);
$$;

alter table public.accommodation_member_calls enable row level security;
drop policy if exists accommodation_member_calls_select on public.accommodation_member_calls;
create policy accommodation_member_calls_select on public.accommodation_member_calls for select using (
  organization_id=public.current_organization_id() and public.current_is_active() and public.current_approved()
);
drop policy if exists accommodation_member_calls_insert on public.accommodation_member_calls;
create policy accommodation_member_calls_insert on public.accommodation_member_calls for insert with check (
  organization_id=public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.can_manage_rooms() or public.can_manage_manpower())
);

create or replace function public.accommodation_member_call_stamp()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  new.called_by := coalesce(nullif(new.called_by,''),(select name from public.profiles where id=auth.uid()),'System');
  new.called_at := coalesce(new.called_at,now());
  return new;
end $$;
create or replace function public.accommodation_member_call_bump()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.accommodation_members set call_count=call_count+1,last_call_at=new.called_at,
    last_call_outcome=new.outcome,last_call_by=new.called_by where id=new.member_id;
  return new;
end $$;
drop trigger if exists accommodation_member_call_stamp on public.accommodation_member_calls;
create trigger accommodation_member_call_stamp before insert on public.accommodation_member_calls
for each row execute function public.accommodation_member_call_stamp();
drop trigger if exists accommodation_member_call_bump on public.accommodation_member_calls;
create trigger accommodation_member_call_bump after insert on public.accommodation_member_calls
for each row execute function public.accommodation_member_call_bump();

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.accommodation_member_calls';
  exception when duplicate_object then null; end;
end $$;
notify pgrst, 'reload schema';
