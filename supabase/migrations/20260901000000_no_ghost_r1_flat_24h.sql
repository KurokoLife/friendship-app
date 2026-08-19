-- Part 1 of tonight's consolidated build: R1 timing changed from a
-- variable 20h/36h window (keyed off the recipient's own stated
-- response_time, "Same day" vs everything else) to a flat 24 hours for
-- everyone. R2 (72h), R3 (120h), S1 (125h), and the 168h auto-close are
-- all unchanged. profiles.response_time itself is untouched (still read
-- and used elsewhere, e.g. the sender-side reassurance line's own
-- RESPONSE_TIME_PHRASES lookup in thread/[id].tsx), only R1's own
-- threshold logic here stops branching on it.
create or replace function public.run_no_ghost_check_v2(p_connection_id uuid, p_now timestamptz default now())
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
  v_last record;
  v_sender uuid;
  v_recipient uuid;
  v_elapsed interval;
  v_fired text := 'none';
begin
  select status into v_status from public.connections where id = p_connection_id;
  if not found or not public.is_connection_automation_eligible(v_status) then
    return 'connection_not_eligible';
  end if;

  select m.sender_id, m.created_at into v_last
  from public.messages m where m.connection_id = p_connection_id
  order by m.created_at desc, m.id desc limit 1;
  if not found then return 'no_messages'; end if;

  v_sender := v_last.sender_id;
  select case when c.user_a_id = v_sender then c.user_b_id else c.user_a_id end
  into v_recipient from public.connections c where c.id = p_connection_id;

  v_elapsed := p_now - v_last.created_at;

  if v_elapsed >= interval '24 hours' then
    perform public.raise_intervention(p_connection_id, 'no_ghost_r1', v_recipient, '{}'::jsonb);
    v_fired := 'r1';
  end if;
  if v_elapsed >= interval '72 hours' then
    perform public.raise_intervention(p_connection_id, 'no_ghost_r2', v_recipient, '{}'::jsonb);
    v_fired := 'r2';
  end if;
  if v_elapsed >= interval '120 hours' then
    perform public.raise_intervention(p_connection_id, 'no_ghost_r3', v_recipient, '{}'::jsonb);
    v_fired := 'r3';
  end if;
  if v_elapsed >= interval '125 hours' then
    perform public.raise_intervention(p_connection_id, 'no_ghost_s1', v_sender, '{}'::jsonb);
    v_fired := 's1';
  end if;
  if v_elapsed >= interval '168 hours' and v_status is distinct from 'inactive' then
    update public.connections set status = 'inactive' where id = p_connection_id;
    perform public.record_friendship_event(p_connection_id, 'conversation_became_inactive', null, '{}'::jsonb);
    v_fired := 'auto_closed';
  end if;

  return v_fired;
end;
$$;
