-- migration_v9_custom_meals.sql
-- Meals are no longer limited to breakfast/lunch/tea/dinner: the head/owner can
-- add or remove any meal (brunch, snacks, a custom name) per day.
-- Run after migration_v7 / v8. Safe to run more than once.
alter table public.meal_menu drop constraint if exists meal_menu_meal_check;
alter table public.meal_menu add column if not exists meal_label text;
alter table public.meal_menu drop constraint if exists meal_menu_meal_slug;
alter table public.meal_menu add constraint meal_menu_meal_slug
  check (meal ~ '^[a-z0-9][a-z0-9-]{0,39}$') not valid;
notify pgrst, 'reload schema';
