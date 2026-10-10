#!/bin/bash
# One-time setup of the local test copy of Limen (run as root in the cloud
# workspace). Installs Postgres 16 if missing, makes a data folder at
# /srv/limen-pg, downloads PostgREST 12.2.3 into qa/.local, and installs the
# two small node packages the tests use. Safe to run again.
set -eu
Q=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$Q/.local"
if [ ! -x /usr/lib/postgresql/16/bin/postgres ]; then
  apt-get update -qq && apt-get install -y -qq postgresql-16 >/dev/null
fi
id pg >/dev/null 2>&1 || useradd -m pg
if [ ! -f /srv/limen-pg/pgdata/PG_VERSION ]; then
  mkdir -p /srv/limen-pg && chown pg /srv/limen-pg
  su pg -s /bin/bash -c "/usr/lib/postgresql/16/bin/initdb -D /srv/limen-pg/pgdata -U postgres --auth=trust -E UTF8 >/dev/null"
fi
if [ ! -x "$Q/.local/postgrest" ]; then
  curl -sSL -o "$Q/.local/pgrst.tar.xz" https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz
  tar -xJf "$Q/.local/pgrst.tar.xz" -C "$Q/.local" && rm "$Q/.local/pgrst.tar.xz"
fi
(cd "$Q" && npm install --silent --no-audit --no-fund pg@8 playwright-core@1.56 >/dev/null)
echo "setup done"
