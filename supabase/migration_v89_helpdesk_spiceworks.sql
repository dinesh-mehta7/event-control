-- Help Desk, Spiceworks parity: time spent on responses/notes, ticket tasks, related inventory item,
-- and category → technician auto-assignment rules. Run after migration_v87_helpdesk.sql.

alter table public.helpdesk_ticket_events add column if not exists minutes integer not null default 0 check (minutes >= 0);
alter table public.helpdesk_tickets
  add column if not exists tasks jsonb not null default '[]'::jsonb,            -- [{ "id": "...", "title": "...", "done": false }]
  add column if not exists asset_item_id text references public.inventory_items(id) on delete set null,
  add column if not exists asset_name text not null default '';
alter table public.helpdesk_settings
  add column if not exists category_rules jsonb not null default '{}'::jsonb;  -- { "Printer": "<technician profile id>" }

-- Auto-assign on create: a category rule picks the technician when nobody is assigned yet.
create or replace function public.helpdesk_tickets_autoassign()
returns trigger language plpgsql security definer set search_path = public as $$
declare rule text;
begin
  if new.assignee_id is null then
    select category_rules ->> new.category into rule from public.helpdesk_settings where organization_id = new.organization_id;
    if rule is not null and rule <> '' then
      new.assignee_id := rule::uuid;
      new.assignee_name := coalesce((select name from public.profiles where id = new.assignee_id), '');
    end if;
  end if;
  return new;
end $$;
-- Named to run after helpdesk_tickets_before (same-kind triggers fire in name order).
drop trigger if exists helpdesk_tickets_z_autoassign on public.helpdesk_tickets;
create trigger helpdesk_tickets_z_autoassign before insert on public.helpdesk_tickets
  for each row execute function public.helpdesk_tickets_autoassign();

-- Change log for the new fields (the v87 log trigger covers the rest).
create or replace function public.helpdesk_tickets_after_extra()
returns trigger language plpgsql security definer set search_path = public as $$
declare done_before int; done_after int;
begin
  if tg_op = 'INSERT' then
    if new.assignee_id is not null then
      perform public._helpdesk_log(new, 'Auto-assigned to ' || new.assignee_name || ' (' || new.category || ' rule)');
      perform public._helpdesk_notify(new.assignee_id, new.organization_id, 'Ticket assigned to you', '#' || new.number || ' ' || new.subject, case when new.priority = 'critical' then 'critical' else 'info' end, new.id);
    end if;
    return new;
  end if;
  if new.asset_item_id is distinct from old.asset_item_id then
    perform public._helpdesk_log(new, case when new.asset_item_id is null then 'Related item removed' else 'Related item: ' || new.asset_name end);
  end if;
  select count(*) into done_before from jsonb_array_elements(old.tasks) t where (t ->> 'done')::boolean;
  select count(*) into done_after from jsonb_array_elements(new.tasks) t where (t ->> 'done')::boolean;
  if jsonb_array_length(new.tasks) <> jsonb_array_length(old.tasks) or done_after <> done_before then
    perform public._helpdesk_log(new, 'Tasks: ' || done_after || ' of ' || jsonb_array_length(new.tasks) || ' done');
  end if;
  return new;
end $$;
drop trigger if exists helpdesk_tickets_after_extra on public.helpdesk_tickets;
create trigger helpdesk_tickets_after_extra after insert or update on public.helpdesk_tickets
  for each row execute function public.helpdesk_tickets_after_extra();

-- Responses and notes can carry time spent (technicians only). Replaces the v87 signature.
drop function if exists public.helpdesk_post(uuid, text, text, boolean);
create or replace function public.helpdesk_post(p_ticket uuid, p_kind text, p_body text, p_reopen boolean default false, p_minutes integer default 0)
returns void language plpgsql security definer set search_path = public as $$
declare t public.helpdesk_tickets; me public.profiles; agent boolean := public.helpdesk_is_agent(); mins integer := greatest(coalesce(p_minutes, 0), 0);
begin
  select * into me from public.profiles p where p.id = auth.uid();
  select * into t from public.helpdesk_tickets h where h.id = p_ticket and organization_id = me.organization_id for update;
  if t.id is null then raise exception 'Ticket not found.'; end if;
  if coalesce(trim(p_body), '') = '' and mins = 0 then raise exception 'Write a message first.'; end if;
  if not agent then
    if t.requester_id is distinct from me.id then raise exception 'You can only reply to your own tickets.'; end if;
    if p_kind <> 'reply' then raise exception 'Only technicians can add internal notes.'; end if;
    mins := 0;
  elsif p_kind not in ('reply','note') then raise exception 'Unknown message type.';
  end if;
  insert into public.helpdesk_ticket_events (organization_id, ticket_id, kind, body, author_id, author_name, minutes)
  values (t.organization_id, t.id, p_kind, coalesce(nullif(trim(p_body), ''), 'Time logged'), me.id, me.name, mins);
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
      update public.helpdesk_tickets set status = 'open' where id = t.id;
    end if;
  end if;
end $$;
grant execute on function public.helpdesk_post(uuid, text, text, boolean, integer) to authenticated;

notify pgrst, 'reload schema';
