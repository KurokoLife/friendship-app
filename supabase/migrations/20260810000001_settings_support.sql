-- Backend support for the new Settings screen: unblock (confirmed
-- genuinely missing, block_user's own migration comment flagged this as
-- the known follow-up), a self-scoped view of who a user has blocked,
-- and a self-scoped view of reports the user has filed. reports already
-- has a real "Reporters can read their own reports" SELECT policy
-- (confirmed live before writing this), so my_reports only needs to add
-- the reported person's display_name via a join, the same pattern
-- inbox_conversations/remember_people already established for reading
-- across profiles' own self-row RLS via plain (non-security-definer)
-- view-owner execution.

create view public.my_blocks as
select b.id, b.blocked_id, p.display_name, p.photo_url, b.created_at
from public.blocks b
join public.profiles p on p.user_id = b.blocked_id
where b.blocker_id = auth.uid();

grant select on public.my_blocks to authenticated;

create view public.my_reports as
select r.id, r.reported_id, p.display_name as reported_display_name, r.category, r.detail, r.also_blocked, r.created_at
from public.reports r
left join public.profiles p on p.user_id = r.reported_id
where r.reporter_id = auth.uid();

grant select on public.my_reports to authenticated;

-- Only reactivates the underlying connection (status 'blocked' ->
-- 'inactive', freeing messaging back up) once NEITHER direction has an
-- active block left, since blocks is unilateral per direction and both
-- people could independently have blocked each other.
create or replace function public.unblock_user(p_blocked_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.blocks where blocker_id = auth.uid() and blocked_id = p_blocked_id;

  if not exists (
    select 1 from public.blocks
    where (blocker_id = auth.uid() and blocked_id = p_blocked_id)
       or (blocker_id = p_blocked_id and blocked_id = auth.uid())
  ) then
    update public.connections
    set status = 'inactive'
    where status = 'blocked'
      and (
        (user_a_id = auth.uid() and user_b_id = p_blocked_id)
        or (user_a_id = p_blocked_id and user_b_id = auth.uid())
      );
  end if;
end;
$$;

grant execute on function public.unblock_user(uuid) to authenticated;
