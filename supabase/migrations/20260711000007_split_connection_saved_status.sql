-- F11 fix: saved and messaged are independent facts about a connection,
-- not mutually exclusive states. The original design folded "saved" into
-- the same status column used for the connection's actual lifecycle
-- (pending, active, etc.), so messaging someone after saving them
-- overwrote the saved state and the Saved badge disappeared. A user can
-- be both saved and messaged at once, this splits them into a dedicated
-- saved boolean and a status column reserved for connection state.
--
-- No data migration needed, connections is empty on the live project as
-- of this migration (checked directly before writing it).
alter table public.connections
  add column if not exists saved boolean not null default false;

alter table public.connections
  drop constraint if exists connections_status_check;

alter table public.connections
  alter column status drop not null;

-- status is now nullable: null means no lifecycle action has happened yet
-- (a person can be saved with a null status). pending is set when a
-- message is sent (F16 doesn't exist yet, so this is the furthest the
-- lifecycle goes right now); active and later states (graduated, ended,
-- etc.) are reserved for when the rest of the friendship arc is built.
-- passed means the user dismissed this suggestion.
alter table public.connections
  add constraint connections_status_check
  check (status is null or status in ('pending', 'active', 'passed'));
