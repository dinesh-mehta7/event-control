-- Duties & Shifts: date-wise shift assignments for arrived members of every department.
-- CCTV members keep using cctv_control_room_duties (one shared roster with CCTV Control Room);
-- every other department is stored here with the same shift keys (morning / noon / evening / night / special-HHMM-HHMM).
-- Run after migration_v85.

create table if not exists public.sewa_duty_shifts (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text references public.event_plans(id) on delete cascade,
  event_scope_key text not null default 'normal',
  member_id text not null references public.accommodation_members(id) on delete cascade,
  member_name text not null,
  department text not null default '',
  shift_date date not null,
  shift_key text not null,
  shift_label text not null default '',
  shift_start time,
  shift_end time,
  location text not null default '',
  assigned_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((event_id is null and event_scope_key = 'normal') or event_scope_key = event_id)
);
create unique index if not exists sewa_duty_shifts_member_once_idx
  on public.sewa_duty_shifts (organization_id, event_scope_key, shift_date, shift_key, member_id);
create index if not exists sewa_duty_shifts_scope_idx
  on public.sewa_duty_shifts (organization_id, event_scope_key, shift_date);

alter table public.sewa_duty_shifts enable row level security;
drop policy if exists sewa_duty_shifts_read on public.sewa_duty_shifts;
create policy sewa_duty_shifts_read on public.sewa_duty_shifts for select using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
);
drop policy if exists sewa_duty_shifts_manage on public.sewa_duty_shifts;
create policy sewa_duty_shifts_manage on public.sewa_duty_shifts for all using (
  organization_id = public.current_organization_id() and public.can_manage_manpower()
) with check (
  organization_id = public.current_organization_id() and public.can_manage_manpower()
);

-- Volunteer managers may also plan CCTV duties from Duties & Shifts (CCTV staff keep their existing rights).
drop policy if exists cctv_control_room_duties_insert on public.cctv_control_room_duties;
create policy cctv_control_room_duties_insert on public.cctv_control_room_duties for insert with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.can_manage_manpower() or exists (select 1 from public.profiles p where p.id = auth.uid() and (
    p.level in ('owner','dept_head') or p.sub_department in ('cctv','control')
  )))
);
drop policy if exists cctv_control_room_duties_update on public.cctv_control_room_duties;
create policy cctv_control_room_duties_update on public.cctv_control_room_duties for update using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.can_manage_manpower() or exists (select 1 from public.profiles p where p.id = auth.uid() and (
    p.level in ('owner','dept_head') or p.sub_department in ('cctv','control')
  )))
) with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.can_manage_manpower() or exists (select 1 from public.profiles p where p.id = auth.uid() and (
    p.level in ('owner','dept_head') or p.sub_department in ('cctv','control')
  )))
);
drop policy if exists cctv_control_room_duties_delete on public.cctv_control_room_duties;
create policy cctv_control_room_duties_delete on public.cctv_control_room_duties for delete using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.can_manage_manpower() or exists (select 1 from public.profiles p where p.id = auth.uid() and (
    p.level in ('owner','dept_head') or (p.level = 'sub_dept_head' and p.sub_department in ('cctv','control'))
  )))
);

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.sewa_duty_shifts';
  exception when duplicate_object then null; end;
end $$;
notify pgrst, 'reload schema';
