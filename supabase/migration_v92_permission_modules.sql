-- Sub-department Permissions now covers every page, with the Sewadar area split into its six pages.
-- Run after migration_v91_sub_department_permissions.sql.
alter table public.sub_department_permissions drop constraint if exists sub_department_permissions_module_check;
-- An older single "sewadars" switch becomes the six Sewadar pages.
insert into public.sub_department_permissions (organization_id, sub_department, module, allowed, updated_by, updated_at)
select p.organization_id, p.sub_department, 'sewadars:' || t.tab, p.allowed, p.updated_by, p.updated_at
  from public.sub_department_permissions p
  cross join (values ('roster'),('permanent'),('calling'),('duties'),('teams'),('attendance')) as t(tab)
 where p.module = 'sewadars'
on conflict (organization_id, sub_department, module) do nothing;
delete from public.sub_department_permissions where module = 'sewadars';
alter table public.sub_department_permissions add constraint sub_department_permissions_module_check check (module in (
  'helpdesk','cctv','cctv-control-room','wifi','walkie','control','networking-support','issues',
  'accommodation','sewadars:roster','sewadars:permanent','sewadars:calling','sewadars:duties','sewadars:teams','sewadars:attendance','tasks',
  'inventory','requests','purchase','events','meetings','reports'));
notify pgrst, 'reload schema';
