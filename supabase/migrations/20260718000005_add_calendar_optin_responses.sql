-- F24: calendar opt-in. Fires once per confirmed meetup, per user (each
-- person adds to their OWN device calendar independently, expo-calendar
-- only ever touches the local device it runs on, there's no shared
-- calendar object here). Unlike meetups' own propose/confirm RPCs, this
-- is a plain personal record of the user's own choice with no
-- cross-user business rule to enforce, so a direct client insert is
-- fine here, same reasoning rhythm_mismatch_dismissals already
-- established for this exact shape (a per-user, per-target one-time
-- response, no SECURITY DEFINER layer needed).
create table if not exists public.calendar_optin_responses (
  meetup_id uuid not null references public.meetups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  responded_at timestamptz not null default now(),
  added boolean not null,
  primary key (meetup_id, user_id)
);

alter table public.calendar_optin_responses enable row level security;

create policy "Users can read their own calendar opt-in responses"
  on public.calendar_optin_responses for select
  using (auth.uid() = user_id);

create policy "Users can record their own calendar opt-in response"
  on public.calendar_optin_responses for insert
  with check (auth.uid() = user_id);
