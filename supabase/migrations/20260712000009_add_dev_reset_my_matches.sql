-- Dev tab: "Reset my matches" button. Clears the CALLING user's own
-- connections (both directions, they may be user_a_id or user_b_id) and
-- match_suggestions, so Discover testing can restart from scratch without
-- manual SQL.
--
-- SECURITY DEFINER because neither table has a client-reachable DELETE
-- policy (connections has none at all; match_suggestions only has SELECT
-- and INSERT), by design, deleting connection/match history isn't a
-- normal app action. Rather than add broad DELETE policies to production
-- tables for a dev convenience, this follows the same pattern already
-- established for the no-ghost dev tools (20260712000007): a narrow,
-- explicitly auth.uid()-scoped function, granted to authenticated.
--
-- Lower residual risk than the no-ghost dev_* functions: this can only
-- ever delete the CALLER's own rows (auth.uid() is hardcoded on both
-- sides of both deletes, not a caller-supplied parameter), there's no way
-- to target another user's data with it.
--
-- Deleting a connection cascades to its messages and no_ghost_prompts
-- (both declared "on delete cascade" on connection_id), this is a real,
-- expected side effect, not a bug, an orphaned message pointing at a
-- deleted connection wouldn't make sense.
create or replace function public.dev_reset_my_matches()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.connections where user_a_id = auth.uid() or user_b_id = auth.uid();
  delete from public.match_suggestions where user_id = auth.uid();
end;
$$;

grant execute on function public.dev_reset_my_matches() to authenticated;
