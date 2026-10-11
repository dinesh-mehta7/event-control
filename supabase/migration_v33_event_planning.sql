-- Event planning workflow and event-specific Sewadar attendance.
-- Run after migration_v32_member_issue_reports.sql.

create or replace function public.can_manage_events()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_is_active() and public.current_approved()
    and public.current_level() in ('owner','dept_head');
$$;

create table if not exists public.event_plans (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  location text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz,
  owner_name text not null default '',
  status text not null default 'planning' check (status in ('planning','ready','live','complete','cancelled')),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index if not exists event_plans_org_date_idx on public.event_plans (organization_id, starts_at desc);

create table if not exists public.event_departments (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text not null,
  department_id text not null,
  department_name text not null,
  lead_name text not null default '',
  resource_notes text not null default '',
  status text not null default 'not_started' check (status in ('not_started','planning','ready','blocked')),
  unique (event_id, department_id),
  foreign key (event_id, organization_id) references public.event_plans(id, organization_id) on delete cascade
);
create index if not exists event_departments_event_idx on public.event_departments (organization_id, event_id, department_name);

create table if not exists public.event_meetings (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text not null,
  title text not null check (length(trim(title)) > 0),
  starts_at timestamptz not null,
  agenda text not null default '',
  minutes text not null default '',
  action_items text not null default '',
  created_at timestamptz not null default now(),
  foreign key (event_id, organization_id) references public.event_plans(id, organization_id) on delete cascade
);
create index if not exists event_meetings_event_idx on public.event_meetings (organization_id, event_id, starts_at);

create table if not exists public.event_requirements (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text not null,
  category text not null check (category in ('it','sewadar','inventory','accommodation','other')),
  department_id text,
  department_name text not null default '',
  title text not null check (length(trim(title)) > 0),
  quantity numeric not null default 1 check (quantity >= 0),
  unit text not null default '',
  notes text not null default '',
  status text not null default 'requested' check (status in ('requested','in_progress','ready','not_needed')),
  created_at timestamptz not null default now(),
  foreign key (event_id, organization_id) references public.event_plans(id, organization_id) on delete cascade
);
create index if not exists event_requirements_event_idx on public.event_requirements (organization_id, event_id, category);

create table if not exists public.event_tasks (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text not null,
  department_id text,
  department_name text not null default '',
  title text not null check (length(trim(title)) > 0),
  assigned_to text not null default '',
  due_date date,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'todo' check (status in ('todo','in_progress','complete')),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (event_id, organization_id) references public.event_plans(id, organization_id) on delete cascade
);
create index if not exists event_tasks_event_idx on public.event_tasks (organization_id, event_id, status, due_date);

create table if not exists public.event_attendance (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text not null,
  member_id text not null,
  member_name text not null,
  status text not null default 'expected' check (status in ('expected','present','checked_out','absent')),
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  notes text not null default '',
  unique (event_id, member_id),
  foreign key (event_id, organization_id) references public.event_plans(id, organization_id) on delete cascade
);
create index if not exists event_attendance_event_idx on public.event_attendance (organization_id, event_id, status);

create table if not exists public.event_reviews (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text not null,
  lessons_learned text not null default '',
  issues_faced text not null default '',
  recommendations text not null default '',
  closure_report text not null default '',
  updated_at timestamptz not null default now(),
  unique (event_id),
  foreign key (event_id, organization_id) references public.event_plans(id, organization_id) on delete cascade
);

alter table public.event_plans enable row level security;
alter table public.event_departments enable row level security;
alter table public.event_meetings enable row level security;
alter table public.event_requirements enable row level security;
alter table public.event_tasks enable row level security;
alter table public.event_attendance enable row level security;
alter table public.event_reviews enable row level security;

do $$
declare t text;
begin
  foreach t in array array['event_plans','event_departments','event_meetings','event_requirements','event_tasks','event_attendance','event_reviews'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved())', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    if t = 'event_attendance' then
      execute format('create policy %I on public.%I for all using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved() and (public.can_manage_events() or public.can_manage_manpower())) with check (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved() and (public.can_manage_events() or public.can_manage_manpower()))', t || '_write', t);
    else
      execute format('create policy %I on public.%I for all using (organization_id = public.current_organization_id() and public.can_manage_events()) with check (organization_id = public.current_organization_id() and public.can_manage_events())', t || '_write', t);
    end if;
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

notify pgrst, 'reload schema';
