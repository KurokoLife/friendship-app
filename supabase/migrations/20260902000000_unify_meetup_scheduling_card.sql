-- Part 2 of tonight's consolidated build: removes the meetup_confirm_needed
-- branch from get_active_intervention (rank 2), the confirmed root cause of
-- the duplicate meetup-proposal card (this same "confirm this date" moment
-- was independently surfaced by both NextMeetupIndicatorV2's own ambient
-- "proposed" state AND this computed intervention, live-reproduced with
-- screenshots in a prior investigation this same evening). Meetup
-- proposal/confirmation/cancellation is now handled entirely by
-- NextMeetupIndicatorV2 (client-side rewrite, no schema needed beyond this
-- one function edit), which is deliberately OUTSIDE the priority queue --
-- always visible, never forced, matching "the non-proposer can simply
-- ignore it" literally, since nothing here ever competes for the one-card
-- priority slot again.
--
-- Per explicit instruction, the underlying MeetupConfirmNeeded React
-- component and its switch case in primary-intervention-card.tsx are left
-- in place, unused rather than deleted -- this migration only removes the
-- one branch that could ever produce the intervention_type it renders.
create or replace function public.get_active_intervention(p_connection_id uuid, p_viewer_id uuid)
returns table (
  intervention_type text,
  source text,
  intervention_id uuid,
  payload jsonb
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
  v_meetup record;
begin
  if auth.uid() is distinct from p_viewer_id then
    raise exception 'Can only query your own active intervention';
  end if;

  select status into v_status from public.connections
  where id = p_connection_id and (user_a_id = p_viewer_id or user_b_id = p_viewer_id);

  if not found then
    return;
  end if;
  if not public.is_connection_automation_eligible(v_status) then
    return;
  end if;

  -- rank 1: no-ghost
  return query
  select ci.intervention_type, 'stored'::text, ci.id, ci.payload
  from public.connection_interventions ci
  where ci.connection_id = p_connection_id
    and ci.target_user_id = p_viewer_id
    and ci.status = 'pending'
    and ci.intervention_type in ('no_ghost_r1','no_ghost_r2','no_ghost_r3','no_ghost_s1')
  order by case ci.intervention_type
    when 'no_ghost_s1' then 4 when 'no_ghost_r3' then 3
    when 'no_ghost_r2' then 2 when 'no_ghost_r1' then 1 else 0 end desc
  limit 1;
  if found then return; end if;

  -- rank 2: pre_meetup_support (computed live). meetup_confirm_needed
  -- removed here (2026-09-02) -- see this migration's own header comment.
  select * into v_meetup from public.meetups
  where connection_id = p_connection_id and status = 'confirmed'
    and confirmed_date between current_date and current_date + 1
  order by created_at desc limit 1;
  if found then
    intervention_type := 'pre_meetup_support';
    source := 'computed';
    intervention_id := v_meetup.id;
    payload := jsonb_build_object('meetup_id', v_meetup.id, 'confirmed_date', v_meetup.confirmed_date);
    return next;
    return;
  end if;

  -- ranks 3-7: stored interventions, in priority order
  return query
  select ci.intervention_type, 'stored'::text, ci.id, ci.payload
  from public.connection_interventions ci
  where ci.connection_id = p_connection_id
    and (ci.target_user_id = p_viewer_id or ci.target_user_id is null)
    and ci.status = 'pending'
    and ci.intervention_type in (
      'meetup_occurrence_check','post_meetup_reflection','second_look_prompt',
      'conversation_restart_prompt','rhythm_reminder'
    )
  order by case ci.intervention_type
    when 'meetup_occurrence_check' then 3
    when 'post_meetup_reflection' then 4
    when 'second_look_prompt' then 5
    when 'conversation_restart_prompt' then 6
    when 'rhythm_reminder' then 7
    else 99 end asc
  limit 1;
  if found then return; end if;

  -- rank 8: graduation_checkpoint (computed live)
  if exists (select 1 from public.connections c where c.id = p_connection_id and c.meetup_count >= 5)
    and not exists (select 1 from public.graduation_readiness where connection_id = p_connection_id and user_id = p_viewer_id)
  then
    intervention_type := 'graduation_checkpoint';
    source := 'computed';
    intervention_id := null;
    payload := '{}'::jsonb;
    return next;
    return;
  end if;

  -- rank 9: meetup_date_reconciliation (computed live, lowest priority)
  select m.* into v_meetup from public.meetups m
  where m.connection_id = p_connection_id and m.date_status = 'disputed'
    and not exists (select 1 from public.meetup_date_resolutions r where r.meetup_id = m.id and r.status = 'pending')
  order by m.created_at asc limit 1;
  if found then
    intervention_type := 'meetup_date_reconciliation';
    source := 'computed';
    intervention_id := v_meetup.id;
    payload := jsonb_build_object('meetup_id', v_meetup.id);
    return next;
    return;
  end if;

  return;
end;
$$;
