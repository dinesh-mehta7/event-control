-- Remove the extra Ready for event status from the Food workflow.
-- Existing meals at that step return to In preparation.
update public.meal_menu
set status = 'preparing'
where status = 'ready_for_event';

alter table public.meal_menu drop constraint if exists meal_menu_status_check;
alter table public.meal_menu add constraint meal_menu_status_check
  check (status in ('scheduled','preparing','distributing','distributed'));

notify pgrst, 'reload schema';
