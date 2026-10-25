-- ============================================================================
-- v117 · One way to return or transfer a walkie, from any screen
-- ----------------------------------------------------------------------------
-- Before: the Returns tab freed radios in the browser and only closed the allocations loaded on screen
-- (those of the event chosen in "Working on"), and never told the event walkie request; the request's
-- own return freed the first N radios of the batch, not the ones handed back, and never reduced the
-- batch's chargers / earphones. A transfer lost the event and the request link.
-- Now both screens use these server functions:
--   walkie_return(ids, chargers, earphones, remarks)   frees exactly these radios; trims or closes every
--                                                      active allocation holding them (any event); updates
--                                                      the event request they came from
--   event_radio_request_return(...)                    same signature as before, now calls walkie_return
--   walkie_transfer(id, department, chargers, earphones, remarks)
--                                                      moves one radio to another department, keeping the
--                                                      batch's event; the request counts it as transferred
-- Apply after migration_v116_requester_sees_only_while_in_department.sql. Safe to re-run.
-- ============================================================================

-- Walkie team (the same people the browser allowed before: Admin / Operator of this organization).
create or replace function public._walkie_team_check()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.current_is_active() or not public.current_approved()
     or public.current_role() not in ('Admin','Operator') then
    raise exception 'Only the Walkie team can do this.';
  end if;
end $$;
revoke all on function public._walkie_team_check() from public, anon, authenticated;

-- Record radios (and accessories) coming back on an event request; closes it when everything is back.
create or replace function public._event_radio_request_take_back(p_request text, p_walkies integer, p_chargers integer,
  p_earphones integer, p_batch_closed boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.event_radio_requests%rowtype; nw integer; nc integer; ne integer; ns text;
begin
  select * into r from public.event_radio_requests where id = p_request for update;
  if not found or r.status not in ('delivered','partial_return') then return; end if;
  nw := least(r.delivered_walkies, r.returned_walkies + p_walkies);
  -- A batch that closes takes its remaining accessories back with it (the existing rule).
  nc := case when p_batch_closed then r.delivered_chargers else least(r.delivered_chargers, r.returned_chargers + p_chargers) end;
  ne := case when p_batch_closed then r.delivered_earphones else least(r.delivered_earphones, r.returned_earphones + p_earphones) end;
  ns := case when nw >= r.delivered_walkies and nc >= r.delivered_chargers and ne >= r.delivered_earphones then 'returned' else 'partial_return' end;
  update public.event_radio_requests
    set status = ns, returned_walkies = nw, returned_chargers = nc, returned_earphones = ne,
        returned_at = case when ns = 'returned' then now() else returned_at end,
        return_feedback = concat_ws(E'\n', nullif(return_feedback, ''), nullif(trim(coalesce(p_note, '')), '')),
        updated_at = now()
    where id = p_request;
end $$;
revoke all on function public._event_radio_request_take_back(text,integer,integer,integer,boolean,text) from public, anon, authenticated;

-- 1. Return radios. p_chargers / p_earphones: accessories handed back with them (null → the batch's share).
create or replace function public.walkie_return(p_walkie_ids jsonb, p_chargers integer default null,
  p_earphones integer default null, p_remarks text default '')
returns integer language plpgsql security definer set search_path = public as $$
declare
  org text := public.current_organization_id(); ids text[]; freed integer; a record; remaining jsonb;
  total integer; n integer; closed boolean; take_c integer; take_e integer;
  left_c integer := p_chargers; left_e integer := p_earphones; blocked text;
begin
  perform public._walkie_team_check();
  select array_agg(distinct x) into ids from jsonb_array_elements_text(coalesce(p_walkie_ids, '[]'::jsonb)) x;
  if ids is null then raise exception 'Choose the radios being returned.'; end if;
  if coalesce(p_chargers, 0) < 0 or coalesce(p_earphones, 0) < 0 then raise exception 'Accessory counts cannot be negative.'; end if;

  -- Radios allocated to an event request that is not handed over yet cannot be returned from here.
  select string_agg(distinct q.department_name, ', ') into blocked
  from public.allocations al join public.event_radio_requests q on q.id = al.event_radio_request_id
  where al.organization_id = org and al.status = 'Active' and q.status = 'ready'
    and exists (select 1 from jsonb_array_elements_text(al.walkie_ids) w where w = any(ids));
  if blocked is not null then
    raise exception 'Some of these radios are allocated to % but not handed over yet. Hand them over first.', blocked;
  end if;

  update public.walkies
    set status = 'Available', department_id = null, channel = '', assigned_person_name = null, assigned_person_contact = null
    where organization_id = org and id = any(ids) and status = 'Allocated';
  get diagnostics freed = row_count;
  if freed <> array_length(ids, 1) then raise exception 'Only allocated radios can be returned.'; end if;

  for a in select * from public.allocations
           where organization_id = org and status = 'Active'
             and exists (select 1 from jsonb_array_elements_text(walkie_ids) w where w = any(ids))
           order by created_at for update loop
    select coalesce(jsonb_agg(w), '[]'::jsonb) into remaining
      from jsonb_array_elements_text(a.walkie_ids) w where not (w = any(ids));
    total := jsonb_array_length(a.walkie_ids);
    n := total - jsonb_array_length(remaining);
    closed := jsonb_array_length(remaining) = 0;
    if closed then
      take_c := coalesce(a.charger_count, 0);
      take_e := coalesce(a.earphone_count, 0);
      update public.allocations set status = 'Returned', returned_date = current_date where id = a.id;
    else
      take_c := least(coalesce(a.charger_count, 0), coalesce(left_c, (coalesce(a.charger_count, 0) * n) / total));
      take_e := least(coalesce(a.earphone_count, 0), coalesce(left_e, (coalesce(a.earphone_count, 0) * n) / total));
      update public.allocations
        set walkie_ids = remaining, charger_count = coalesce(charger_count, 0) - take_c, earphone_count = coalesce(earphone_count, 0) - take_e
        where id = a.id;
    end if;
    if left_c is not null then left_c := greatest(left_c - take_c, 0); end if;
    if left_e is not null then left_e := greatest(left_e - take_e, 0); end if;
    if a.event_radio_request_id is not null then
      perform public._event_radio_request_take_back(a.event_radio_request_id, n, take_c, take_e, closed, p_remarks);
    end if;
  end loop;

  insert into public.history (id, action, details, type, organization_id)
  values ('hist-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), 'Walkies Returned',
          'Returned ' || freed || ' walkie(s) back to inventory by ' || coalesce(public.current_name(), 'someone') ||
          '. Remarks: ' || coalesce(nullif(trim(coalesce(p_remarks, '')), ''), 'None'), 'success', org);
  return freed;
end $$;
revoke all on function public.walkie_return(jsonb,integer,integer,text) from public, anon;
grant execute on function public.walkie_return(jsonb,integer,integer,text) to authenticated;

-- 2. The event request's return: the radios actually handed back, then the shared return.
create or replace function public.event_radio_request_return(p_id text, p_walkie_ids jsonb, p_walkies integer,
  p_chargers integer, p_earphones integer, p_feedback text default '')
returns void language plpgsql security definer set search_path = public as $$
declare r public.event_radio_requests%rowtype; outside integer;
begin
  perform public._walkie_team_check();
  select * into r from public.event_radio_requests where id = p_id and organization_id = public.current_organization_id();
  if not found or r.status not in ('delivered','partial_return') then raise exception 'This request has no handed-over radios to return.'; end if;
  if trim(coalesce(p_feedback, '')) = '' then raise exception 'Add the department''s feedback.'; end if;
  if jsonb_array_length(coalesce(p_walkie_ids, '[]'::jsonb)) <> p_walkies or p_walkies < 1 then
    raise exception 'Tick the radios being returned.';
  end if;
  select count(*) into outside from jsonb_array_elements_text(p_walkie_ids) x
    where not exists (select 1 from jsonb_array_elements_text(r.allocated_walkie_ids) y where y = x);
  if outside > 0 then raise exception 'Some of these radios were not given on this request.'; end if;
  if p_chargers > r.delivered_chargers - r.returned_chargers or p_earphones > r.delivered_earphones - r.returned_earphones then
    raise exception 'More accessories than are still out on this request.';
  end if;
  perform public.walkie_return(p_walkie_ids, p_chargers, p_earphones, p_feedback);
end $$;
revoke all on function public.event_radio_request_return(text,jsonb,integer,integer,integer,text) from public, anon;
grant execute on function public.event_radio_request_return(text,jsonb,integer,integer,integer,text) to authenticated;

-- 3. Transfer one radio to another department (accessories may move with it).
create or replace function public.walkie_transfer(p_walkie_id text, p_target_department text, p_chargers integer default 0,
  p_earphones integer default 0, p_remarks text default '')
returns text language plpgsql security definer set search_path = public as $$
declare
  org text := public.current_organization_id(); w public.walkies%rowtype; tgt public.departments%rowtype;
  src_name text; a public.allocations%rowtype; has_batch boolean := false; remaining jsonb; new_id text;
  c integer := greatest(coalesce(p_chargers, 0), 0); e integer := greatest(coalesce(p_earphones, 0), 0);
begin
  perform public._walkie_team_check();
  select * into w from public.walkies where id = p_walkie_id and organization_id = org for update;
  if not found then raise exception 'Radio not found.'; end if;
  if w.status <> 'Allocated' then raise exception 'Only allocated radios can be transferred.'; end if;
  select * into tgt from public.departments where id = p_target_department and organization_id = org;
  if not found then raise exception 'Choose the department to transfer to.'; end if;
  if w.department_id = tgt.id then raise exception 'This radio is already with %.', tgt.name; end if;
  select name into src_name from public.departments where id = w.department_id;

  select * into a from public.allocations
    where organization_id = org and status = 'Active' and walkie_ids ? p_walkie_id
    order by created_at desc limit 1 for update;
  has_batch := found;
  if c > coalesce(a.charger_count, 0) or e > coalesce(a.earphone_count, 0) then
    raise exception 'This radio''s batch holds only % charger(s) and % earphone(s).', coalesce(a.charger_count, 0), coalesce(a.earphone_count, 0);
  end if;

  new_id := 'alloc-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 4);
  insert into public.allocations (id, department_id, walkie_ids, date, allocated_by, remarks, status, charger_count, earphone_count, event_id, organization_id)
  values (new_id, tgt.id, jsonb_build_array(p_walkie_id), current_date, coalesce(public.current_name(), ''),
          trim('Transferred from ' || coalesce(src_name, 'Unknown') || '. ' || coalesce(p_remarks, '')), 'Active', c, e,
          case when has_batch then a.event_id else null end, org);
  update public.walkies set department_id = tgt.id, channel = coalesce(tgt.channel_number, '') where id = p_walkie_id;

  if has_batch then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into remaining from jsonb_array_elements_text(a.walkie_ids) x where x <> p_walkie_id;
    if jsonb_array_length(remaining) = 0 then
      update public.allocations set status = 'Returned', returned_date = current_date where id = a.id;
    else
      update public.allocations
        set walkie_ids = remaining, charger_count = coalesce(charger_count, 0) - c, earphone_count = coalesce(earphone_count, 0) - e
        where id = a.id;
    end if;
    -- The radio left the requesting department: the request counts it as given back.
    if a.event_radio_request_id is not null then
      perform public._event_radio_request_take_back(a.event_radio_request_id, 1, c, e, jsonb_array_length(remaining) = 0,
        '1 walkie transferred to ' || tgt.name || coalesce(nullif(' · ' || trim(coalesce(p_remarks, '')), ' · '), ''));
    end if;
  end if;

  insert into public.history (id, action, details, type, organization_id)
  values ('hist-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), 'Walkie Transferred',
          coalesce(w.label, w.id) || ' moved from ' || coalesce(src_name, 'Unknown') || ' to ' || tgt.name ||
          ' (channel ' || coalesce(tgt.channel_number, '—') || ') by ' || coalesce(public.current_name(), 'someone') ||
          case when c + e > 0 then ' with ' || c || ' charger(s) and ' || e || ' earphone(s)' else '' end, 'info', org);
  return new_id;
end $$;
revoke all on function public.walkie_transfer(text,text,integer,integer,text) from public, anon;
grant execute on function public.walkie_transfer(text,text,integer,integer,text) to authenticated;

notify pgrst, 'reload schema';
