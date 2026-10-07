-- Test tools (2026-10-07): "Get fresh suggestions" button.
-- Deletes the signed-in account's own cached match suggestions so
-- Discover writes new ones on the next visit. Only ever touches the
-- caller's own rows. Connections, Interested choices and messages are
-- left alone (unlike dev_reset_my_matches).
create or replace function public.dev_clear_my_suggestions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from public.match_suggestions where user_id = auth.uid();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.dev_clear_my_suggestions() from public, anon;
grant execute on function public.dev_clear_my_suggestions() to authenticated;
