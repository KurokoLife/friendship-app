# Friendship Journey — Phase 2 Design

Status: **design only, nothing implemented, no schema touched.** This is the artifact requested at the end of Phase 1 (see `PROGRESS.md`'s Phase 1 audit entry once written). Everything below is a proposal for review, not a migration plan yet.

Design goals, restated from the brief: one authoritative source of truth for (1) connection lifecycle, (2) friendship progression, (3) current meetup state, (4) whether someone owes a reply, (5) the single highest-priority intervention right now. Every piece below exists to serve one of those five, not to add a feature for its own sake.

---

## 1. Layering — why five new pieces, not one big table

| Layer | Owns | Shape |
|---|---|---|
| `connections.status` | Operational lifecycle (pending/active/paused/inactive/blocked/ended/graduated) | Unchanged, existing column |
| `connections.friendship_stage` | Where this connection is in the journey — forward-only, narrative | New column, event-driven |
| `connections.is_self_sustaining` | Whether Limen can safely wait longer before nudging — reversible, intervention-timing only, never narrative | New column, own write path, deliberately never touches `friendship_stage` (§4a, Decision 10) |
| `friendship_events` | The append-only, both-participants-readable factual timeline | New table |
| Private per-user tables | Reflections/preferences no one else may ever read | Several small new tables, existing RLS pattern |
| `meetups` (+ `meetup_occurrence_reports`) | Every meetup, its full lifecycle, permanent history | New table, replaces 3 existing ones |
| `connection_interventions` | The queue of things eligible to show right now, with priority | New table, replaces 6 scattered "is there a card" checks |

The reason it isn't one table: status is operational (what can happen), stage is narrative (where the story is), the event log is the shared factual record, private tables are exactly what their name says, meetups are their own entity with a real lifecycle, and interventions are ephemeral UI state, not history. Collapsing any two of these together is what produced today's drift (see Phase 1 finding: `connections.status` alone currently has to imply progression, eligibility, *and* lifecycle at once, which is why nine functions each grew their own copy of "which statuses count").

---

## 2. `friendship_events` — the event log

```
friendship_events
  id                uuid pk
  connection_id     uuid not null references connections
  actor_user_id     uuid null references users        -- null = system/cron
  event_type        text not null                      -- see table below
  payload           jsonb not null default '{}'
  created_at        timestamptz not null default now()
```

RLS: SELECT for both participants of the connection. **No client INSERT** — the only writer is `record_friendship_event(connection_id, event_type, actor_user_id, payload)`, a SECURITY DEFINER function that inserts the row and then calls `advance_friendship_stage()` (§4) in the same transaction.

**Hard rule, load-bearing for privacy:** `payload` may only ever contain non-evaluative, non-sensitive data (a proposed date, a message-count threshold, a from/to stage pair). It must never contain a free-text reason, a feeling, a rating, or a private choice — because both participants can read this table. Anything private lives only in the tables in §3, and only a *sanitized boolean outcome* of reading them (e.g. "did this unlock Second Look eligibility") may ever become an event.

| event_type | actor | payload | fires when |
|---|---|---|---|
| `first_message_sent` | sender | `{}` | first row ever in `messages` for the connection |
| `conversation_became_inactive` | system | `{}` | status → `inactive` |
| `meetup_proposed` | proposer | `{meetup_id, date}` | `propose_meetup()` |
| `meetup_confirmed` | confirmer | `{meetup_id, date}` | `confirm_meetup()` |
| `meetup_rescheduled` | proposer | `{meetup_id, old_date, new_date}` | re-propose on an already-proposed/confirmed meetup |
| `meetup_cancelled` | canceller | `{meetup_id}` | `cancel_meetup()` |
| `meetup_occurrence_reported` | reporter | `{meetup_id}` | first `meetup_occurrence_reports` row for a meetup |
| `meetup_occurred` | system | `{meetup_id, sequence_number}` | both reports agree "yes" (§5 case 1/2) |
| `meetup_not_occurred` | system | `{meetup_id}` | both reports agree "no", or resolved unresolved after timeout (§5 case 3/4) |
| `meetup_date_resolved` | system | `{meetup_id}` — no date value, both can already see the live result | a `meetup_date_resolutions` row is approved (§5 case 2 initial dispute, or case 5 later correction) |
| `post_meetup_reflection_submitted` | reflector | `{meetup_id}` — **no response value** | row written to `private_post_meetup_reflections` |
| `second_look_responded` | responder | `{response_class: 'advance'\|'defer'\|'decline'}` — coarse only | row written to `second_look_responses` |
| `conversation_restarted` | restarter | `{}` | a message sent after a restart prompt was shown |
| `remember_entry_created` | author | `{}` | fact only, no content |
| `connection_paused` / `connection_resumed` | actor | `{}` | status change |
| `connection_ended` | ender | `{}` | status → `ended` (never includes the private reason) |
| `connection_blocked` | — | `{}` | status → `blocked` |
| `rhythm_preference_set` | setter | `{}` — **no cadence value** | row written/updated in `rhythm_preferences` |
| `graduation_checkpoint_reached` | system | `{}` | `meetup_count` (derived) crosses 5 for the first time |
| `graduation_mutual` | system | `{}` | **only** when both `graduation_readiness` rows = `mostly_on_our_own` — never written for one-sided readiness |
| `stage_changed` | system | `{from_stage, to_stage}` | any time `advance_friendship_stage()` actually changes the column |

Deliberate simplification vs. the literal spec list, flagged rather than silently done: I collapsed `message_received`/`message_replied`/`meetup_date_passed`/`next_meetup_scheduled` out of this table. The first two are already fully and more precisely represented by `messages.created_at`/`sender_id` — duplicating them as events would just be a second, lossier copy of a table that's already the source of truth. `meetup_date_passed` is a cron-internal check, not something anything downstream needs as a discrete event (the cron reads `meetups.status`/`proposed_date` directly). `next_meetup_scheduled` is the same fact as `meetup_proposed`; I didn't see a reason to fire two near-identical events for one action.

---

## 3. Private per-user tables

All follow the exact pattern this codebase already uses successfully (`connection_end_reasons`, `first_meetup_feelings`, `rhythm_mismatch_dismissals`): own-row RLS, `(connection_id, user_id)` keyed, no client access to the other participant's row, no exceptions.

```
private_post_meetup_reflections
  connection_id, user_id, meetup_id (fk meetups),
  response text check in ('know_better','open_to_another','still_figuring','dont_continue'),
  created_at

second_look_responses
  connection_id, user_id,
  response text check in ('yes','maybe_later','no'),
  created_at

progressive_reflections               -- Stage 8/9's lighter, later check-ins
  connection_id, user_id,
  reflection_type text check in ('early_repeat','rhythm_check'),
  response text,                       -- short enum per type, not free text
  created_at

rhythm_preferences
  connection_id, user_id,
  cadence text check in ('weekly','few_weeks','monthly','occasional','not_sure'),
  updated_at                           -- upsertable, user can change their mind

graduation_readiness
  connection_id, user_id,
  readiness text check in ('still_helpful','mostly_on_our_own','not_sure'),
  created_at

pre_meetup_concerns                    -- new; replaces nothing, this branch doesn't exist today
  connection_id, user_id, meetup_id,
  concern text check in ('awkwardness','low_energy','plan_too_big','safety','other'),
  resolution text check in ('reassured','plan_simplified','cancelled','blocked','rescheduled') null,
  created_at

connection_pause_details                -- new, see §8 Decision 3
  connection_id uuid primary key references connections,
  paused_by     uuid not null references users,
  paused_until  timestamptz null,        -- null = indefinite ("I'll come back when I'm ready")
  created_at    timestamptz not null default now()
```

`next_meetup_feelings`/`first_meetup_feelings` are kept as-is (§7 KEEP) — they already satisfy this pattern for the day-of feeling check.

**Why `connection_pause_details` is a separate table and not just a column on `connections` (a real gap I caught while writing up the approved Decision 3, not something I noticed earlier):** `connections` has one blanket SELECT policy — `auth.uid() = user_a_id OR auth.uid() = user_b_id` — that returns the **whole row** to both participants, RLS in Postgres being per-row, not per-column. If I'd added `paused_until` directly onto `connections` as I originally sketched, the other participant could read it with a completely ordinary client query and infer the chosen defer length (roughly "2 days" vs. "7 days" vs. "indefinite"), directly contradicting "do not expose the selected defer duration to the other participant." Moving it into its own table with `paused_by`-only SELECT RLS — the same pattern already used for `blocks` (blocker-only SELECT) — closes that off structurally, not just by the client choosing not to render it. `connections.status = 'paused'` itself stays visible to both, unchanged from today, since both participants legitimately need to know messaging is paused (Inbox sectioning, the thread banner) — only the *duration detail* is private. The automation sweep reads this table via a SECURITY DEFINER function, which bypasses RLS entirely, so the private-select policy has zero effect on whether auto-resume actually works.

---

## 4. `connections.friendship_stage` and its transitions

```sql
alter table connections add column friendship_stage text
  check (friendship_stage is null or friendship_stage in (
    'first_contact','conversation','first_meetup_planning','post_first_meetup',
    'early_friendship','repeated_time','rhythm_established',
    'graduation_eligible'
  ));
alter table connections add column friendship_stage_changed_at timestamptz;

-- Deliberately separate from friendship_stage — see §4a. A reversible signal, not a
-- narrative stage, and it must never gate or reorder anything in the check constraint above.
alter table connections add column is_self_sustaining boolean not null default false;
alter table connections add column is_self_sustaining_updated_at timestamptz;
```

`null` = no message sent yet (pre-`first_contact`). Advancement is driven by `advance_friendship_stage(connection_id)`, called from inside `record_friendship_event()` after every write, plus a periodic sweep for the two transitions that are elapsed-time/pattern-based rather than single-event-triggered.

| Transition | Driven by |
|---|---|
| `null` → `first_contact` | `first_message_sent` |
| `first_contact` → `conversation` | both participants have sent ≥1 message (reuses the exact bidirectional check `create_connection_with_capacity_check` already computes) |
| `conversation` → `first_meetup_planning` | `meetup_proposed` for this connection's meetup #1 |
| `first_meetup_planning` → `post_first_meetup` | meetup #1 resolves `occurred = true` |
| `post_first_meetup` → `early_friendship` | `second_look_responses.response = 'yes'` |
| `early_friendship` → `repeated_time` | second `meetup_occurred` event for this connection — **Decision 1, approved, see §13** |
| `repeated_time` → `rhythm_established` | **at least one** participant has a `rhythm_preferences` row (not both — see §13a, Decision 6) |
| `repeated_time` or `rhythm_established` → `graduation_eligible` | ≥5 occurred meetups (the retained "UX checkpoint," per your own instruction that 5 is not a scientific threshold) |

`self_sustaining` is **not** a stage — see §4a and Decision 10 (§13a). It is a separate, reversible boolean (`connections.is_self_sustaining`) computed alongside `friendship_stage`, never part of it, and it cannot move a connection backward or forward through the table above.

Stage never advances (and interventions stop firing) once status is `paused`/`inactive`/`blocked`/`ended`/`graduated` — enforced by the same single gate function described in §6, not re-checked ad hoc per transition.

**`post_first_meetup → early_friendship` (approved 2026-08-09):** fires the moment **either participant**, independently, selects the qualifying Second Look "yes" response — not both. This is a deliberate, explicit choice, not a placeholder pending a stricter rule later.

This must never be read as evidence that both participants want the relationship to continue, that they are friends, or that both feel positively about the connection. It is a purely structural gate on which reflection question and suggestion framing Limen offers next (the same non-evaluative role every other stage transition plays, per §4's own framing above) — not a claim about mutual sentiment, and not something either participant's own answer alone can honestly represent for the other person.

Second Look stays private and individual, unconditionally: the two participants' `second_look_responses` rows are never compared to each other by any code path, no aggregate or "both said yes" signal is ever computed anywhere, and one participant's response is never exposed to the other, in any form, at any surface. This holds regardless of which participant's answer happened to be the one that advanced the stage — `friendship_stage`, like every value in `connections`, is visible to both participants once it changes, but nothing about *why* it changed (whose answer, or what that answer was) is ever derivable from it or exposed alongside it.

**`early_friendship → repeated_time` (Decision 1, approved):** fires the moment the connection's **second** `meetup_occurred` event lands, with no elapsed-time component. This is a factual trigger, not a friendship-quality claim: it exists only to switch which reflection question and which suggestion framing Limen offers next (lighter, repeated-contact copy instead of the heavier post-first-meetup flow), and it is never surfaced to the user in any form — `friendship_stage` values are internal-only, per the original brief's own State Model section ("these names are internal only, do not show technical stage labels to users"). It must not be read, displayed, or referenced anywhere as evidence that the relationship "has become a friendship." No count, duration, or threshold larger than the structural minimum (two) is used anywhere in this transition.

### 4a. `is_self_sustaining` — a reversible signal, decoupled from `friendship_stage` (Decision 10, §13a)

This was originally modeled as a ninth `friendship_stage` value. That was a real architecture error, caught by your final review: it mixed two genuinely different kinds of state under one name — a narrative stage (which only ever moves forward, driven by discrete events) and a reversible condition (which needs to flip back to `false` the instant a connection needs support again). Forcing the second into the shape of the first meant either letting `friendship_stage` move *backward* (contradicting how every other transition in §4 works) or letting it get stuck reporting "self-sustaining" on a connection that had since gone quiet. Neither is acceptable, so they're now two fully independent things:

- `connections.friendship_stage` — narrative progression, forward-only, driven by `record_friendship_event()` (§4), completely unaffected by anything in this section.
- `connections.is_self_sustaining` — a plain boolean, computed by `evaluate_self_sustaining()` on the same hourly sweep, written by its own separate call, **never called from inside `advance_friendship_stage()` and never read by it either.** The two write paths do not touch each other's data, so one can't accidentally move the other again.

`evaluate_self_sustaining(connection_id, p_now default now())` computes the value; the sweep writes it to `connections.is_self_sustaining` and `is_self_sustaining_updated_at`. **All four** of the following must hold — a plain AND of independently-checkable booleans, not a weighted score:

```sql
reciprocal_initiation   := exists(meetups where connection_id=X and proposed_by=user_a_id)
                        and exists(meetups where connection_id=X and proposed_by=user_b_id)

organic_planning        := coalesce(
                              (select prompted_by_limen from meetups
                               where connection_id=X and status in ('proposed','confirmed','occurred')
                               order by created_at desc limit 1) = false,
                              false
                            )
                            -- true only when a most-recent qualifying proposal exists AND its
                            -- prompted_by_limen is explicitly false. If no qualifying meetup exists at
                            -- all, the subquery returns no row (NULL), and `NULL = false` is itself NULL
                            -- in SQL — coalesce forces that unresolved case to `false`, i.e. FAILS the
                            -- check, matching "unknown must not pass," not "unknown passes by default."

quiet_on_intervention_need := not exists (
                             select 1 from connection_interventions
                             where connection_id=X
                               and (intervention_type like 'no_ghost_%' or intervention_type = 'conversation_restart_prompt')
                               and (status = 'pending' or created_at > p_now - interval '30 days')
                           )

enough_history          := (select count(*) from meetups where connection_id=X and status='occurred') >= 2

is_self_sustaining := reciprocal_initiation and organic_planning and quiet_on_intervention_need and enough_history
```

Reversible by construction, and now structurally incapable of dragging `friendship_stage` backward with it, since it lives in a different column with a different writer: re-evaluated every sweep, and if `quiet_on_intervention_need` later fails (a new no-ghost or restart prompt fires), `is_self_sustaining` flips back to `false` on the very next sweep — while `friendship_stage` (e.g. `rhythm_established` or `graduation_eligible`) stays exactly where it was, because nothing in `advance_friendship_stage()` ever reads this signal. A connection that goes quiet again gets full-strength intervention support again immediately, with zero effect on its narrative progression.

**Concrete effect, so the signal isn't inert — intervention intensity only, never presented to the user, never evidence of friendship:** once `is_self_sustaining = true`, the elapsed-time-since-last-message threshold used by Case B restart eligibility (§6a) is doubled for that connection; once it flips back to `false`, normal timing resumes on the next sweep. This is the one lever — Limen becomes quieter by waiting longer before nudging a restart, nothing else changes, and nothing about it is ever shown in any UI. My own assumption (the multiplier, "double"), not sourced from anything beyond simple proportionality.

See §13a for why each of the four conditions was kept, why two spec-listed signals were deliberately excluded, and which numbers in this rule are labeled as my own assumption vs. structural minimums.

---

## 5. Normalized `meetups`, occurrence, and history (revised — see §13a Decision 8)

Replaces `connections.next_meetup_date/next_meetup_status/next_meetup_proposed_by` (single mutable fields, no history) **and** subsumes the factual half of `meetup_checkins` **and** replaces the asymmetric confirm/deny `meetup_confirmation_requests` flow. Now explicitly separates three distinct dates — the date planned, the date agreed, and the date it actually happened — because assuming the confirmed date always equals the real date turned out to be a real gap in the first draft of this design.

```
meetups
  id                 uuid pk
  connection_id      uuid not null references connections
  sequence_number    integer not null          -- server-computed, trigger-set, never client-supplied
  proposed_date      date not null             -- the date originally proposed (date-only, not datetime; Decision 2)
  proposed_by        uuid not null references users
  confirmed_date     date null                 -- set equal to proposed_date at the moment confirm_meetup() succeeds;
                                                -- the PLANNED date both people agreed to meet on. Never used as a
                                                -- stand-in for the ACTUAL date once occurrence is confirmed — see
                                                -- date_status below, this was a real error in an earlier draft.
  confirmed_at       timestamptz null
  confirmed_by       uuid null references users
  occurred_date      date null                 -- the FACTUAL, reconciled date. Null whenever date_status is
                                                -- anything other than 'confirmed' — see the state model below.
  date_status        text not null default 'not_applicable'
                      check in ('not_applicable','confirmed','disputed')
  status             text not null check in ('proposed','confirmed','rescheduled','cancelled','occurred','not_occurred','unresolved')
  superseded_by      uuid null references meetups(id)   -- traces a reschedule chain instead of silently overwriting
  prompted_by_limen  boolean not null default false      -- see §4a / §13a Decision 7: true if a Limen intervention was
                                                          -- pending for the proposer, on this connection, at the exact
                                                          -- moment propose_meetup() was called; set once, at write time,
                                                          -- never inferred after the fact
  created_at, updated_at timestamptz

meetup_occurrence_reports
  meetup_id          uuid not null references meetups
  reporter_id        uuid not null references users
  reported_yes       boolean not null
  reported_date      date null            -- only meaningful when reported_yes = true; defaults client-side to
                                           -- meetups.confirmed_date but the user may pick a different date;
                                           -- server rejects a future date
  created_at
  primary key (meetup_id, reporter_id)

meetup_date_resolutions          -- the mutual-approval mechanism, shared by both an initial date dispute (case 2
                                  -- below) and a later correction (case 5) — same shape, same need for the other
                                  -- side to approve before shared history changes, so one mechanism covers both
                                  -- rather than building two nearly-identical ones
  id                 uuid pk
  meetup_id          uuid not null references meetups
  proposed_by        uuid not null references users
  proposed_date      date not null
  reason             text not null check in ('initial_dispute','correction')  -- for analytics/display only, not logic
  status             text not null default 'pending' check in ('pending','approved','declined')
  created_at, resolved_at timestamptz
```

**`proposed_date` vs. the spec's literal `proposed_datetime` (Decision 2, approved):** kept date-only, matching this app's existing, previously-made product decision to avoid a native time picker. No time-of-day UI or schema complexity until an actual feature needs it.

### Occurrence certainty vs. date certainty — the state model (corrected per your instruction)

An earlier draft of this design let `occurred_date` silently fall back to `confirmed_date` whenever the two participants' reported dates disagreed — writing a value into permanent shared history that neither participant had actually agreed was correct. That was wrong, and it re-committed exactly the "planned date and actual date are the same fact" error you flagged from the very start of this item. Corrected: **the two questions are tracked by two independent fields.** `status` answers "did it happen at all" (occurrence certainty). `date_status` + `occurred_date` answer "do we know exactly which day" (date certainty), and are structurally incapable of being set until occurrence is already settled.

| `date_status` | Meaning | `occurred_date` |
|---|---|---|
| `not_applicable` | `status` isn't `'occurred'` yet — no date question is relevant | always null |
| `disputed` | occurrence is confirmed (both said yes), but the reported dates disagree and haven't been reconciled | null |
| `confirmed` | occurrence is confirmed, and a trustworthy date exists — either both reports agreed originally, or a `disputed` record was later resolved | set |

### Lifecycle

- **Propose**: `propose_meetup(connection_id, date)` — if the connection already has a `proposed`/`confirmed` meetup, that row is marked `rescheduled` with `superseded_by` pointing at the new row, and a fresh `proposed` row is inserted with the next `sequence_number`. At insert time, checks whether a `connection_interventions` row is currently `pending` for the caller on this connection and stamps `prompted_by_limen` accordingly.
- **Confirm**: `confirm_meetup(meetup_id)` — same "proposer cannot confirm their own date" rule as today; sets `confirmed_date = proposed_date`, `confirmed_at`, `confirmed_by`.
- **Cancel**: `cancel_meetup(meetup_id, reason?)` — the real exit from Pre-Meetup Support's "I'm thinking about cancelling" branch.
- **Occurrence question ("Did you meet?")** — fires once a confirmed date has passed with no report yet. Both participants independently answer `reported_yes`. If yes, the UI immediately follows with **"When did you meet?"**, pre-filled with `confirmed_date`, editable to any non-future date, written to that same row's `reported_date`.

### Reconciliation — all five cases named

1. **Both say Yes, same `reported_date`** — `status = 'occurred'`, `date_status = 'confirmed'`, `occurred_date` = the agreed date. No conflict, nothing further needed.
2. **Both say Yes, different `reported_date`s** — occurrence is certain (`status = 'occurred'`), but the date is not (`date_status = 'disputed'`, `occurred_date` stays null). This no longer auto-resolves to anything, per your correction. A low-priority, non-blocking `meetup_date_reconciliation` intervention (§6, rank 9 — the lowest, never competes with anything that actually needs attention) becomes available to both participants. Because a calendar date carries none of the emotional weight an evaluative answer (like "rough" vs. "went well") does, both participants' originally-reported dates are shown to each other directly here — this is a deliberate distinction from the yes/no privacy rule, not an oversight: the thing being protected elsewhere is a private *feeling*, not an ordinary factual mismatch like "was it Tuesday or Wednesday." Either participant can select one of the two dates or enter a third, creating a `meetup_date_resolutions` row (`reason = 'initial_dispute'`); **the other participant must still approve it** before `occurred_date`/`date_status` change — showing both dates transparently doesn't grant either person unilateral write authority over shared history. **No forced timeout, no default fallback:** if neither participant ever resolves it, the record simply stays `disputed` indefinitely. This is safe because nothing else depends on it — `meetup_count`, `friendship_stage` progression, and `graduation_eligible` are all keyed off `status = 'occurred'` alone, never off `date_status`. The shared history view (below) renders a disputed entry as "Met — date unconfirmed" rather than blocking or nagging either participant to resolve it.
3. **One says Yes, the other says No** — `status = 'unresolved'`, `date_status` stays `'not_applicable'` (occurrence itself isn't settled, so a date question doesn't apply yet). Neither participant is shown the other's specific answer.
4. **Only one participant ever responds** — see the dedicated timeout design in §13a Decision 9. Resolves to `status = 'unresolved'` the same as case 3 after the (currently provisional) timeout elapses, but — unlike case 2's permanently-open dispute — a late answer is still accepted afterward and can retroactively resolve it; see §13a Decision 9 for the full behavior.
5. **A confirmed `occurred_date` later needs correction** — either participant calls `propose_meetup_date_resolution(meetup_id, new_date)` on an already-`'confirmed'`-date meetup. Same table as case 2 (`reason = 'correction'`), same mutual-approval requirement: the other participant must explicitly approve before `occurred_date` changes. Declining or ignoring it leaves the existing date exactly as it was. A `meetup_date_resolved` event fires on approval either way (case 2 or case 5), payload `{meetup_id}`, no date value in the event itself since both can already see the live result once it's approved.

`connections.meetup_count` stays as a trigger-maintained cache of `count(*) from meetups where status='occurred'`, never independently writable, and — worth stating explicitly given this correction — completely unaffected by `date_status`/`occurred_date` in every branch above. A disputed or even permanently-unresolved date never blocks the meetup from counting, from advancing `friendship_stage`, or from contributing to graduation eligibility, exactly matching "occurrence certainty" and "date certainty" being genuinely independent facts.

### User-facing meetup-history view

New `meetup_history` (a plain, participant-readable view, same non-security-definer pattern as `inbox_conversations`): for a given connection, every row where `status = 'occurred'`, exposing `sequence_number`, `date_status`, `occurred_date` (null when `date_status = 'disputed'`), `proposed_by` (who suggested it — not private, both already know this from having had the actual conversation about it). A `disputed` row renders as "Met — date unconfirmed" rather than a blank or a guessed date. **Deliberately excludes** `meetup_occurrence_reports.reported_date` (each participant's individual, possibly-differing claim — the private/pre-reconciliation layer) and anything from `private_post_meetup_reflections` — the history view shows only reconciled, factual, shared data; private emotional reflections about any given meetup are never joined into it, structurally, not just by choice of what the UI happens to query. This is the data source for both the thread header's existing "Met N times · date, date, date" line (a disputed entry contributes to the count but not to the date list) and a fuller history screen if one is built later.

---

## 6. `connection_interventions` — the priority queue

This is the direct fix for "multiple contradictory cards at once." One table, one read function, one card rendered.

```
connection_interventions
  id                uuid pk
  connection_id     uuid not null
  target_user_id    uuid null       -- null = shown to both (e.g. a shared meetup-suggestion banner)
  intervention_type text not null
  payload           jsonb not null default '{}'
  status            text not null default 'pending' check in ('pending','resolved','dismissed','snoozed','expired')
  created_at, resolved_at, snoozed_until
```

RLS: SELECT where `(target_user_id = auth.uid() or target_user_id is null)` and caller is a participant. No client INSERT — the only writer is `raise_intervention(connection_id, type, target_user_id, payload)`, which is **idempotent**: it first checks for an existing `pending`/`snoozed`-and-still-cooling-down row of the same type+target and no-ops if one exists, satisfying "safe to run more than once without creating duplicate prompts" as a property of the write path itself, not a convention every caller has to remember.

### `get_active_intervention(connection_id, viewer_id)` — the single read

Returns **at most one row**: the highest-priority `pending` (and not currently snoozed) intervention visible to that viewer, using a fixed rank table. This is what every thread-screen card now derives from — one call replaces the nine separate loaders `thread/[id].tsx` currently runs.

| rank | intervention_type | raised by | shown to |
|---|---|---|---|
| — (floor) | *(none — `status='blocked'` short-circuits before any intervention is read at all)* | | |
| 1 | `no_ghost_r1` / `r2` / `r3` / `s1` | `run_no_ghost_check` (kept, retimed per §8) | recipient (r1–r3) or sender (s1) |
| 2 | `meetup_confirm_needed` | computed on read from `meetups` (no cron) | the non-proposer of a `proposed` meetup |
| 2 | `pre_meetup_support` | computed on read (date is today/tomorrow and `confirmed`) | both, independently |
| 3 | `meetup_occurrence_check` | cron, day after a confirmed date with no report yet | both, independently |
| 4 | `post_meetup_reflection` | fires on `meetup_occurred`, per viewer who hasn't answered | the specific viewer |
| 5 | `second_look_prompt` | fires when a qualifying `private_post_meetup_reflections` row exists and no `second_look_responses` row yet | the specific viewer |
| 6 | `conversation_restart_prompt` | cron, Case B eligibility (§6a) | both, independently — **Decision 4, approved**: a private row per participant, no shared/combined row, so neither can see whether the other has been shown one, and no responsibility is assigned to either side |
| 7 | `rhythm_reminder` | one intervention type, two eligibility paths per viewer: **(a) first-time collection** — no `rhythm_preferences` row yet, ≥2 occurred meetups, and the two most recent are on different calendar dates (Decision 6's structural gap floor); **(b) recurring reminder** — a row exists, and elapsed time since the last occurred meetup meets their own stated cadence (Decision 6's day mapping, §13a) | only the user whose preference it is or would be — never the other participant (already an explicit spec requirement, not really a decision) |
| 8 | `graduation_checkpoint` | on-read once `meetup_count ≥ 5` and viewer has no `graduation_readiness` row yet | the specific viewer, privately |
| 9 | `meetup_date_reconciliation` | on-read, any `meetups` row with `date_status = 'disputed'` and no `meetup_date_resolutions` row currently `pending` | both, independently — lowest priority by design, purely optional tidying (§5, reconciliation case 2), never blocks or nags |

### 6a. Case B eligibility and resolution (Decision 4, approved)

`conversation_restart_prompt` is distinct from no-ghost: it fires when nobody owes a reply, not when someone does. Eligibility (cron-evaluated, all must hold):

- a real two-sided message history exists on the connection (both participants have sent ≥1 message ever — the same bidirectional check used elsewhere)
- no `no_ghost_r1/r2/r3/s1` intervention is currently pending for either participant (a direct-reply debt always outranks a symmetric restart nudge, per the priority table)
- no `meetups` row is currently `proposed` or `confirmed` (a scheduled plan means the conversation isn't actually stalled, it's just between messages)
- the connection has gone **5 days** with no new message (my own assumption — this app has no existing value to anchor to and no usage telemetry yet, same "revisit once real usage exists" caveat as R1/Decision 5, see §14). Doubled to 10 days whenever `connections.is_self_sustaining = true` for this connection, per §4a's concrete effect — read directly from that boolean, not from `friendship_stage`, which has no notion of this signal at all.

On eligibility, `raise_intervention` is called **twice**, once per participant, each with its own `target_user_id` — two independent rows, never one shared row. Neither participant's row reveals whether the other has one.

**Resolution rule (explicit, since it wasn't written down precisely before):** the moment a new message lands on the connection (via the existing realtime insert path), **both** pending `conversation_restart_prompt` rows — not just the sender's — are marked `resolved`, because the conversation is no longer quiet for either person. This reuses the same "a new message clears stale prompts" trigger this design already needs for no-ghost, applied to one more intervention type, not a new mechanism.

Two things are deliberately **outside** this queue, flagged as a judgment call: `NextMeetupIndicator` (the persistent "next meetup: confirmed for Aug 10" line) and Remember's contextual nudges. Both are ambient/always-available UI, not "the one thing demanding attention right now" — the spec's priority section is explicitly about the primary *relational* intervention, and I read persistent status displays and Remember's cross-cutting nudges as out of that category, matching your own instruction that "Remember... exists throughout the journey," not as a stage or a queued intervention.

---

## 7. What this replaces (KEEP / MODIFY / DELETE, restated against this concrete design)

**KEEP as-is:** `messages` + RLS, `blocks`/`reports`, `first_meetup_feelings`, `next_meetup_feelings` (extended, not replaced), `remember_entries` and its contextual hooks, the no-ghost R1–S1 *shape* (rewired onto the new queue, copy updated per §8).

**MODIFY:** `run_no_ghost_check` now calls `raise_intervention` instead of inserting into `no_ghost_prompts` directly (table folds into the queue). `graduate_connection` becomes gated on a real `graduation_mutual` event, not a bare meetup-count check. `get_meetup_checkin_status`'s cross-participant `branch`/`other_outcome` comparison is deleted outright (§9).

**DELETE:** `no_ghost_prompts`, `meetup_checkins`, `meetup_confirmation_requests`, `meetup_suggestion_state` (folded into `connection_interventions` as intervention types, or in `meetup_suggestion`'s case, kept as a much simpler read since it's just a message-count threshold), `connections.next_meetup_date/status/proposed_by` (folded into `meetups`), `run_curiosity_prompt_check` + its cron + the dangling references to already-dropped tables (confirmed dead in Phase 1).

**REBUILD:** everything in §2–§6 above.

---

## 8. No-ghost R1–S1 — copy/threshold changes riding on the same mechanism

The audit found this mechanism structurally sound; only copy, options, and one threshold decision change.

- **R1 (SUPPORT)**, unchanged trigger math (36h, or 20h if recipient's `response_time = 'Same day'`) — copy becomes "Still meaning to reply?" / Reply / Help me reply / I'll come back to this. No ghosting/ending language (already true today).
  - **Decision 5, approved for now.** No change to the 20h/36h split — there's no usage data to audit against yet, and inventing a new number would have even less basis than what's already there. Marked explicitly as a telemetry-driven parameter to revisit once there are real users, not a settled-forever choice.
  - **Onboarding-compatibility note, added per your instruction, not acted on now:** this threshold reads `profiles.response_time = 'Same day'` — a raw string comparison against onboarding's current response-time option label. Onboarding is explicitly out of scope for this rebuild ("Onboarding will be reviewed separately AFTER this friendship journey is working," per the original brief). Flagging directly so that future session doesn't silently break this comparison: if the onboarding response-time question's wording or option set changes, whoever does that redesign needs to either preserve the literal string `'Same day'` as a stored value, or (better, and worth considering at that time, not now) introduce a stable internal enum for this field decoupled from its display label, so a copy change can never silently decouple the timing logic from the question that feeds it. Not building that decoupling now — it's speculative work for a screen this phase isn't touching.
- **R2 (PERSPECTIVE)**, 72h — copy becomes "They're still waiting to know where things stand." + "Sometimes life gets busy..." / Reply / Help me get back into the conversation / I need more time / I don't want to continue.
- **R3 (ACCOUNTABILITY)**, 120h — "You don't have to continue this connection. But leaving someone without an answer can leave them unsure about what happened." / Reply / Help me say I need more time / Pause connection / End connection.
- **S1 (AGENCY)**, 125h, sender-only, unchanged privacy guarantee (already never reads receiver-side state, confirmed in Phase 1) — "It's been quiet for a while. What would feel right for you?" / Send one more message / Give it more time / Close and make room.
- **Auto-close at 168h** — kept, but now also gated on "not currently paused" (which, per Decision 3 below, already covers every flavor of defer, indefinite or time-boxed) — closing the exact gap the spec flagged ("Do not auto-close a connection during an intentional defer period").

### "I need more time" (Decision 3, approved with modification)

My original Phase 2 proposal treated this as a *new*, separate 7-day auto-resuming mechanism, distinct from the existing indefinite `paused` status — on review that was a direct violation of the core architecture rule (a second, parallel "go quiet" state alongside the one that already exists). The approved design corrects this: there remains **exactly one** quiet-state value, `status = 'paused'`. "I need more time" is one more UI entry point into it, not a new state, and every evaluator's `is_connection_automation_eligible()` check continues to treat `paused` as a single, undifferentiated case regardless of whether a duration was attached — no evaluator needs to know or care which of the three options below was picked.

Tapping "I need more time" at R2/R3 reveals a three-way sub-choice instead of pausing immediately:

| Label shown | Effect |
|---|---|
| A couple of days | `paused_until = now() + 2 days` |
| About a week | `paused_until = now() + 7 days` |
| I'll come back when I'm ready | `paused_until = null` (indefinite — today's existing behavior, unchanged) |

```
pause_connection(connection_id, paused_until):
  connections.status = 'paused'                      -- unchanged mechanism
  upsert connection_pause_details                     -- see §3
    (connection_id, paused_by = auth.uid(), paused_until)
  clear any pending no-ghost interventions for this connection (unchanged existing behavior)

hourly sweep:
  select connection_id from connection_pause_details
    where paused_until is not null and paused_until < now()
  → resume_connection(connection_id)  -- unchanged existing function
  → delete the connection_pause_details row (the defer is over, nothing private left to protect)
```

The chosen duration is never exposed to the other participant — see §3 for why this needed its own table (a plain column on `connections` would have leaked it, since that table's SELECT RLS returns the full row to both participants). The other participant sees only the same "This connection is paused" state they'd see for any pause, with no indication of which of the three options was chosen or when it'll resume.

---

## 9. Deletions with a clear reason

1. **`run_curiosity_prompt_check` + its cron + the underlying dropped-table references** — confirmed dead and failing daily in Phase 1. Delete outright.
2. **`get_meetup_checkin_status`'s mutual `branch`/`other_outcome` comparison** — confirmed in Phase 1 to expose one participant's private evaluation to the other. Superseded entirely by §5's symmetric occurrence model + §3's private reflection table, which structurally cannot leak (self-row RLS, no comparison logic anywhere that returns one user's answer to the other).
3. **The five duplicated "which statuses are excluded" arrays** (found drifted in Phase 1 — `graduated` missing from `reinitiate_ended_connection`, both no-ghost evaluators, both meetup-checkin evaluators, and `clear_prompts_on_connection_closed`) — collapsed into one function, `is_connection_automation_eligible(status)`, used everywhere. This is where the Phase 1 drift bug actually gets fixed, as a structural side effect of the redesign rather than a separate patch.

---

## 10. Video 5 and Ordinary Time — small, non-schema pieces

- **Video 5, "It's Okay to Pick It Back Up"**: a new content-hook entry (same pattern as the existing `guide_meetup_anxiety`/`guide_friendship_grows` guide-only entries), triggered the first time `conversation_restart_prompt` renders for a given user (tracked via the existing `coach_marks_seen` mechanism, not a new table). Placeholder video asset only, per your instruction not to generate media — reuses the existing `VideoPlaceholder` component.
- **Ordinary Time**: no new AI infrastructure. Recalibrate `generate-activity-suggestions`' existing low-effort category copy toward "ordinary, unplanned time" framing, and add a direct entry point from the `repeated_time` stage (a "Something ordinary?" quick action) rather than only reaching it through the meetup-suggestion banner. Reuses the existing Edge Function and its existing reserve-pool cost architecture untouched.

---

## 11. Analytics — call sites only, no new table

`track()` already exists and no-ops safely when unconfigured. New call sites, added at the point each intervention/event fires, no schema change: `conversation_restart_prompt_shown`, `conversation_restart_used`, `pre_meetup_nervous`, `pre_meetup_plan_simplified`, `meetup_cancelled_safety`, `meetup_occurred`, `another_meetup_scheduled`, `ordinary_time_suggestion_used`, `rhythm_selected`, `graduation_checkpoint_shown`, `graduation_mutual`.

---

## 12. Testing posture (for Phase 4, noted now because it shapes the design)

Every new function that reads/writes state takes `p_now timestamptz default now()`, matching the existing convention every current evaluator already uses (and that the Dev tab's Time Travel panel already relies on). Nothing new needs inventing for deterministic fixtures — the same "call the function directly with a simulated timestamp, then requery" pattern this whole codebase already uses throughout `PROGRESS.md`'s session history is what Phase 4's test list will run on.

---

## 13. Decisions — resolved

All five approved. Nothing below is still open.

| # | Decision | Resolution | Basis |
|---|---|---|---|
| 1 | `early_friendship → repeated_time` trigger | Second `meetup_occurred` event, no elapsed-time component, no count larger than the structural minimum. Explicitly not a friendship-quality claim; never shown to the user. | My design assumption, corrected from an unjustifiable first draft, approved as revised. |
| 2 | `proposed_date` vs. `proposed_datetime` | Date-only. No time-of-day UI or schema until a real feature needs it. | Existing product decision (native-dependency risk), approved unchanged. |
| 3 | "I need more time" defer mechanism | Reuses the single existing `paused` status (no new state) plus a new, participant-private `connection_pause_details` table carrying an optional `paused_until`. User picks "a couple of days" (2d) / "about a week" (7d) / "I'll come back when I'm ready" (indefinite). Duration never exposed to the other participant — enforced via RLS on the new table, not just client-side omission. | Requirement for a defined defer window: existing Limen spec requirement. Fold-into-existing-state correction: core architecture rule. Specific day counts (2/7): my own assumption, unjustified beyond proportionality to the existing R2/R3 timing. |
| 4 | `conversation_restart_prompt` / `rhythm_reminder` targeting | Restart: two independent, private-per-participant rows, symmetric, no assigned responsibility; both resolve the instant either participant sends a real message. Rhythm: viewer-only, never the other participant. | Restart: derived from the spec's own symmetric Case B definition, my reasoning on the tie-break question. Rhythm: already an explicit, non-optional spec requirement — not actually a decision. |
| 5 | R1's 20h/36h threshold | Unchanged. Marked as telemetry-driven, to revisit once real usage exists. Flagged dependency on onboarding's `response_time` field for a future onboarding-redesign session to re-verify. | No usage data exists to audit against — a data constraint, not a product choice I can make now. |
| 6 (Phase 3 follow-up) | Second Look "any vs. both" for `post_first_meetup → early_friendship` | Fires on **either** participant's qualifying "yes," not both. Explicitly, permanently NOT evidence of mutual sentiment — a structural gate only, same non-evaluative role every other stage transition plays. Second Look stays private/individual: never compared across participants, never exposed to the other side, regardless of whose answer triggered the transition. See the transition table note above §13 for the full statement. | Flagged as open in the Phase 3 Steps 2-3 report; approved 2026-08-09. |

## 13a. Second review pass — three items you caught that the first pass left unresolved

### Decision 6 — `repeated_time → rhythm_established`

**Was elapsed time actually necessary?** No — on reconsideration, I'd conflated two different questions. "Sufficient elapsed time since meetup #1" doesn't belong to the *stage transition* at all; it belongs to a different question, *when is it fair to first ask a participant the rhythm question*. Those are genuinely separate: the stage is a data-existence check, the question's eligibility is a UX-timing check.

**What the elapsed-time-shaped requirement actually detects, and where it now lives:** a person can't meaningfully answer "what pace feels natural" without having experienced a real *gap* between two meetups to have a felt sense of. If meetup #2 happens the day after meetup #1, there's nothing to reflect on yet. So the real requirement is: **the two most recent occurred meetups are not on the same calendar date** — a structural floor (a gap must exist at all), not a chosen day-count. I deliberately did not add a further minimum like "at least 3 days apart" on top of that, because I have no better basis for 3 than I had for my original, rejected 14-day figure — flagging that trade-off rather than hiding it. This condition now lives at the `rhythm_reminder` intervention's *initial-collection* eligibility (§6), not the stage transition.

**The stage transition itself, once separated from that:** by the time a `rhythm_preferences` row could possibly exist, its own prerequisite (≥2 occurred meetups with a real gap) is already guaranteed. So the transition needs nothing beyond a plain existence check.

**Both participants, or just one?** Reconsidered per your instruction, and you're right: gating a *shared* stage on a *private, individual* reflection creates exactly the failure mode you named — one person's unanswered prompt blocking their partner's already-available, already-useful, already-private reminder for no reason. The reminder itself is delivered independently per person regardless of the other's answer (already true in this design). Requiring both was never actually load-bearing. **Final rule: `repeated_time → rhythm_established` fires the moment ANY ONE participant's `rhythm_preferences` row is first written.**

**Recurring rhythm-reminder trigger (a related gap the walkthrough surfaced, not previously written down anywhere):** once a preference exists, the reminder re-fires when elapsed time since the connection's last occurred meetup meets the participant's own stated cadence. Mapping their own words to an approximate day count — labeled explicitly as my own rough interpretation, not a milestone, tunable later:

| Their answer | Reminder fires once elapsed time since last meetup reaches |
|---|---|
| `weekly` | 10 days |
| `few_weeks` | 21 days |
| `monthly` | 35 days |
| `occasional` | 60 days |
| `not_sure` | never auto-fires — nothing stated to check against |

**Basis:** the OR-not-AND correction is directly grounded in your own stated reasoning (an explicit requirement, not my invention). Removing elapsed time from the stage transition is my own re-derivation. The remaining gap condition is structural, not a chosen number. The day mappings above are my own assumption end to end.

### Decision 7 — `is_self_sustaining`, why each kept signal is there and why two were excluded

The exact rule is in §4a. Here's the reasoning per condition, as requested:

| Signal | Why needed | How measured | Minimum condition | If unavailable | Basis |
|---|---|---|---|---|---|
| `reciprocal_initiation` | Detects "not one person carrying the whole relationship" without inventing a ratio/percentage | `meetups.proposed_by` includes both `user_a_id` and `user_b_id` at least once, ever | Each side has proposed at least once — a structural floor, not a heuristic | Connection has 0 meetups → condition false, `self_sustaining` never fires (correct — it shouldn't fire that early anyway) | Direct spec-listed signal ("reciprocal initiation"); threshold is structural, not chosen |
| `organic_planning` | Detects "plans made without Limen prompting," named directly in your spec | New `meetups.prompted_by_limen` boolean, stamped at `propose_meetup()` write time (was a pending intervention showing for the proposer at that exact moment?) — never inferred after the fact | Most recent proposal has `prompted_by_limen = false`, checked via `coalesce(... = false, false)` — **fixed in this pass**: the first draft used `IS NOT TRUE`, which treats both `false` and `NULL`/missing as passing, directly contradicting this same row's own stated intent. `coalesce(x = false, false)` is the version that actually only passes on an explicit `false` | `NULL`/no qualifying meetup → `false` (fails), matching this row's intent for the first time, not just stating it | Direct spec-listed signal; boolean, no numeric threshold at all |
| `quiet_on_intervention_need` | Detects "declining need for restart/no-ghost interventions" | Zero no-ghost or restart interventions `pending`, and none `created_at` within the last 30 days | Literal zero — simplified from a rate-of-decline-vs-history comparison, which I could not define without inventing a formula I can't defend | Always computable from existing data | Spec-listed signal; the *simplification* (recency instead of a trend comparison) and the *30-day window* are both my own assumption, chosen only for rough proportionality to this app's other month-scale windows (referral, premium pool) — not researched |
| `enough_history` | A safety floor, not really a signal — prevents the other three conditions being vacuously true on a connection that's barely begun | `count(*) meetups where status='occurred' >= 2` | 2 — the same structural minimum as Decision 1 | N/A | My own addition, structural minimum |

**Excluded, with reasons, not silently dropped:**
- *"Activity across more than one context"* — the app has no way to observe whether two people see each other outside it ("users engage outside the app if they choose" is explicitly outside what this system can measure). No signal built for this; including it would mean fabricating data that doesn't exist.
- *"Repeated mutual message-initiation over time"* — this app already built and shipped this exact signal once (F20 reciprocity awareness) and explicitly disabled it because the heuristic falsely flagged ordinary, healthy back-and-forth conversations as one-sided, with no better detection approach found since. Reintroducing it here without solving that already-documented problem would repeat a known failure, not add a new signal.

### Decision 8 — meetup date/history model

Fully specified in the revised §5, not duplicated here. Summary: `meetups` now separates `proposed_date`/`confirmed_date`/`occurred_date` as genuinely distinct fields, with a dedicated `date_status` making occurrence certainty and date certainty two independent, separately-tracked facts (a real correction from the first draft, which silently collapsed the two — see §5); a new `meetup_occurrence_reports.reported_date` captures each participant's own claim; a new, shared `meetup_date_resolutions` table provides mutual-approval reconciliation for both an initial date dispute and any later correction, so shared history can never be unilaterally overwritten; and a new `meetup_history` view exposes only reconciled, factual data — never an individual's raw claim, never anything from `private_post_meetup_reflections`.

### Decision 9 — the one-sided occurrence-report timeout, structure separated from the number

I'd previously labeled this "my own assumption" and moved on, which isn't the same as it being an approved product decision — you're right to push back on that. Redesigning properly, structure first, number last.

**One participant responds, the other hasn't yet — what happens, concretely:**
- The occurrence-check intervention (§6, rank 3) fires independently for both participants the day after a confirmed date passes with no report. When one participant answers, *their own* pending intervention resolves immediately — there's nothing more for them to do.
- The other participant's intervention stays `pending`, exactly like any other unresolved queue item in this design. It surfaces again every time they open that thread, with copy that reflects whether the other side already answered ("X mentioned you two met up — did that happen for you too?" vs. a blank "How did it go?"), reusing the existing copy pattern this app already has for this exact distinction.

**Reminders:** none beyond that persistent, always-current queue item. This app has no push notification infrastructure anywhere (a standing, already-documented limitation), so there's no separate "nudge" mechanism to design here — the same "it's visible again next time they open the app" pattern every other pending intervention in this design already uses is sufficient, not a gap needing its own new feature.

**When it becomes `unresolved`:** a single clock, starting the moment the occurrence-check first raises for the connection (not a second, separate clock keyed to whichever participant answered first — that would need its own justification I don't have and would double the number of timing decisions for no clear benefit). If the second participant still hasn't answered once that window elapses, `status` resolves to `'unresolved'`.

**Can a participant still respond after it's `unresolved`?** Yes, deliberately, and this is a real design decision, not an oversight: `unresolved` means "we don't yet know," not "we've given up and closed the book." A late answer is still accepted. If it's the second participant's first-ever answer and it would now produce two matching "yes" reports, the record **retroactively resolves to `'occurred'`** (running the same case-1/case-2 reconciliation logic from §5 as if both had answered on time) rather than staying permanently stuck. This matches the whole design's non-punitive stance — nothing about a late answer should be treated as worse than a timely one. Once `unresolved`, the record drops out of the active priority queue (it shouldn't keep nagging either participant indefinitely at rank 3), but a lightweight, always-available "did this actually happen?" affordance stays on the meetup entry itself so either participant can register a late answer whenever they want to, with no forced deadline on *that*.

**The number itself:** I don't have a defensible, independently-derived duration for this. The best I can offer is a structural anchor, not a derivation: this ask (report whether one specific past meetup happened) is strictly smaller and lower-stakes than what no-ghost's own 168-hour (7-day) auto-close threshold protects (an entire conversation's continued existence), so it would be inconsistent for this timeout to be *longer* than that. **Approved for Phase 3** as a temporary telemetry-driven default — 7 days — explicitly marked provisional and adjustable once real usage data exists, not treated as a settled research-backed figure. It remains the single number in this design most likely to need revision once there's real usage to look at.

### Decision 10 — `is_self_sustaining` decoupled from `friendship_stage`

**The exact problem:** the design mixed a forward-only narrative stage and a reversible intervention-intensity signal under one mechanism — `friendship_stage = 'self_sustaining'`. The moment a connection that had reached that value later needed a no-ghost or restart prompt again, there was no correct move: either `friendship_stage` had to go backward (breaking every other transition in §4, which only ever advances) or the stage would keep falsely reporting "self-sustaining" on a connection that plainly needed help again. This is precisely the anti-pattern the whole rebuild exists to eliminate — a feature quietly redefining connection state on its own terms instead of deferring to the one state machine.

**The fix:** two fully separate mechanisms, not one relabeled. `friendship_stage` (§4) keeps its original 8 values (`repeated_time` and `rhythm_established` now both lead directly to `graduation_eligible`, with nothing sitting between them) and never moves backward. `is_self_sustaining` (§4a) is a plain boolean column, written by its own function on its own sweep pass, read only by Case B's eligibility check (§6a) to decide *how long to wait*, never read by `advance_friendship_stage()` and never capable of writing to `friendship_stage`. A connection can lose `is_self_sustaining` and regain full intervention support the very next sweep, with its narrative stage — already at `rhythm_established` or `graduation_eligible` from real, forward-only events — completely undisturbed.

**Never shown to the user, never evidence of anything:** `is_self_sustaining` controls timing only (Case B's threshold). It is never rendered in any UI, never referenced in copy, and never used as a signal that two people "are friends" — matching the same treatment every other internal stage value already has in this design.

---

## 14. Remaining deferred parameters — explicit inventory, so nothing is silently vague

Every numeric/tuning parameter in this design, in one place, each with a resolution status:

| Parameter | Status | Value | Label |
|---|---|---|---|
| No-ghost R1 threshold | **Resolved, Decision 5** | 20h (same-day responders) / 36h (everyone else) | Existing app value, kept, explicitly deferred to future telemetry |
| "I need more time" defer options | **Resolved, Decision 3** | 2 days / 7 days / indefinite | My assumption, approved as-is |
| Meetup occurrence one-sided-report timeout | **Approved for Phase 3 as a temporary default** — explicitly provisional, to be revisited once real telemetry exists, not a settled research-backed figure | 7 days (revised down from 14) | Structural anchor only (must not exceed no-ghost's own 7-day auto-close ceiling, since this is a smaller ask) — the exact number is not derived |
| Meetup date-reconciliation (§5 case 2, disputed dates) | **Resolved — deliberately no timeout at all** | N/A | Structural: nothing else in the design depends on `date_status`, so an indefinitely unresolved dispute is safe and requires no tuning parameter |
| `is_self_sustaining` intervention-quiet window | **Resolved, Decision 7** | 30 days | My assumption |
| `is_self_sustaining` restart-cooldown multiplier | **Resolved, Decision 7** | ×2 | My assumption |
| Rhythm-question initial eligibility gap | **Resolved, Decision 6** | Structural — any nonzero gap between the two most recent occurred meetups, no specific day count | Structural floor, not a chosen number |
| Rhythm-reminder recurrence per cadence | **Resolved, Decision 6** | 10 / 21 / 35 / 60 days (weekly/few_weeks/monthly/occasional) | My assumption, interpreting the user's own words |
| Case B (`conversation_restart_prompt`) quiet-days threshold | **Resolved in this pass — was still a bare "configurable" placeholder, the one true remaining gap this sweep found** | 5 days of no messages | My assumption, no existing app value to anchor to, same "revisit with telemetry" caveat as R1 |

Every row above is now in exactly one of three honestly-distinguished states: an existing, previously-reasoned app value; an explicit product requirement; or a number I've labeled as mine — and within that third category, one row (the occurrence-report timeout) is further distinguished as **still genuinely provisional and not yet approved**, not just "my assumption" in the same settled sense as the pause-duration options you already signed off on. None are left as a bare unlabeled phrase like "sufficient," "configurable," or "periodic."

Nothing in this document has been applied to the database. Phase 3 is: disable old automation, write the migration, and only then flip the new evaluators on — old and new never running in parallel, per your original instruction.
