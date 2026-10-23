-- ============================================================================
-- Clear all purchase payment requests
-- Run in the Supabase SQL editor whenever the payment-request list should be wiped.
--
-- Deletes rows from public.purchase_payment_requests only. Payments already made
-- (public.purchase_payments) and each order's paid amount are NOT touched; nothing
-- else references these rows. Pending/approved requests no longer count against an
-- order's "already asked" amount, so Purchase can ask again.
--
-- Not reversible. Step 1 previews what will go; step 2 deletes.
-- To limit it to one organization, uncomment the "where organization_id" lines and
-- put the organization id in both places.
-- ============================================================================

-- ── 1. Preview ──────────────────────────────────────────────────────────────
select organization_id, status, count(*) as requests, sum(amount) as total_amount
from public.purchase_payment_requests
-- where organization_id = 'YOUR-ORG-ID'
group by organization_id, status
order by organization_id, status;

-- ── 2. Delete ───────────────────────────────────────────────────────────────
begin;
delete from public.purchase_payment_requests
-- where organization_id = 'YOUR-ORG-ID'
;
commit;
