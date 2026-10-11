-- All requests retain their selected department for reporting and fulfilment,
-- but the IT Department Admin reviews every request in the organization.
-- Apply after migration_v40_request_review_plan.sql.

do $$
declare
  fn text;
  def text;
begin
  fn := 'public.request_submit(text,text,date,text,text,text,jsonb)';
  def := pg_get_functiondef(fn::regprocedure);
  if def !~ 'h\.department_id\s*=\s*p_department_id\s+and\s+h\.level\s*=' then
    raise exception 'Could not find department-scoped reviewer routing in request_submit.';
  end if;
  def := regexp_replace(def, 'h\.department_id\s*=\s*p_department_id\s+and\s+', '', 'g');
  def := replace(def, 'No active Department Admin is assigned to this department.', 'No active IT Department Head is available to review requests.');
  execute def;

  fn := 'public.request_it_decide(text,text,text,jsonb)';
  def := pg_get_functiondef(fn::regprocedure);
  if def !~ 'if\s+r\.department_id\s+is\s+distinct\s+from\s+me\.department_id\s+then' then
    raise exception 'Could not find department-scoped reviewer validation in request_it_decide.';
  end if;
  def := regexp_replace(def,
    'if\s+r\.department_id\s+is\s+distinct\s+from\s+me\.department_id\s+then\s+raise\s+exception\s+''This request belongs to another department\.'';\s+end if;',
    '', 'g');
  def := replace(def, 'Only an active Department Admin can review this.', 'Only an active IT Department Head can review this.');
  execute def;
end $$;

-- Make already-open requests visible to the IT Department Head as well. Avoid
-- duplicating an approval notification already sent to that same reviewer.
do $$
declare r record; h record;
begin
  for r in select id, number, title, organization_id from public.requests where status='pending_it' loop
    for h in select id from public.profiles where organization_id=r.organization_id and level='dept_head' and approved and is_active loop
      if not exists (select 1 from public.notifications n where n.ref_id=r.id and n.user_id=h.id and n.type='approval') then
        perform public._req_notify(h.id,r.organization_id,'Request to review: '||r.title,r.number||' needs your review.','approval',r.id);
      end if;
    end loop;
  end loop;
end $$;

select pg_notify('pgrst','reload schema');
