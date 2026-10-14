-- Allow custom-time Special shifts in the event-scoped CCTV Control Room roster.
alter table public.cctv_control_room_duties
  drop constraint if exists cctv_control_room_duties_shift_key_check;

alter table public.cctv_control_room_duties
  add column if not exists shift_label text,
  add column if not exists shift_start time,
  add column if not exists shift_end time;

notify pgrst, 'reload schema';
