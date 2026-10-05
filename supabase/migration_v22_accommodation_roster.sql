-- Full event member register fields for CSV import, arrival planning, and lodging.
-- Run after migration_v7_accommodation.sql.

-- Room/member ownership belongs to the overall owner, IT head, and Accommodation lead.
create or replace function public.can_manage_rooms()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved and is_active and
    (level in ('owner','dept_head') or (level = 'sub_dept_head' and sub_department = 'accommodation'))
    from public.profiles where id = auth.uid()), false);
$$;

alter table public.accommodation_members
  add column if not exists member_type text not null default 'permanent' check (member_type in ('permanent','monthly','annual')),
  add column if not exists serial_no text not null default '',
  add column if not exists batch_no text not null default '',
  add column if not exists relation text not null default '',
  add column if not exists relation_name text not null default '',
  add column if not exists mobile text not null default '',
  add column if not exists village_city text not null default '',
  add column if not exists branch text not null default '',
  add column if not exists occupation text not null default '',
  add column if not exists remarks text not null default '',
  add column if not exists joining_date date,
  add column if not exists employee_code text not null default '',
  add column if not exists employee_id text not null default '',
  add column if not exists address text not null default '',
  add column if not exists address2 text not null default '';

create index if not exists accommodation_members_type_idx on public.accommodation_members (organization_id, member_type, department);
notify pgrst, 'reload schema';
