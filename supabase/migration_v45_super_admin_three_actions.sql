-- Super Admin only decides the saved IT Department Head plan.
-- Apply after migration_v44_require_arrangement_before_escalation.sql.

drop function if exists public.request_owner_decide(text, boolean, text, jsonb);

create or replace function public.request_owner_decide(p_id text, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare r record; total numeric;
begin
  if not public.is_org_owner() then raise exception 'Only the Super Admin can decide escalated requests.'; end if;
  select * into r from public.requests where id=p_id for update;
  if not found or r.organization_id <> public.current_organization_id() then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_owner' then raise exception 'This request is not waiting for the Super Admin.'; end if;
  if p_action is null or p_action not in ('approve','send_back','reject') then raise exception 'Choose approve, send back, or reject.'; end if;

  if p_action='send_back' then
    update public.requests set status='pending_it', updated_at=now() where id=p_id;
    perform public._req_event(p_id,'sent_back','Sent back to the IT Department Head for review.');
    perform public._req_notify_group(p_id,'it_head','Request sent back: '||r.title,r.number||' needs another review.','approval');
    perform public._req_notify(r.requester_id,r.organization_id,'Request sent back for review',r.number||' was sent back to the IT Department Head.','info',p_id);
    return;
  end if;

  if p_action='reject' then
    update public.requests set status='rejected', updated_at=now() where id=p_id;
    perform public._req_event(p_id,'rejected','Rejected by the Super Admin.');
    perform public._req_notify(r.requester_id,r.organization_id,'Request rejected',r.number||' was rejected by the Super Admin.','warning',p_id);
    return;
  end if;

  total := public._request_commit_review_plan(p_id);
end $$;
revoke all on function public.request_owner_decide(text,text) from public, anon;
grant execute on function public.request_owner_decide(text,text) to authenticated;

select pg_notify('pgrst','reload schema');
