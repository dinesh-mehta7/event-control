-- Repair for an existing installation where accommodation is present but
-- migration_v9_custom_meals.sql was not applied (or the schema cache is stale).
-- Safe to run more than once.

alter table public.meal_menu add column if not exists meal_label text;
update public.meal_menu
set meal_label = initcap(replace(meal, '-', ' '))
where meal_label is null or btrim(meal_label) = '';

notify pgrst, 'reload schema';
