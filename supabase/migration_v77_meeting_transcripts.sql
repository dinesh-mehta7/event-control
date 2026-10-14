-- Keep the Microsoft Teams onlineMeeting ID so transcripts can be retrieved later.
alter table public.meetings add column if not exists teams_online_meeting_id text;
notify pgrst, 'reload schema';
