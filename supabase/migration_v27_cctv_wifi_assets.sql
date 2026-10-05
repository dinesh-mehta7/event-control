-- Shared CCTV and Wi-Fi asset registers with organization-scoped CRUD.
-- Run after migrations v3 and v4. Safe to re-run.

create or replace function public.can_manage_cctv_assets()
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select approved and is_active
    and (level in ('owner','dept_head') or sub_department='cctv')
    from public.profiles where id=auth.uid()), false);
$$;

create or replace function public.can_manage_wifi_assets()
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select approved and is_active
    and (level in ('owner','dept_head') or sub_department='wifi')
    from public.profiles where id=auth.uid()), false);
$$;

create table if not exists public.cctv_cameras (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  camera_code text not null,
  location text not null,
  camera_type text not null default '',
  nvr_id text not null default '',
  switch_id text not null default '',
  status text not null default 'online' check (status in ('online','offline','maintenance')),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, camera_code)
);
create index if not exists cctv_cameras_org_location_idx on public.cctv_cameras (organization_id, location, camera_code);
alter table public.cctv_cameras enable row level security;
drop policy if exists cctv_cameras_select on public.cctv_cameras;
create policy cctv_cameras_select on public.cctv_cameras for select using (
  organization_id=public.current_organization_id() and public.current_is_active() and public.current_approved()
);
drop policy if exists cctv_cameras_insert on public.cctv_cameras;
create policy cctv_cameras_insert on public.cctv_cameras for insert with check (
  public.can_manage_cctv_assets() and organization_id=public.current_organization_id()
);
drop policy if exists cctv_cameras_update on public.cctv_cameras;
create policy cctv_cameras_update on public.cctv_cameras for update using (
  public.can_manage_cctv_assets() and organization_id=public.current_organization_id()
) with check (public.can_manage_cctv_assets() and organization_id=public.current_organization_id());
drop policy if exists cctv_cameras_delete on public.cctv_cameras;
create policy cctv_cameras_delete on public.cctv_cameras for delete using (
  public.can_manage_cctv_assets() and organization_id=public.current_organization_id()
);

create table if not exists public.wifi_access_points (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  ap_code text not null,
  model text not null default '',
  location text not null,
  status text not null default 'online' check (status in ('online','offline','high_latency')),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, ap_code)
);
create index if not exists wifi_access_points_org_location_idx on public.wifi_access_points (organization_id, location, ap_code);
alter table public.wifi_access_points enable row level security;
drop policy if exists wifi_access_points_select on public.wifi_access_points;
create policy wifi_access_points_select on public.wifi_access_points for select using (
  organization_id=public.current_organization_id() and public.current_is_active() and public.current_approved()
);
drop policy if exists wifi_access_points_insert on public.wifi_access_points;
create policy wifi_access_points_insert on public.wifi_access_points for insert with check (
  public.can_manage_wifi_assets() and organization_id=public.current_organization_id()
);
drop policy if exists wifi_access_points_update on public.wifi_access_points;
create policy wifi_access_points_update on public.wifi_access_points for update using (
  public.can_manage_wifi_assets() and organization_id=public.current_organization_id()
) with check (public.can_manage_wifi_assets() and organization_id=public.current_organization_id());
drop policy if exists wifi_access_points_delete on public.wifi_access_points;
create policy wifi_access_points_delete on public.wifi_access_points for delete using (
  public.can_manage_wifi_assets() and organization_id=public.current_organization_id()
);

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.cctv_cameras';
  exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.wifi_access_points';
  exception when duplicate_object then null; end;
end $$;
notify pgrst, 'reload schema';
