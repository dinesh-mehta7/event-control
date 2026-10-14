-- Keep Sewadar profiles as shared roster data. Arrival, badge and calls belong
-- to a module's Normal workspace or to one selected event.
alter table public.accommodation_member_calls
  add column if not exists event_id text references public.event_plans(id) on delete cascade;
alter table public.allocations
  add column if not exists event_id text references public.event_plans(id) on delete cascade;
alter table public.deliveries
  add column if not exists event_id text references public.event_plans(id) on delete cascade;

drop trigger if exists accommodation_member_call_bump on public.accommodation_member_calls;
drop policy if exists event_attendance_write on public.event_attendance;
create policy event_attendance_write on public.event_attendance for all using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.can_manage_events() or public.can_manage_manpower() or public.can_manage_rooms())
) with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.can_manage_events() or public.can_manage_manpower() or public.can_manage_rooms())
);

create table if not exists public.sewadar_event_operations (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text references public.event_plans(id) on delete cascade,
  event_scope_key text not null default 'normal',
  member_id text not null references public.accommodation_members(id) on delete cascade,
  arrival_status text not null default 'pending' check (arrival_status in ('pending','arrived','not_coming')),
  arrived_at timestamptz,
  badge_issued boolean not null default false,
  badge_at timestamptz,
  badge_returned boolean not null default false,
  badge_returned_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (organization_id, event_scope_key, member_id),
  check ((event_id is null and event_scope_key = 'normal') or event_scope_key = event_id)
);

alter table public.sewadar_event_operations
  add column if not exists badge_returned boolean not null default false,
  add column if not exists badge_returned_at timestamptz;

insert into public.sewadar_event_operations
  (id, organization_id, event_scope_key, member_id, arrival_status, arrived_at, badge_issued, badge_at)
select 'sewadar-op-' || m.id, m.organization_id, 'normal', m.id,
  coalesce(m.arrival_status, 'pending'), m.arrived_at, coalesce(m.badge_issued, false), m.badge_at
from public.accommodation_members m
on conflict (organization_id, event_scope_key, member_id) do nothing;

alter table public.sewadar_event_operations enable row level security;
drop policy if exists sewadar_event_operations_select on public.sewadar_event_operations;
create policy sewadar_event_operations_select on public.sewadar_event_operations for select using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
);
drop policy if exists sewadar_event_operations_write on public.sewadar_event_operations;
create policy sewadar_event_operations_write on public.sewadar_event_operations for all using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.can_manage_manpower() or public.can_manage_rooms())
) with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.can_manage_manpower() or public.can_manage_rooms())
);
create index if not exists sewadar_event_operations_scope_idx
  on public.sewadar_event_operations (organization_id, event_scope_key, member_id);
create index if not exists accommodation_member_calls_event_idx
  on public.accommodation_member_calls (organization_id, event_id, member_id, called_at desc);
create index if not exists allocations_event_idx on public.allocations (organization_id, event_id, created_at desc);
create index if not exists deliveries_event_idx on public.deliveries (organization_id, event_id, created_at desc);

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.sewadar_event_operations';
  exception when duplicate_object then null; end;
end $$;
notify pgrst, 'reload schema';
