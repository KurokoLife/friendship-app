-- Part 1 of this session's profile field updates.
--
-- Life transitions: selection limit removed entirely (was capped at 3),
-- "Something else" removed from the option list client-side (no per-
-- element check exists to enforce that server-side, so nothing to change
-- here beyond dropping the length cap). A free-text "life_transitions_other"
-- column is added, separate from the scored life_transitions array, so it
-- can display on a profile without ever being fed into match scoring.
alter table public.profiles
  drop constraint if exists profiles_life_transitions_check;

alter table public.profiles
  add column if not exists life_transitions_other text;

-- Values: cap raised from 5 to 10. The existing "Add your own" mechanism
-- (custom chips folded into the same values array) is replaced by a
-- single free-text field, values_other, matching activity_interests'
-- existing "other" pattern exactly, so both sections now share one
-- consistent "add your own, display only, never scored" shape.
alter table public.profiles
  drop constraint if exists profiles_values_check;

alter table public.profiles
  add constraint profiles_values_check check (coalesce(array_length("values", 1), 0) <= 10);

alter table public.profiles
  add column if not exists values_other text;

-- Backfill: any value already stored that isn't one of the 30 presets was
-- added through the old repeatable-custom-chip mechanism (folded directly
-- into the values array, no separate tracking). Found live on one real
-- account ("silly", mixed in with four real presets). Moved into
-- values_other and stripped from values so Part 2's scoring, which now
-- treats the whole values array as preset-only, doesn't accidentally
-- start scoring a free-text entry as if it were a real shared value.
with preset_list as (
  select array[
    'Honesty', 'Humor', 'Family', 'Adventure', 'Stability',
    'Creativity', 'Spirituality', 'Community', 'Growth', 'Ambition',
    'Loyalty', 'Independence', 'Kindness', 'Authenticity', 'Curiosity',
    'Resilience', 'Security', 'Simplicity', 'Connection', 'Purpose',
    'Health', 'Compassion', 'Gratitude', 'Balance', 'Wisdom',
    'Courage', 'Generosity', 'Patience', 'Openness', 'Playfulness'
  ] as presets
),
to_fix as (
  select p.user_id,
    array(select v from unnest(p."values") v where v = any(pl.presets)) as kept,
    array(select v from unnest(p."values") v where not (v = any(pl.presets))) as removed
  from public.profiles p, preset_list pl
  where p."values" is not null
    and exists (select 1 from unnest(p."values") v where not (v = any(pl.presets)))
)
update public.profiles p
set
  "values" = to_fix.kept,
  values_other = case
    when p.values_other is not null and p.values_other <> ''
      then p.values_other || ', ' || array_to_string(to_fix.removed, ', ')
    else array_to_string(to_fix.removed, ', ')
  end
from to_fix
where p.user_id = to_fix.user_id;

-- Communication frequency: "A few times a day" added as a new top option.
-- Still display-only, never used for matching, unchanged from before.
alter table public.profiles
  drop constraint if exists profiles_communication_freq_check;

alter table public.profiles
  add constraint profiles_communication_freq_check check (
    communication_freq in ('A few times a day', 'Daily', 'A few times a week', 'About once a week', 'A few times a month')
  );
