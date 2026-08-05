-- Real three-option Excited/Neutral/Nervous picker for the day-of feeling
-- check (2026-08-22 video-hosting session, item 4 of the original
-- 2026-08-16 next-meetup-date session deferred this: "real video routing
-- deferred until more videos are produced"). Now that the anxiety video
-- exists (guide-videos/meetup-day-anxiety.mp4), the placeholder single
-- 'neutral'-only column can widen to match first_meetup_feelings' own
-- established three-value set exactly.
alter table public.next_meetup_feelings drop constraint next_meetup_feelings_feeling_check;
alter table public.next_meetup_feelings add constraint next_meetup_feelings_feeling_check
  check (feeling in ('excited', 'neutral', 'nervous'));
alter table public.next_meetup_feelings alter column feeling drop default;
