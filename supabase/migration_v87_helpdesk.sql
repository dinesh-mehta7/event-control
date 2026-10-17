-- Helpdesk (Spiceworks-style): tickets, conversation (public replies, internal notes, change log),
-- SLA due times, technicians, categories and canned replies. Run after migration_v86.

-- Settings: one row per organization ---------------------------------------------------------------
create table if not exists public.helpdesk_settings (
  organization_id text primary key references public.organizations(id) on delete cascade,
  sla_hours jsonb not null default '{"critical":4,"high":8,"medium":24,"low":72}',
  categories text[] not null default array['Hardware','Software','Network / WiFi','CCTV','Walkie-Talkie','Access / Accounts','Printer','Other'],
  technician_ids uuid[] not null default '{}',
  next_number integer not null default 1001,
  updated_at timestamptz not null default now()
);

create table if not exists public.helpdesk_tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  number integer not null,
  subject text not null check (length(trim(subject)) > 0),
  description text not null default '',
  status text not null default 'open' check (status in ('open','in_progress','waiting','closed')),
  priority text not null default 'medium' check (priority in ('critical','high','medium','low')),
  category text not null default 'Other',
  department text not null default '',
  location text not null default '',
  requester_id uuid references public.profiles(id) on delete set null,
  requester_name text not null default '',
  requester_email text not null default '',
  assignee_id uuid references public.profiles(id) on delete set null,
  assignee_name text not null default '',
  due_at timestamptz,
  resolution text not null default '',
  first_response_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, number)
);
create index if not exists helpdesk_tickets_org_status_idx on public.helpdesk_tickets (organization_id, status, created_at desc);
create index if not exists helpdesk_tickets_requester_idx on public.helpdesk_tickets (requester_id, created_at desc);

create table if not exists public.helpdesk_ticket_events (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  ticket_id uuid not null references public.helpdesk_tickets(id) on delete cascade,
  kind text not null check (kind in ('reply','note','log')),
  body text not null,
  author_id uuid references public.profiles(id) on delete set null,
  author_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists helpdesk_ticket_events_ticket_idx on public.helpdesk_ticket_events (ticket_id, created_at);

create table if not exists public.helpdesk_canned_replies (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  body text not null default '',
  created_at timestamptz not null default now()
);

-- Helpers ------------------------------------------------------------------------------------------
create or replace function public._helpdesk_settings(p_org text)
returns public.helpdesk_settings language plpgsql security definer set search_path = public as $$
declare s public.helpdesk_settings;
begin
  insert into public.helpdesk_settings (organization_id) values (p_org) on conflict (organization_id) do nothing;
  select * into s from public.helpdesk_settings where organization_id = p_org;
  return s;
end $$;
revoke all on function public._helpdesk_settings(text) from public, anon, authenticated;

-- Technicians: owners, department heads, and anyone listed in Helpdesk settings.
create or replace function public.helpdesk_is_agent()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.approved and p.is_active and (
      p.level in ('owner','dept_head')
      or exists (select 1 from public.helpdesk_settings s where s.organization_id = p.organization_id and p.id = any(s.technician_ids))
    ) from public.profiles p where p.id = auth.uid()
  ), false);
$$;
grant execute on function public.helpdesk_is_agent() to authenticated;

create or replace function public._helpdesk_notify(p_user uuid, p_org text, p_title text, p_msg text, p_type text, p_ticket uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select p_org, p_user, p_title, p_msg, p_type, 'helpdesk/ticket-' || p_ticket, p_ticket::text
  where p_user is not null and p_user is distinct from auth.uid();
$$;
revoke all on function public._helpdesk_notify(uuid, text, text, text, text, uuid) from public, anon, authenticated;

create or replace function public._helpdesk_log(p_ticket public.helpdesk_tickets, p_body text)
returns void language sql security definer set search_path = public as $$
  insert into public.helpdesk_ticket_events (organization_id, ticket_id, kind, body, author_id, author_name)
  values (p_ticket.organization_id, p_ticket.id, 'log', p_body, auth.uid(), coalesce((select name from public.profiles where id = auth.uid()), 'System'));
$$;
revoke all on function public._helpdesk_log(public.helpdesk_tickets, text) from public, anon, authenticated;

-- Number + SLA due time on create; closing rules and change log on update ---------------------------------
create or replace function public.helpdesk_tickets_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare s public.helpdesk_settings; hrs numeric; v_num integer;
begin
  if tg_op = 'INSERT' then
    s := public._helpdesk_settings(new.organization_id);
    update public.helpdesk_settings set next_number = next_number + 1, updated_at = now() where organization_id = new.organization_id returning next_number - 1 into v_num;
    new.number := v_num;
    hrs := coalesce((s.sla_hours ->> new.priority)::numeric, 24);
    new.due_at := coalesce(new.due_at, now() + make_interval(secs => hrs * 3600));
    new.created_at := now(); new.updated_at := now();
    if new.status = 'closed' then raise exception 'A new ticket cannot start closed.'; end if;
    return new;
  end if;
  new.number := old.number; new.organization_id := old.organization_id; new.created_at := old.created_at;
  new.requester_id := old.requester_id;
  if new.status = 'closed' and old.status <> 'closed' then
    if length(trim(new.resolution)) = 0 then raise exception 'Add a resolution before closing the ticket.'; end if;
    new.closed_at := now();
  elsif new.status <> 'closed' then
    new.closed_at := null;
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    new.assignee_name := coalesce((select name from public.profiles where id = new.assignee_id), '');
  end if;
  -- A priority change re-plans the due time from the SLA (unless the due time was also edited).
  if new.priority <> old.priority and new.due_at is not distinct from old.due_at then
    s := public._helpdesk_settings(new.organization_id);
    new.due_at := old.created_at + make_interval(secs => coalesce((s.sla_hours ->> new.priority)::numeric, 24) * 3600);
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists helpdesk_tickets_before on public.helpdesk_tickets;
create trigger helpdesk_tickets_before before insert or update on public.helpdesk_tickets
  for each row execute function public.helpdesk_tickets_before();

create or replace function public.helpdesk_tickets_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare s public.helpdesk_settings; t uuid; label text := '#' || new.number || ' ' || new.subject;
begin
  if tg_op = 'INSERT' then
    perform public._helpdesk_log(new, 'Ticket created by ' || coalesce(nullif(new.requester_name, ''), 'requester'));
    s := public._helpdesk_settings(new.organization_id);
    for t in select p.id from public.profiles p where p.organization_id = new.organization_id and p.approved and p.is_active
             and (p.level in ('owner','dept_head') or p.id = any(s.technician_ids)) loop
      perform public._helpdesk_notify(t, new.organization_id, 'New helpdesk ticket', label, case when new.priority = 'critical' then 'critical' else 'info' end, new.id);
    end loop;
    return new;
  end if;
  if new.status <> old.status then
    perform public._helpdesk_log(new, 'Status: ' || replace(old.status, '_', ' ') || ' → ' || replace(new.status, '_', ' '));
    if new.status = 'closed' then
      perform public._helpdesk_notify(new.requester_id, new.organization_id, 'Ticket closed', label || ' — ' || left(new.resolution, 140), 'info', new.id);
    elsif old.status = 'closed' then
      perform public._helpdesk_notify(new.assignee_id, new.organization_id, 'Ticket reopened', label, 'warning', new.id);
    end if;
  end if;
  if new.priority <> old.priority then perform public._helpdesk_log(new, 'Priority: ' || old.priority || ' → ' || new.priority); end if;
  if new.assignee_id is distinct from old.assignee_id then
    perform public._helpdesk_log(new, case when new.assignee_id is null then 'Unassigned' else 'Assigned to ' || new.assignee_name end);
    perform public._helpdesk_notify(new.assignee_id, new.organization_id, 'Ticket assigned to you', label, case when new.priority = 'critical' then 'critical' else 'info' end, new.id);
  end if;
  if new.category <> old.category then perform public._helpdesk_log(new, 'Category: ' || old.category || ' → ' || new.category); end if;
  if new.department <> old.department then perform public._helpdesk_log(new, 'Department: ' || coalesce(nullif(old.department, ''), '—') || ' → ' || coalesce(nullif(new.department, ''), '—')); end if;
  if new.location <> old.location then perform public._helpdesk_log(new, 'Location: ' || coalesce(nullif(old.location, ''), '—') || ' → ' || coalesce(nullif(new.location, ''), '—')); end if;
  if new.due_at is distinct from old.due_at then perform public._helpdesk_log(new, 'Due time changed'); end if;
  return new;
end $$;
drop trigger if exists helpdesk_tickets_after on public.helpdesk_tickets;
create trigger helpdesk_tickets_after after insert or update on public.helpdesk_tickets
  for each row execute function public.helpdesk_tickets_after();

-- Submitting (anyone signed in) and conversation (requester replies; technicians reply / note) ---------------
create or replace function public.helpdesk_submit(p_subject text, p_description text, p_category text, p_priority text, p_department text, p_location text, p_requester_name text default null, p_requester_email text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare me public.profiles; v_id uuid; agent boolean := public.helpdesk_is_agent();
begin
  select * into me from public.profiles p where p.id = auth.uid();
  if me.id is null or not me.approved or not me.is_active then raise exception 'Sign in with an approved account to raise a ticket.'; end if;
  if coalesce(trim(p_subject), '') = '' then raise exception 'Add a short subject.'; end if;
  insert into public.helpdesk_tickets (organization_id, subject, description, category, priority, department, location, requester_id, requester_name, requester_email)
  values (me.organization_id, trim(p_subject), coalesce(p_description, ''), coalesce(nullif(trim(p_category), ''), 'Other'),
          case when p_priority in ('critical','high','medium','low') then p_priority else 'medium' end,
          coalesce(p_department, ''), coalesce(p_location, ''),
          -- Technicians may log a ticket on someone's behalf; it stays theirs to track only if they are the requester.
          case when agent and coalesce(trim(p_requester_name), '') <> '' then null else me.id end,
          case when agent and coalesce(trim(p_requester_name), '') <> '' then trim(p_requester_name) else me.name end,
          case when agent and coalesce(trim(p_requester_name), '') <> '' then coalesce(trim(p_requester_email), '') else coalesce(me.email, '') end)
  returning helpdesk_tickets.id into v_id;
  return v_id;
end $$;
grant execute on function public.helpdesk_submit(text, text, text, text, text, text, text, text) to authenticated;

create or replace function public.helpdesk_post(p_ticket uuid, p_kind text, p_body text, p_reopen boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare t public.helpdesk_tickets; me public.profiles; agent boolean := public.helpdesk_is_agent();
begin
  select * into me from public.profiles p where p.id = auth.uid();
  select * into t from public.helpdesk_tickets h where h.id = p_ticket and organization_id = me.organization_id for update;
  if t.id is null then raise exception 'Ticket not found.'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'Write a message first.'; end if;
  if not agent then
    if t.requester_id is distinct from me.id then raise exception 'You can only reply to your own tickets.'; end if;
    if p_kind <> 'reply' then raise exception 'Only technicians can add internal notes.'; end if;
  elsif p_kind not in ('reply','note') then raise exception 'Unknown message type.';
  end if;
  insert into public.helpdesk_ticket_events (organization_id, ticket_id, kind, body, author_id, author_name)
  values (t.organization_id, t.id, p_kind, trim(p_body), me.id, me.name);
  if agent and p_kind = 'reply' and t.first_response_at is null then
    update public.helpdesk_tickets set first_response_at = now() where id = t.id;
  end if;
  if agent and p_kind = 'reply' then
    perform public._helpdesk_notify(t.requester_id, t.organization_id, 'Reply on your ticket', '#' || t.number || ' ' || t.subject, 'info', t.id);
  elsif not agent then
    perform public._helpdesk_notify(t.assignee_id, t.organization_id, 'Requester replied', '#' || t.number || ' ' || t.subject, 'info', t.id);
    if p_reopen and t.status = 'closed' then
      update public.helpdesk_tickets set status = 'open', resolution = '' where id = t.id;
    elsif t.status = 'waiting' then
      update public.helpdesk_tickets set status = 'open' where id = t.id;  -- answered: back in the queue
    end if;
  end if;
end $$;
grant execute on function public.helpdesk_post(uuid, text, text, boolean) to authenticated;

-- Row level security ---------------------------------------------------------------------------------------
alter table public.helpdesk_settings enable row level security;
alter table public.helpdesk_tickets enable row level security;
alter table public.helpdesk_ticket_events enable row level security;
alter table public.helpdesk_canned_replies enable row level security;

drop policy if exists helpdesk_settings_read on public.helpdesk_settings;
create policy helpdesk_settings_read on public.helpdesk_settings for select using (organization_id = public.current_organization_id());
drop policy if exists helpdesk_settings_write on public.helpdesk_settings;
create policy helpdesk_settings_write on public.helpdesk_settings for all
  using (organization_id = public.current_organization_id() and public.current_level() in ('owner','dept_head'))
  with check (organization_id = public.current_organization_id() and public.current_level() in ('owner','dept_head'));

drop policy if exists helpdesk_tickets_read on public.helpdesk_tickets;
create policy helpdesk_tickets_read on public.helpdesk_tickets for select using (
  organization_id = public.current_organization_id() and (public.helpdesk_is_agent() or requester_id = auth.uid())
);
drop policy if exists helpdesk_tickets_update on public.helpdesk_tickets;
create policy helpdesk_tickets_update on public.helpdesk_tickets for update
  using (organization_id = public.current_organization_id() and public.helpdesk_is_agent())
  with check (organization_id = public.current_organization_id() and public.helpdesk_is_agent());
drop policy if exists helpdesk_tickets_delete on public.helpdesk_tickets;
create policy helpdesk_tickets_delete on public.helpdesk_tickets for delete
  using (organization_id = public.current_organization_id() and public.helpdesk_is_agent());
-- Tickets are created only through helpdesk_submit, so requester fields can be trusted.
revoke insert on public.helpdesk_tickets from authenticated;

drop policy if exists helpdesk_events_read on public.helpdesk_ticket_events;
create policy helpdesk_events_read on public.helpdesk_ticket_events for select using (
  organization_id = public.current_organization_id() and (
    public.helpdesk_is_agent()
    or (kind <> 'note' and exists (select 1 from public.helpdesk_tickets t where t.id = ticket_id and t.requester_id = auth.uid()))
  )
);
revoke insert, update, delete on public.helpdesk_ticket_events from authenticated;

drop policy if exists helpdesk_canned_read on public.helpdesk_canned_replies;
create policy helpdesk_canned_read on public.helpdesk_canned_replies for select
  using (organization_id = public.current_organization_id() and public.helpdesk_is_agent());
drop policy if exists helpdesk_canned_write on public.helpdesk_canned_replies;
create policy helpdesk_canned_write on public.helpdesk_canned_replies for all
  using (organization_id = public.current_organization_id() and public.helpdesk_is_agent())
  with check (organization_id = public.current_organization_id() and public.helpdesk_is_agent());

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.helpdesk_tickets'; exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.helpdesk_ticket_events'; exception when duplicate_object then null; end;
end $$;
notify pgrst, 'reload schema';
