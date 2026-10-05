-- Account deletion fix (2026-10-05).
--
-- "Delete my account" failed with "Edge Function returned a non-2xx
-- status code". delete-account calls auth.admin.deleteUser, which only
-- works if every row pointing at the user can be removed with them. About
-- 25 foreign keys added since July point at auth.users or public.users
-- with the default "no action" rule (AI usage, referral days, device ids,
-- the Friendship Journey tables, meetup proposals, and others), so any
-- account that had used those features could not be deleted.
--
-- This finds every such foreign key and rebuilds it:
--   * column NOT NULL  -> ON DELETE CASCADE  (the row goes with the user)
--   * column nullable  -> ON DELETE SET NULL (the row stays, the link is
--                                            cleared, e.g. "referred_by")
-- Foreign keys that already cascade or set null are left alone.

do $$
declare
  fk record;
  col_not_null boolean;
  rule text;
begin
  for fk in
    select
      c.conname,
      c.conrelid::regclass as tbl,
      c.confrelid::regclass as ref_tbl,
      a.attname as col,
      ra.attname as ref_col,
      a.attnotnull as not_null
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = c.confkey[1]
    join pg_namespace n on n.oid = (select relnamespace from pg_class where oid = c.conrelid)
    where c.contype = 'f'
      and c.confrelid in ('auth.users'::regclass, 'public.users'::regclass)
      and c.confdeltype in ('a', 'r')          -- no action / restrict
      and array_length(c.conkey, 1) = 1
      and n.nspname = 'public'
  loop
    col_not_null := fk.not_null;
    rule := case when col_not_null then 'cascade' else 'set null' end;
    execute format('alter table %s drop constraint %I', fk.tbl, fk.conname);
    execute format(
      'alter table %s add constraint %I foreign key (%I) references %s (%I) on delete %s',
      fk.tbl, fk.conname, fk.col, fk.ref_tbl, fk.ref_col, rule
    );
    raise notice 'Rebuilt % on % (%), on delete %', fk.conname, fk.tbl, fk.col, rule;
  end loop;
end
$$;

-- Check: should return zero rows.
-- select c.conrelid::regclass, c.conname
-- from pg_constraint c
-- where c.contype = 'f'
--   and c.confrelid in ('auth.users'::regclass, 'public.users'::regclass)
--   and c.confdeltype in ('a', 'r');
