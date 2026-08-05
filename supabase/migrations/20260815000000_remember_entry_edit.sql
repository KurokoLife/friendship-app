-- Item 1, 2026-08-15: real edit capability for an existing Remember
-- entry. remember_entries (20260731000000) deliberately had no UPDATE
-- policy, its own comment reasoning being "entries are edited entirely
-- client-side before the one-time approved save." That held for the
-- original scope (create-time only), but the user has since asked for
-- real post-save editing ("no way to fix or expand a written note").
-- This adds exactly that, same own-row-only shape as the existing
-- SELECT/DELETE policies, no new business rule needed: a private,
-- per-user record with nothing to reconcile across users.
--
-- Deliberately does not restrict WHICH columns can change beyond the
-- existing WITH CHECK's auth.uid() = user_id (matching this table's own
-- established simplicity elsewhere, no column-level triggers anywhere
-- else on this table either); the client (see remember.ts's
-- updateRememberEntry) only ever sends raw_text/organized_text/
-- follow_up_note/meetup_date, never connection_id/user_id/
-- meetup_number_at_entry, so this is a practical non-issue, not a real
-- gap, for a private single-user record with no cross-user visibility.
create policy "Users can update their own remember entries"
  on public.remember_entries for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
