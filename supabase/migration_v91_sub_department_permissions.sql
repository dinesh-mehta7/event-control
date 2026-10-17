-- Sub-department module access, set by the Super Admin (Administration → Sub-department Permissions).
-- Only changes from the built-in defaults are stored; a missing row means "use the default". Run after v90.
create table if not exists public.sub_department_permissions (
  organization_id text not null references public.organizations(id) on delete cascade,
  sub_department text not null check (sub_department in ('cctv','wifi','walkie','control','inventory','purchase','accounts','accommodation','sewadars')),
  module text not null check (module in ('cctv','wifi','walkie','control','cctv-control-room','inventory','purchase','accommodation','sewadars','helpdesk','requests','tasks','events')),
  allowed boolean not null,
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  primary key (organization_id, sub_department, module)
);

alter table public.sub_department_permissions enable row level security;
drop policy if exists sub_department_permissions_read on public.sub_department_permissions;
create policy sub_department_permissions_read on public.sub_department_permissions for select
  using (organization_id = public.current_organization_id());
-- Super Admin and Department Heads change access.
drop policy if exists sub_department_permissions_write on public.sub_department_permissions;
create policy sub_department_permissions_write on public.sub_department_permissions for all
  using (organization_id = public.current_organization_id() and public.current_level() in ('owner','dept_head'))
  with check (organization_id = public.current_organization_id() and public.current_level() in ('owner','dept_head'));

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.sub_department_permissions'; exception when duplicate_object then null; end;
end $$;
notify pgrst, 'reload schema';
