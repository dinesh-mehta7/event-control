-- Link event-specific Control Room records to shared Accommodation rooms so
-- room requirements and assigned accommodation members appear in both modules.
-- Run after migration_v74_wifi_event_usage.sql.

alter table public.cctv_control_rooms
  add column if not exists accommodation_room_id text
  references public.accommodation_rooms(id) on delete set null;

create unique index if not exists cctv_control_rooms_accommodation_link_idx
  on public.cctv_control_rooms (organization_id, event_scope_key, accommodation_room_id)
  where accommodation_room_id is not null;

create or replace function public.cctv_control_room_validate_accommodation_link()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.accommodation_room_id is not null and not exists (
    select 1 from public.accommodation_rooms r
    where r.id = new.accommodation_room_id
      and r.organization_id = new.organization_id
      and r.category = 'control_room'
  ) then
    raise exception 'Choose a Control Room from this organization’s Accommodation rooms.';
  end if;
  return new;
end $$;

drop trigger if exists cctv_control_room_validate_accommodation_link on public.cctv_control_rooms;
create trigger cctv_control_room_validate_accommodation_link
  before insert or update of accommodation_room_id, organization_id on public.cctv_control_rooms
  for each row execute function public.cctv_control_room_validate_accommodation_link();

notify pgrst, 'reload schema';
