import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
const icsEscape = (value: unknown) => String(value ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const asIcsDate = (value: string) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const base64 = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

const sendResend = async (to: string, subject: string, html: string, attachment?: { filename: string; content: string }) => {
  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('RESEND_FROM_EMAIL');
  if (!key || !from) throw new Error('Resend email is not configured. Add RESEND_API_KEY and RESEND_FROM_EMAIL to Supabase Function secrets.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html, ...(attachment ? { attachments: [attachment] } : {}) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || payload?.name || `Resend returned ${response.status}.`);
};

const outlookConfig = () => ({
  tenant: Deno.env.get('OUTLOOK_TENANT_ID') || '',
  clientId: Deno.env.get('OUTLOOK_CLIENT_ID') || '',
  clientSecret: Deno.env.get('OUTLOOK_CLIENT_SECRET') || '',
  mailbox: Deno.env.get('OUTLOOK_CALENDAR_USER') || '',
});

const createOutlookEvent = async (meeting: any, recipients: any[]) => {
  const { tenant, clientId, clientSecret, mailbox } = outlookConfig();
  if (![tenant, clientId, clientSecret, mailbox].every(Boolean)) {
    return { booked: false, warning: 'Outlook calendar is not connected yet. Add the Microsoft Graph secrets described in supabase/README.md.' };
  }

  const tokenResponse = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
  });
  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenPayload.access_token) throw new Error(tokenPayload.error_description || `Microsoft sign-in returned ${tokenResponse.status}.`);

  const start = new Date(meeting.starts_at);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const content = [meeting.agenda, meeting.message, meeting.link ? `Join meeting: ${meeting.link}` : ''].filter(Boolean).map(esc).join('<br><br>');
  const event = {
    subject: meeting.title,
    body: { contentType: 'HTML', content },
    start: { dateTime: start.toISOString().replace(/\.\d{3}Z$/, ''), timeZone: 'UTC' },
    end: { dateTime: end.toISOString().replace(/\.\d{3}Z$/, ''), timeZone: 'UTC' },
    showAs: 'busy',
    responseRequested: true,
    transactionId: meeting.id,
    attendees: recipients.map(person => ({
      emailAddress: { address: String(person.email || '').trim(), name: String(person.name || '').trim() },
      type: 'required',
    })).filter(attendee => attendee.emailAddress.address),
    ...(meeting.mode === 'offline' && meeting.place ? { location: { displayName: meeting.place } } : {}),
  };
  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/calendar/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenPayload.access_token}`, 'Content-Type': 'application/json', Prefer: 'outlook.timezone="UTC"' },
    body: JSON.stringify(event),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Microsoft Graph returned ${response.status}.`);
  return { booked: true, webLink: payload.webLink || '' };
};

const createTeamsMeeting = async (meeting: any) => {
  const { tenant, clientId, clientSecret, mailbox } = outlookConfig();
  if (![tenant, clientId, clientSecret, mailbox].every(Boolean)) {
    return { joinUrl: '', warning: 'Teams meeting automation is not connected. Configure Microsoft Graph and Teams OnlineMeetings permissions.' };
  }
  const tokenResponse = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
  });
  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenPayload.access_token) throw new Error(tokenPayload.error_description || `Microsoft sign-in returned ${tokenResponse.status}.`);
  const start = new Date(meeting.starts_at);
  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/onlineMeetings`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokenPayload.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject: meeting.title, startDateTime: start.toISOString(), endDateTime: new Date(start.getTime() + 60 * 60 * 1000).toISOString() }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.joinWebUrl) throw new Error(payload?.error?.message || `Microsoft Graph Teams meeting returned ${response.status}.`);
  return { joinUrl: payload.joinWebUrl, onlineMeetingId: payload.id };
};

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !serviceKey) return json({ error: 'Workflow email is not configured for this Supabase project.' }, 503);
  const bearer = req.headers.get('Authorization');
  if (!bearer) return json({ error: 'Sign in first.' }, 401);
  const userClient = createClient(url, anon, { global: { headers: { Authorization: bearer } }, auth: { persistSession: false } });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: 'Your session has expired. Sign in again.' }, 401);
  const { data: profile } = await userClient.from('profiles').select('id,organization_id,level,approved,is_active').eq('id', user.id).maybeSingle();
  if (!profile?.approved || !profile.is_active || !profile.organization_id) return json({ error: 'Your account is not active.' }, 403);

  const input = await req.json().catch(() => null);
  const kind = String(input?.kind || '');
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const appUrl = (Deno.env.get('APP_BASE_URL') || 'https://event-control-weld.vercel.app').replace(/\/$/, '');
  try {
    if (kind === 'meeting_auto_minutes') {
      const meetingId = String(input?.meeting_id || '');
      if (!meetingId || !['owner', 'dept_head', 'sub_dept_head'].includes(profile.level)) return json({ error: 'Only meeting organizers can generate meeting minutes.' }, 403);
      const { data: meeting } = await admin.from('meetings').select('*').eq('id', meetingId).eq('organization_id', profile.organization_id).maybeSingle();
      if (!meeting || meeting.kind !== 'meeting' || (meeting.created_by !== user.id && !['owner', 'dept_head'].includes(profile.level))) return json({ error: 'Meeting not found or you are not allowed to generate its minutes.' }, 404);
      if (meeting.status !== 'done') return json({ error: 'Mark the meeting done before generating minutes.' }, 409);
      if (meeting.minutes) return json({ generated: false, alreadyExists: true });
      if (!meeting.teams_online_meeting_id) return json({ error: 'This meeting has no Teams transcript reference. Automatic minutes require a Teams meeting created by the app.' }, 409);
      const { tenant, clientId, clientSecret, mailbox } = outlookConfig();
      if (![tenant, clientId, clientSecret, mailbox].every(Boolean)) return json({ error: 'Teams transcript access is not configured. Add the Microsoft Graph secrets and transcript permissions.' }, 503);
      const openAiKey = Deno.env.get('OPENAI_API_KEY');
      if (!openAiKey) return json({ error: 'Automatic minutes are not configured. Add OPENAI_API_KEY to Supabase Edge Function secrets.' }, 503);
      const tokenResponse = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
      });
      const tokenPayload = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !tokenPayload.access_token) throw new Error(tokenPayload.error_description || `Microsoft sign-in returned ${tokenResponse.status}.`);
      const graphBase = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/onlineMeetings/${encodeURIComponent(meeting.teams_online_meeting_id)}`;
      const transcriptResponse = await fetch(`${graphBase}/transcripts`, { headers: { Authorization: `Bearer ${tokenPayload.access_token}` } });
      const transcriptList = await transcriptResponse.json().catch(() => ({}));
      if (!transcriptResponse.ok) throw new Error(transcriptList?.error?.message || `Teams transcript lookup returned ${transcriptResponse.status}.`);
      const transcript = transcriptList?.value?.[0];
      if (!transcript) return json({ error: 'The Teams transcript is not ready yet. Turn on transcription for the meeting, then retry minutes generation.' }, 409);
      const contentResponse = await fetch(`${graphBase}/transcripts/${encodeURIComponent(transcript.id)}/content?$format=text/vtt`, { headers: { Authorization: `Bearer ${tokenPayload.access_token}` } });
      const vtt = await contentResponse.text();
      if (!contentResponse.ok) throw new Error(`Teams transcript download returned ${contentResponse.status}.`);
      const transcriptText = vtt.split(/\r?\n/).filter(line => line.trim() && !/^WEBVTT|^NOTE|^\d+$|^\d{2}:\d{2}/.test(line.trim())).join('\n').slice(0, 100000);
      if (!transcriptText.trim()) return json({ error: 'The Teams transcript is empty. No minutes were generated.' }, 409);
      const aiResponse = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { Authorization: `Bearer ${openAiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: Deno.env.get('OPENAI_MINUTES_MODEL') || 'gpt-4.1-mini', instructions: 'Create accurate meeting minutes from the transcript. Return a concise summary, decisions, and action items with owner and due date only when explicitly stated. Never invent facts. Mark unspecified owners or dates as Not specified.', input: `Meeting: ${meeting.title}\n\nTranscript:\n${transcriptText}` }),
      });
      const aiPayload = await aiResponse.json().catch(() => ({}));
      const summary = (aiPayload.output || []).flatMap((item: any) => item.content || []).filter((part: any) => part.type === 'output_text').map((part: any) => part.text).join('\n').trim();
      if (!aiResponse.ok || !summary) throw new Error(aiPayload?.error?.message || 'AI minutes generation returned no text.');
      const { error: saveError } = await admin.from('meetings').update({ minutes: summary }).eq('id', meeting.id).eq('organization_id', profile.organization_id).eq('minutes', '');
      if (saveError) throw new Error(`Minutes were generated but could not be saved: ${saveError.message}`);
      return json({ generated: true });
    }

    if (kind === 'meeting_invitation') {
      const meetingId = String(input?.meeting_id || '');
      if (!meetingId || !['owner', 'dept_head', 'sub_dept_head'].includes(profile.level)) return json({ error: 'Only meeting organizers can send meeting invitations.' }, 403);
      const { data: meeting } = await admin.from('meetings').select('*').eq('id', meetingId).eq('organization_id', profile.organization_id).maybeSingle();
      if (!meeting || meeting.created_by !== user.id || meeting.kind !== 'meeting') return json({ error: 'Meeting not found or you are not its organizer.' }, 404);
      const [{ data: people, error: peopleError }, { data: members, error: memberError }] = await Promise.all([
        admin.from('profiles').select('id,email,name,level,sub_department').eq('organization_id', profile.organization_id).eq('approved', true).eq('is_active', true),
        admin.from('accommodation_members').select('profile_id,member_type,team_name,team_names').eq('organization_id', profile.organization_id).not('profile_id', 'is', null),
      ]);
      if (peopleError || memberError) throw new Error(peopleError?.message || memberError?.message || 'Could not read meeting invitees.');
      const groups: string[] = meeting.audience_groups || [];
      const depts: string[] = meeting.audience_depts || [];
      const linked = new Map<string, any[]>();
      for (const member of members || []) if (member.profile_id) linked.set(member.profile_id, [...(linked.get(member.profile_id) || []), member]);
      const recipients = (people || []).filter(person => {
        if (person.id === meeting.created_by) return false;
        if (meeting.audience_all || ['owner', 'dept_head'].includes(person.level) || depts.includes(person.sub_department)) return true;
        if (groups.includes('it:staff') && ['staff', 'sub_dept_head', 'dept_head'].includes(person.level)) return true;
        return (linked.get(person.id) || []).some(member => {
          const teams = [member.team_name, ...(Array.isArray(member.team_names) ? member.team_names : [])].filter(Boolean).map((v: string) => v.toLocaleLowerCase());
          return groups.includes('sewadar:all')
            || (groups.includes('sewadar:regular') && ['salary_based', 'monthly'].includes(member.member_type))
            || (groups.includes('sewadar:annual') && member.member_type === 'annual')
            || groups.some((g: string) => g.startsWith('sewadar:team:') && teams.includes(g.slice(13).trim().toLocaleLowerCase()));
        });
      });
      let teamsResult: { joinUrl: string; onlineMeetingId?: string; warning?: string } = { joinUrl: '' };
      if (meeting.mode === 'online' && !meeting.link) {
        try {
          teamsResult = await createTeamsMeeting(meeting);
          if (teamsResult.joinUrl) {
            const { error: updateError } = await admin.from('meetings').update({ link: teamsResult.joinUrl, teams_online_meeting_id: teamsResult.onlineMeetingId }).eq('id', meeting.id).eq('organization_id', profile.organization_id);
            if (updateError) throw new Error(`Teams meeting was created, but its join link could not be saved: ${updateError.message}`);
            meeting.link = teamsResult.joinUrl;
          }
        } catch (error) {
          teamsResult = { joinUrl: '', warning: `Teams could not create the online meeting: ${(error as Error)?.message || 'Microsoft Graph error.'}` };
        }
      }
      const emails = Array.from(new Set(recipients.map(p => String(p.email || '').trim().toLowerCase()).filter(Boolean)));
      if (emails.length > 100) return json({ sent: 0, warning: `This invitation has ${emails.length} email recipients. Resend's free tier permits 100 emails per day; reduce the audience or upgrade the email plan.` });
      const start = new Date(meeting.starts_at);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const description = [meeting.agenda, meeting.message, meeting.link ? `Join meeting: ${meeting.link}` : ''].filter(Boolean).join('\n\n');
      const eventLines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Event Command Center//Meetings//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',`UID:${meeting.id}@event-command-center`,`DTSTAMP:${asIcsDate(new Date().toISOString())}`,`DTSTART:${asIcsDate(start.toISOString())}`,`DTEND:${asIcsDate(end.toISOString())}`,`SUMMARY:${icsEscape(meeting.title)}`,`DESCRIPTION:${icsEscape(description)}`];
      if (meeting.mode === 'offline' && meeting.place) eventLines.push(`LOCATION:${icsEscape(meeting.place)}`);
      eventLines.push('END:VEVENT','END:VCALENDAR');
      const attachment = { filename: 'meeting-invitation.ics', content: base64(eventLines.join('\r\n')) };
      const date = start.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
      let calendarResult: { booked: boolean; warning?: string; webLink?: string };
      try { calendarResult = await createOutlookEvent(meeting, recipients); }
      catch (error) { calendarResult = { booked: false, warning: `Outlook could not book this meeting slot: ${(error as Error)?.message || 'Microsoft Graph error.'}` }; }
      if (!emails.length && !calendarResult.booked) return json({ sent: 0, warning: calendarResult.warning || 'No invited portal accounts have an email address.' });
      let sent = 0;
      for (let offset = 0; offset < emails.length; offset += 5) {
        const batch = emails.slice(offset, offset + 5);
        const results = await Promise.allSettled(batch.map(email => sendResend(email, `Meeting invitation: ${meeting.title}`, `<p>You are invited to <strong>${esc(meeting.title)}</strong>.</p><p>${esc(date)} (India Standard Time)</p><p>${meeting.mode === 'online' ? `Join online: <a href="${esc(meeting.link)}">${esc(meeting.link)}</a>` : `Location: ${esc(meeting.place)}`}</p>${meeting.agenda ? `<p>Agenda: ${esc(meeting.agenda)}</p>` : ''}${meeting.message ? `<p>${esc(meeting.message)}</p>` : ''}<p>${calendarResult.booked ? 'An Outlook calendar invitation has been sent to you.' : 'An .ics calendar invitation is attached.'} <a href="${esc(`${appUrl}/#/meetings`)}">Open Event Command Center</a></p>`, calendarResult.booked ? undefined : attachment)));
        sent += results.filter(r => r.status === 'fulfilled').length;
        const failed = results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
        if (failed) throw new Error(`${sent} invitations sent; email delivery stopped: ${failed.reason?.message || 'Resend error.'}`);
      }
      const skippedWithoutEmail = recipients.filter(p => !String(p.email || '').trim()).length;
      const warnings = [teamsResult.warning, calendarResult.warning, skippedWithoutEmail ? `${skippedWithoutEmail} invited account(s) have no email address; their portal notification is still available.` : ''].filter(Boolean);
      return json({ sent, skippedWithoutEmail, teamsCreated: !!teamsResult.joinUrl, outlookBooked: calendarResult.booked, outlookWebLink: calendarResult.webLink || '', ...(warnings.length ? { warning: warnings.join(' ') } : {}) });
    }

    if (kind === 'request_escalated') {
      const requestId = String(input?.request_id || '');
      if (!requestId || profile.level !== 'dept_head') return json({ error: 'Only the IT Department Head can send an escalation email.' }, 403);
      const { data: request } = await admin.from('requests').select('id,organization_id,number,title,purpose,needed_by,requester_name,deliver_to,status').eq('id', requestId).eq('organization_id', profile.organization_id).maybeSingle();
      if (!request || request.status !== 'pending_owner') return json({ error: 'The request has not been escalated to the Super Admin.' }, 409);
      const { data: owners, error } = await admin.from('profiles').select('email').eq('organization_id', profile.organization_id).eq('level', 'owner').eq('approved', true).eq('is_active', true);
      if (error) throw new Error(error.message);
      const emails = Array.from(new Set((owners || []).map(p => String(p.email || '').trim().toLowerCase()).filter(Boolean)));
      if (!emails.length) return json({ error: 'No active Super Admin account has an email address.' }, 409);
      const requestUrl = `${appUrl}/#/requests/${encodeURIComponent(request.id)}`;
      const details = `<p>The IT Department Head escalated <strong>${esc(request.number)} · ${esc(request.title)}</strong> for your review.</p><p>Requested by: ${esc(request.requester_name)}<br>Delivery location: ${esc(request.deliver_to)}<br>Needed by: ${esc(request.needed_by || 'Not specified')}</p><p>Reason: ${esc(request.purpose)}</p><p><a href="${esc(requestUrl)}">Review this request in Event Command Center</a></p>`;
      for (const email of emails) await sendResend(email, `Request escalated: ${request.number} · ${request.title}`, details);
      return json({ sent: emails.length });
    }

    return json({ error: 'Unknown workflow email type.' }, 400);
  } catch (error) {
    return json({ error: (error as Error)?.message || 'The email could not be sent.' }, 502);
  }
});
