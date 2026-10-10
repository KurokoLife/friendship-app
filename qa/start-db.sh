#!/bin/bash
# Start the local Postgres (port 5433). Needed once per workspace start.
su pg -s /bin/bash -c "/usr/lib/postgresql/16/bin/pg_ctl -D /srv/limen-pg/pgdata -o '-p 5433 -k /tmp' -l /srv/limen-pg/pg.log start" || true
