-- Use the three accommodation member categories: salary-based, monthly, annual.
-- Run after migration_v22_accommodation_roster.sql.
-- The member_type column is also bootstrapped here so this migration can be safely retried
-- if it was accidentally run before v22. v22 is still required for the remaining roster fields.
alter table public.accommodation_members
  add column if not exists member_type text not null default 'permanent';

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.accommodation_members'::regclass
      and contype = 'c' and pg_get_constraintdef(oid) ilike '%member_type%'
  loop
    execute format('alter table public.accommodation_members drop constraint %I', c.conname);
  end loop;
  update public.accommodation_members set member_type = 'salary_based' where member_type = 'permanent';
  alter table public.accommodation_members alter column member_type set default 'salary_based';
  alter table public.accommodation_members add constraint accommodation_members_member_type_v25_check
    check (member_type in ('salary_based','monthly','annual'));
end $$;
notify pgrst, 'reload schema';
