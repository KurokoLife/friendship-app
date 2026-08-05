-- Dev tab: "sender status line preview" buttons for steps 1-3. Status
-- lines (src/lib/no-ghost.ts's senderStatusLine) aren't stored anywhere,
-- they're computed live from the connection's last message's
-- created_at/read_at every time the thread screen renders, there's no
-- no_ghost_prompts row to force-fire the way steps 1-3's receiver prompts
-- or step 4 work. So previewing a specific tier means backdating the
-- actual last message's created_at into that tier's real hour range, then
-- the real, unmodified senderStatusLine function naturally produces the
-- exact text when the thread screen is opened, this exercises production
-- code, not a fake mockup of it.
--
-- Same participant-check pattern as every other dev_* function. Only
-- touches created_at, read_at is untouched (irrelevant to the 0-48h/
-- 48-72h/72-96h tiers this is used for).
--
-- Known, accepted side effect: backdating a message also feeds the real
-- pg_cron sweep the next time it runs (every 15 minutes), which may fire
-- real receiver-side no_ghost_prompts rows for whatever hour range was
-- set. That's expected, not a bug, "Reset all no-ghost state" clears it
-- if unwanted.
create or replace function public.dev_set_last_message_age(p_connection_id uuid, p_hours_ago numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.connections c
    where c.id = p_connection_id
      and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
  ) then
    raise exception 'Not a participant of this connection';
  end if;

  select id into v_last_id
  from public.messages
  where connection_id = p_connection_id
  order by created_at desc
  limit 1;

  if v_last_id is null then
    raise exception 'This conversation has no messages yet';
  end if;

  update public.messages
  set created_at = now() - (p_hours_ago || ' hours')::interval
  where id = v_last_id;
end;
$$;

grant execute on function public.dev_set_last_message_age(uuid, numeric) to authenticated;
