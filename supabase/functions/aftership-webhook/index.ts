import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const secret = Deno.env.get('AFTERSHIP_WEBHOOK_SECRET');
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret || !url || !serviceKey) return json({ error: 'Webhook is not configured.' }, 503);
  const raw = await req.text();
  const signature = req.headers.get('aftership-hmac-sha256') || '';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = toBase64(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw))));
  const a = new TextEncoder().encode(signature); const b = new TextEncoder().encode(digest);
  if (!signature || a.length !== b.length) return json({ error: 'Invalid webhook signature.' }, 401);
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (diff !== 0) return json({ error: 'Invalid webhook signature.' }, 401);
  const payload = JSON.parse(raw);
  const tracking = payload?.data?.tracking || payload?.tracking || payload?.data || null;
  const trackingNumber = String(tracking?.tracking_number || '').trim();
  if (!trackingNumber) return json({ received: true }); // e.g. AfterShip's endpoint verification ping
  const aftershipId = String(tracking?.id || '').trim();
  if (!aftershipId) return json({ received: true });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const checkpoints = Array.isArray(tracking.checkpoints) ? tracking.checkpoints : [];
  const eventTime = tracking.last_checkpoint_time || checkpoints.at(-1)?.checkpoint_time || new Date().toISOString();
  const { error } = await admin.from('purchase_trackings').update({
    courier_slug: tracking.slug || '', aftership_id: tracking.id || '', status: tracking.tag || tracking.status || 'In transit',
    sub_status: tracking.subtag_message || tracking.subtag || '', tracking_url: tracking.courier_tracking_link || '',
    estimated_delivery: tracking.expected_delivery || null, checkpoints, last_event_at: eventTime, updated_at: new Date().toISOString(),
  }).eq('aftership_id', aftershipId).eq('tracking_number', trackingNumber);
  if (error) return json({ error: 'Could not save tracking update.' }, 500);
  return json({ received: true });
});
