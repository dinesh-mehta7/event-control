-- Link new issue, complaint, and feedback submissions to an event.
-- Existing reports remain nullable for backward compatibility.
alter table public.member_issues
  add column if not exists event_id text references public.event_plans(id) on delete set null;
create index if not exists member_issues_event_created_idx
  on public.member_issues (organization_id, event_id, created_at desc);
grant update (event_id) on public.member_issues to authenticated;

create or replace function public.member_issue_require_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.event_id is null or not exists (
    select 1 from public.event_plans e
    where e.id = new.event_id and e.organization_id = new.organization_id
  ) then
    raise exception 'Choose an event for this report.';
  end if;
  return new;
end $$;
drop trigger if exists member_issue_require_event on public.member_issues;
create trigger member_issue_require_event
  before insert or update of event_id, organization_id on public.member_issues
  for each row execute function public.member_issue_require_event();

notify pgrst, 'reload schema';
