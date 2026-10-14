-- Keep physical rooms and member placements shared, while tracking each event's
-- room setup checklist and meal schedule independently.
-- Add the shared requirements column here too so this migration can recover
-- databases where migration_v59 was skipped; it is safe when v59 already ran.
alter table public.accommodation_rooms
  add column if not exists requirements jsonb not null default '[]'::jsonb;

alter table public.accommodation_rooms
  add column if not exists requirements_by_scope jsonb not null default '{}'::jsonb,
  add column if not exists readiness_by_scope jsonb not null default '{}'::jsonb;

-- Preserve existing room checklists as the Normal-scope checklist.
update public.accommodation_rooms
set requirements_by_scope = jsonb_build_object('normal', requirements)
where requirements_by_scope = '{}'::jsonb and requirements <> '[]'::jsonb;

alter table public.meal_menu
  add column if not exists scope_key text not null default 'normal',
  add column if not exists event_id text,
  add column if not exists ready_at timestamptz;

alter table public.meal_menu drop constraint if exists meal_menu_unique_slot;
create unique index if not exists meal_menu_unique_slot_scope_idx
  on public.meal_menu (organization_id, menu_date, meal, scope_key);
create index if not exists meal_menu_event_scope_date_idx
  on public.meal_menu (organization_id, scope_key, menu_date);

-- Convert the retired meal state before applying the supported workflow.
update public.meal_menu set status = 'preparing' where status = 'ready_for_event';
alter table public.meal_menu drop constraint if exists meal_menu_status_check;
alter table public.meal_menu add constraint meal_menu_status_check
  check (status in ('scheduled','preparing','distributing','distributed'));

notify pgrst, 'reload schema';
