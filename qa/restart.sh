#!/bin/bash
# (Re)start PostgREST (3000), the gateway (54321) and the web server (8099).
Q=$(cd "$(dirname "$0")" && pwd); cd "$Q"
pkill -x postgrest; pkill -f 'node gatewa[y].js'; pkill -f 'node serv[e].js'
sleep 1
(setsid nohup ./.local/postgrest postgrest.conf > .local/pgrst.log 2>&1 &)
(setsid nohup node gateway.js > .local/gw.log 2>&1 &)
(setsid nohup node serve.js "$Q/.local/web" 8099 > .local/serve.log 2>&1 &)
sleep 3
curl -s -o /dev/null -w "web %{http_code}\n" localhost:8099/
curl -s -o /dev/null -w "api %{http_code}\n" localhost:54321/rest/v1/
