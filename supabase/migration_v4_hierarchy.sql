-- Run after migration_v3. Adds the org hierarchy to profiles (one login for the whole app).
alter table public.profiles add column if not exists level text not null default 'other'
  check (level in ('owner','dept_head','sub_dept_head','staff','other'));
alter table public.profiles add column if not exists sub_department text
  check (sub_department in ('cctv','wifi','walkie','control','inventory','purchase','accommodation','sewadars'));

-- Only an Admin can change anyone's level / sub-department.
create or replace function public.guard_hierarchy() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.level is distinct from old.level or new.sub_department is distinct from old.sub_department)
     and auth.uid() is not null and public.current_role() is distinct from 'Admin' then
    new.level := old.level; new.sub_department := old.sub_department;
  end if;
  return new;
end $$;
drop trigger if exists guard_hierarchy on public.profiles;
create trigger guard_hierarchy before update on public.profiles for each row execute function public.guard_hierarchy();

-- First owner (SQL Editor has no logged-in user, so skip the guard triggers for this one update):
-- begin;
-- set local session_replication_role = replica;
-- update public.profiles set role='Admin', approved=true, is_active=true, level='owner' where email='YOUR_EMAIL';
-- commit;

-- Others (edit emails):
-- update public.profiles set level='owner' where email='owner@org.com';
-- update public.profiles set level='dept_head' where email='ithead@org.com';
-- update public.profiles set level='sub_dept_head', sub_department='cctv' where email='cctv@org.com';
