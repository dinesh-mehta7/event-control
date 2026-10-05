-- migration_v8_menu_owner.sql
-- The organization OWNER can now edit the meal menu (add / remove dishes and
-- meals, change live status) in addition to the Accommodation head.
-- Run after migration_v7. Safe to run more than once.
create or replace function public.can_manage_menu()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select approved and is_active and (
      level = 'owner' or (level = 'sub_dept_head' and sub_department = 'accommodation')
    )
    from public.profiles where id = auth.uid()
  ), false);
$$;
notify pgrst, 'reload schema';
