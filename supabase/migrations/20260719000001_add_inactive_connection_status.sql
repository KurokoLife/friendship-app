-- S3's "Set as Inactive" option (Part 1): archives a conversation
-- quietly, no message sent, no penalty. Adds 'inactive' to connections'
-- existing status check constraint (drop and recreate, same pattern
-- 20260711000007 already used to change this same constraint).
alter table public.connections
  drop constraint if exists connections_status_check;

alter table public.connections
  add constraint connections_status_check
  check (status is null or status in ('pending', 'active', 'passed', 'inactive'));

-- A SECURITY DEFINER RPC rather than a direct client update: connections'
-- own update RLS only lets user_a_id write ("Users can update connections
-- they initiated", 20260711000005), so the non-initiating participant's
-- own attempt to archive the conversation would silently affect 0 rows.
-- Same asymmetry workaround this project has used repeatedly (meetups,
-- meetup_suggestion_state).
create or replace function public.set_connection_inactive(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

  update public.connections set status = 'inactive' where id = p_connection_id;
end;
$$;

grant execute on function public.set_connection_inactive(uuid) to authenticated;
