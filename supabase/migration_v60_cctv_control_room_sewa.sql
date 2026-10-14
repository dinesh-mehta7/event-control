-- Event-scoped CCTV control room locations, PCs, shift assignments and attendance.
create table if not exists public.cctv_control_rooms (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text references public.event_plans(id) on delete cascade,
  event_scope_key text not null default 'normal',
  name text not null,
  location text not null,
  pc_count integer not null default 0 check (pc_count >= 0),
  created_at timestamptz not null default now(),
  unique (organization_id, event_scope_key, name),
  check ((event_id is null and event_scope_key = 'normal') or event_scope_key = event_id)
);

create table if not exists public.cctv_control_room_duties (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text references public.event_plans(id) on delete cascade,
  event_scope_key text not null default 'normal',
  room_id text not null references public.cctv_control_rooms(id) on delete cascade,
  shift_date date not null,
  shift_key text not null check (shift_key in ('morning','noon','evening','night')),
  member_id text references public.accommodation_members(id) on delete set null,
  member_name text not null,
  mobile text not null default '',
  attendance_status text not null default 'scheduled' check (attendance_status in ('scheduled','arrived','absent')),
  checked_in_at timestamptz,
  assigned_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((event_id is null and event_scope_key = 'normal') or event_scope_key = event_id)
);

create index if not exists cctv_control_rooms_scope_idx
  on public.cctv_control_rooms (organization_id, event_scope_key, name);
create index if not exists cctv_control_room_duties_scope_idx
  on public.cctv_control_room_duties (organization_id, event_scope_key, shift_date, room_id, shift_key);
create unique index if not exists cctv_control_room_duties_member_once_idx
  on public.cctv_control_room_duties (organization_id, event_scope_key, shift_date, shift_key, member_id)
  where member_id is not null;

alter table public.cctv_control_rooms enable row level security;
alter table public.cctv_control_room_duties enable row level security;

drop policy if exists cctv_control_rooms_read on public.cctv_control_rooms;
create policy cctv_control_rooms_read on public.cctv_control_rooms for select using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
);
drop policy if exists cctv_control_rooms_manage on public.cctv_control_rooms;
create policy cctv_control_rooms_manage on public.cctv_control_rooms for all using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and (
    p.level in ('owner','dept_head') or (p.level = 'sub_dept_head' and p.sub_department in ('cctv','control'))
  ))
) with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and (
    p.level in ('owner','dept_head') or (p.level = 'sub_dept_head' and p.sub_department in ('cctv','control'))
  ))
);

drop policy if exists cctv_control_room_duties_read on public.cctv_control_room_duties;
create policy cctv_control_room_duties_read on public.cctv_control_room_duties for select using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
);
drop policy if exists cctv_control_room_duties_insert on public.cctv_control_room_duties;
create policy cctv_control_room_duties_insert on public.cctv_control_room_duties for insert with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and (
    p.level in ('owner','dept_head') or p.sub_department in ('cctv','control')
  ))
);
drop policy if exists cctv_control_room_duties_update on public.cctv_control_room_duties;
create policy cctv_control_room_duties_update on public.cctv_control_room_duties for update using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and (
    p.level in ('owner','dept_head') or p.sub_department in ('cctv','control')
  ))
) with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and (
    p.level in ('owner','dept_head') or p.sub_department in ('cctv','control')
  ))
);
drop policy if exists cctv_control_room_duties_delete on public.cctv_control_room_duties;
create policy cctv_control_room_duties_delete on public.cctv_control_room_duties for delete using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and (
    p.level in ('owner','dept_head') or (p.level = 'sub_dept_head' and p.sub_department in ('cctv','control'))
  ))
);

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.cctv_control_rooms';
  exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.cctv_control_room_duties';
  exception when duplicate_object then null; end;
end $$;

notify pgrst, 'reload schema';
