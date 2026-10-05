alter table public.accommodation_members
  add column if not exists shift text not null default '';

alter table public.accommodation_members
  drop constraint if exists accommodation_members_shift_check;

alter table public.accommodation_members
  add constraint accommodation_members_shift_check
  check (shift in ('', 'night', 'morning'));

notify pgrst, 'reload schema';
