#!/bin/bash
# Rebuild the local database from scratch: Supabase stand-ins, every
# migration in order (pg_cron/pg_net skipped), then the seed accounts.
set -u
Q=$(cd "$(dirname "$0")" && pwd)
MIG="$Q/../supabase/migrations"
PSQL="psql -h /tmp -p 5433 -U postgres -v ON_ERROR_STOP=1 -q"
pkill -x postgrest || true
psql -h /tmp -p 5433 -U postgres -d postgres -q -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='limen'" >/dev/null
psql -h /tmp -p 5433 -U postgres -d postgres -q -c "drop database if exists limen" -c "create database limen" >/dev/null
$PSQL -d limen -f "$Q/bootstrap.sql" 2>&1 | grep -v "already exists" | head -5
fail=0
for f in $(ls "$MIG"/*.sql | sort); do
  sed -e 's/create extension if not exists pg_cron[^;]*;/select 1;/I' \
      -e 's/create extension if not exists pg_net[^;]*;/select 1;/I' "$f" > /tmp/limen-mig.sql
  out=$($PSQL -d limen -f /tmp/limen-mig.sql 2>&1)
  if [ $? -ne 0 ]; then echo "FAILED: $(basename "$f")"; echo "$out" | tail -3; fail=1; fi
done
echo "migrations done (failures: $fail)"
$PSQL -d limen -f "$Q/seed.sql"
psql -h /tmp -p 5433 -U postgres -d limen -qc "notify pgrst, 'reload schema'"
