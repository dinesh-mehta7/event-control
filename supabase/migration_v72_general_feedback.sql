-- Merge material and site/event complaints into one Issue category and add general Feedback.
-- Run after migration_v71_remove_food_ready_for_event.sql.

alter table public.member_issues drop constraint if exists member_issues_kind_check;
alter table public.member_issues add constraint member_issues_kind_check
  check (kind in ('material', 'site_event', 'issue', 'feedback'));

create or replace function public.member_issue_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare msg_title text;
begin
  msg_title := case
    when new.kind = 'feedback' then 'Feedback received'
    when new.kind = 'site_event' then 'Site/event issue reported'
    when new.kind = 'material' then 'Material issue reported'
    else 'Issue reported'
  end;
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select new.organization_id, p.id, msg_title,
    new.reporter_name || ': ' || new.title || case when new.material <> '' then ' · ' || new.material else '' end,
    'warning', 'issues', new.id::text
  from public.profiles p
  where p.organization_id = new.organization_id and p.approved and p.is_active and p.id <> new.reporter_id
    and (p.level in ('owner','dept_head') or (p.level = 'sub_dept_head' and p.sub_department = new.sub_department));
  return new;
end $$;

notify pgrst, 'reload schema';
