-- 2026-10-22: "How you connect" answers can be shared, by choice, with people
-- you're connected with (founder, after research on self-disclosure and the
-- "beautiful mess" effect). Private by default: people who already answered
-- keep them private unless they choose to share. Only the four questions
-- about now are shared (what feels hardest, after a good meetup, slow
-- replies, awkward moments); the two about past friendships stay private.
-- Never on public profiles, never used for matching.
--
-- Also: care words ("How I like care") were readable through
-- get_connection_care_style by someone who had only saved a profile (a saved
-- row has no status). Now both need a real chat (a status, not passed or
-- blocked), and no block between the two.
-- Safe to run twice. limen_db_version() -> 20261022000001.

alter table public.profiles add column if not exists share_friendship_experience boolean not null default false;

create or replace function public.pair_is_connected(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
      select 1 from public.connections
      where ((user_a_id = p_a and user_b_id = p_b) or (user_a_id = p_b and user_b_id = p_a))
        and status is not null and status not in ('passed', 'blocked')
    )
    and not exists (
      select 1 from public.connections
      where ((user_a_id = p_a and user_b_id = p_b) or (user_a_id = p_b and user_b_id = p_a))
        and status = 'blocked'
    );
$$;
revoke all on function public.pair_is_connected(uuid, uuid) from public, anon, authenticated;

create or replace function public.get_connected_friendship_answers(p_other_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_share boolean;
  v_exp jsonb;
begin
  if v_caller is null or p_other_user_id is null or p_other_user_id = v_caller then return null; end if;
  if not public.pair_is_connected(v_caller, p_other_user_id) then return null; end if;
  select share_friendship_experience, friendship_experience into v_share, v_exp
  from public.profiles where user_id = p_other_user_id;
  if not coalesce(v_share, false) or v_exp is null then return null; end if;
  return jsonb_build_object(
    'hardestCurrentStep', v_exp -> 'hardestCurrentStep',
    'afterPositiveMeetupBehavior', v_exp -> 'afterPositiveMeetupBehavior',
    'slowReplyThought', v_exp -> 'slowReplyThought',
    'awkwardnessInterpretation', v_exp -> 'awkwardnessInterpretation'
  );
end;
$$;
grant execute on function public.get_connected_friendship_answers(uuid) to authenticated;

create or replace function public.get_connection_care_style(p_connection_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_other uuid;
  v_text text;
begin
  if v_caller is null then return null; end if;
  select case when user_a_id = v_caller then user_b_id else user_a_id end
    into v_other
  from public.connections
  where id = p_connection_id and (user_a_id = v_caller or user_b_id = v_caller);
  if not found or not public.pair_is_connected(v_caller, v_other) then return null; end if;
  select care_style into v_text from public.profiles where user_id = v_other;
  return v_text;
end;
$$;
grant execute on function public.get_connection_care_style(uuid) to authenticated;

create or replace function public.limen_db_version()
returns text
language sql
stable
as $function$ select '20261022000001'::text $function$;
grant execute on function public.limen_db_version() to anon, authenticated;
