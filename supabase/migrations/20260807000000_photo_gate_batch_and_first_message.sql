-- Two independent photo-gate fixes, found and requested together.
--
-- 1. compatible_candidates_for (the service-role batch match-refresh
--    path used by the 6-hourly refresh-match-suggestions cron) never had
--    the `photo_url is not null` condition that discovery_profiles and
--    browse_profiles have both had since 20260730000000. Confirmed live
--    via pg_get_functiondef before this fix: every other hard filter
--    (gender, pause, blocks, radius, age) was already present and
--    identical to the two views, only the photo condition was missing.
--    Same return columns, so a plain CREATE OR REPLACE is sufficient,
--    no drop needed.
--
-- 2. New rule: a user with no photo cannot send the FIRST message of a
--    brand-new conversation (a connection with zero existing messages),
--    but can freely reply once a conversation is already underway. This
--    is enforced here, at the RLS layer, as the real backstop, matching
--    this app's own established convention (Report & Block, 20260729000000:
--    "enforced at the database layer, not just hidden client-side," not
--    just a client-side hidden compose box). The client (thread/[id].tsx)
--    additionally gates the compose UI proactively, so a real user is
--    never left to discover this via a failed insert in the ordinary
--    case, see that file for the inline explanation shown instead.

create or replace function public.compatible_candidates_for(p_user_id uuid)
returns table(
  user_id uuid,
  display_name text,
  age_band text,
  life_transitions text[],
  activity_interests jsonb,
  "values" text[],
  hangout_people_preference text,
  hangout_type_preference text[],
  meeting_freq text,
  communication_freq text,
  personal_statement text,
  current_situation text,
  languages text[],
  friendship_type text,
  communication_style_expression text,
  communication_style_openness text,
  location_city text,
  location_state text,
  location_country text,
  distance_miles double precision
)
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    u.id as user_id,
    p.display_name,
    public.age_band(p.birthdate) as age_band,
    p.life_transitions,
    p.activity_interests,
    p."values",
    p.hangout_people_preference,
    p.hangout_type_preference,
    p.meeting_freq,
    p.communication_freq,
    p.personal_statement,
    p.current_situation,
    p.languages,
    p.friendship_type,
    p.communication_style_expression,
    p.communication_style_openness,
    p.location_city,
    p.location_state,
    p.location_country,
    case
      when viewer_p.location_lat is null or viewer_p.location_lng is null
        or p.location_lat is null or p.location_lng is null then null
      else 3959 * acos(least(1, greatest(-1,
        sin(radians(viewer_p.location_lat)) * sin(radians(p.location_lat))
        + cos(radians(viewer_p.location_lat)) * cos(radians(p.location_lat))
          * cos(radians(p.location_lng) - radians(viewer_p.location_lng))
      )))
    end as distance_miles
  from users u
  join profiles p on p.user_id = u.id
  join users viewer on viewer.id = p_user_id
  join profiles viewer_p on viewer_p.user_id = viewer.id
  where u.id <> p_user_id
    and u.gender_identity = viewer.matching_preference
    and u.matching_preference = viewer.gender_identity
    and (u.paused_until is null or u.paused_until <= now())
    and p.photo_url is not null
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = p_user_id and b.blocked_id = u.id)
         or (b.blocker_id = u.id and b.blocked_id = p_user_id)
    )
    and (
      viewer_p.location_lat is null or viewer_p.location_lng is null
      or p.location_lat is null or p.location_lng is null
      or 3959 * acos(least(1, greatest(-1,
          sin(radians(viewer_p.location_lat)) * sin(radians(p.location_lat))
          + cos(radians(viewer_p.location_lat)) * cos(radians(p.location_lat))
            * cos(radians(p.location_lng) - radians(viewer_p.location_lng))
        ))) <= viewer_p.search_radius_miles
    )
    and (
      p.birthdate is null or viewer_p.birthdate is null
      or (
        extract(year from age(current_date::timestamptz, p.birthdate::timestamptz))::integer
          between viewer_p.min_friend_age and viewer_p.max_friend_age
        and extract(year from age(current_date::timestamptz, viewer_p.birthdate::timestamptz))::integer
          between p.min_friend_age and p.max_friend_age
      )
    );
$function$;

-- Photo-required-for-first-message, RLS backstop. "First message" means
-- no row in messages already exists for this connection_id; once one
-- exists (from either participant), every future insert on that
-- connection is a reply and is unaffected, regardless of either
-- participant's photo status at that later point.
--
-- The "does this connection already have a message" check is pulled out
-- into its own SECURITY DEFINER function rather than a direct correlated
-- subquery on messages from within messages' own INSERT policy: a
-- self-referencing subquery there triggers Postgres's RLS evaluation
-- recursively ("infinite recursion detected in policy for relation
-- messages"), confirmed live while testing this fix. A SECURITY DEFINER
-- function bypasses RLS for its own internal query, breaking the cycle,
-- the same reasoning this app's other cross-boundary reads already use
-- (e.g. big_five_proximity_score, compatible_candidates_for).
create or replace function public.connection_has_any_message(p_connection_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.messages where connection_id = p_connection_id);
$$;

alter policy "Participants can send messages in their connection"
  on public.messages
  with check (
    (sender_id = auth.uid())
    and exists (
      select 1 from connections c
      where c.id = messages.connection_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
        and c.status is distinct from 'blocked'
    )
    and (
      public.connection_has_any_message(messages.connection_id)
      or exists (select 1 from public.profiles pr where pr.user_id = auth.uid() and pr.photo_url is not null)
    )
  );
