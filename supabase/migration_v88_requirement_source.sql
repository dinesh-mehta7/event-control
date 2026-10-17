-- Event requirements: "From where" is recorded as a department plus a location (it was one free-text field).
-- collect_from keeps a combined "Department · Location" label so older screens keep working. Run after v87.
alter table public.event_requirements
  add column if not exists collect_from_department text not null default '',
  add column if not exists collect_from_location text not null default '';

-- Existing rows: the old free text was a place, so it becomes the location.
update public.event_requirements
   set collect_from_location = collect_from
 where collect_from <> '' and collect_from_location = '' and collect_from_department = '';

notify pgrst, 'reload schema';
