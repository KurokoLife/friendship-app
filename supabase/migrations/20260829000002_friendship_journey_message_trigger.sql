-- Friendship Journey rebuild — Phase 3, step 2 (fix found during testing):
-- nothing was actually calling advance_friendship_stage() or firing
-- 'first_message_sent' when a real message gets sent. advance_friendship_stage
-- can DERIVE first_contact from messages existing, but nothing was invoking
-- it automatically -- the real app's message send path is a plain table
-- insert, not a call through any new RPC. Additive only: a second, new
-- AFTER INSERT trigger on messages, coexisting with the existing (untouched)
-- clear_no_ghost_on_new_message trigger and this migration's own
-- messages_clear_v2_interventions trigger.
create or replace function public.advance_stage_on_new_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_is_first boolean;
begin
  select count(*) = 1 into v_is_first from public.messages where connection_id = new.connection_id;

  if v_is_first then
    perform public.record_friendship_event(new.connection_id, 'first_message_sent', new.sender_id, '{}'::jsonb);
  else
    perform public.advance_friendship_stage(new.connection_id);
  end if;

  return new;
end;
$$;

create trigger messages_advance_friendship_stage
  after insert on public.messages
  for each row execute function public.advance_stage_on_new_message();
