-- Notify the task creator when a task is moved to Complete.
-- Run after migration_v20_manpower_tasks.sql and the accommodation task setup.

create or replace function public.notify_task_creator_on_completion()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor_name text;
  task_link text;
begin
  if new.status <> 'complete' or (tg_op = 'UPDATE' and old.status = 'complete') then
    return new;
  end if;

  select nullif(trim(name), '') into actor_name
  from public.profiles where id = auth.uid();
  actor_name := coalesce(actor_name, nullif(trim(new.assigned_to), ''), 'A team member');
  task_link := case when tg_table_name = 'manpower_tasks' then '#/sewadars' else '#/accommodation' end;

  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select new.organization_id, new.created_by, 'Task completed',
         format('%s completed “%s”.', actor_name, new.title), 'info', task_link, new.id
  where new.created_by is not null
    and exists (select 1 from public.profiles p where p.id = new.created_by and p.organization_id = new.organization_id and p.approved and p.is_active);

  return new;
end $$;

revoke all on function public.notify_task_creator_on_completion() from public, anon, authenticated;

drop trigger if exists manpower_task_completion_notification on public.manpower_tasks;
create trigger manpower_task_completion_notification
after insert or update of status on public.manpower_tasks
for each row execute function public.notify_task_creator_on_completion();

drop trigger if exists accommodation_task_completion_notification on public.accommodation_member_tasks;
create trigger accommodation_task_completion_notification
after insert or update of status on public.accommodation_member_tasks
for each row execute function public.notify_task_creator_on_completion();

notify pgrst, 'reload schema';
