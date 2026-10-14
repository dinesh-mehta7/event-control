-- Track room setup supplies separately from bed capacity and show readiness.
alter table public.accommodation_rooms
  add column if not exists requirements jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
