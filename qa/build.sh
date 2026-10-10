#!/bin/bash
# Export the web app pointed at the local stand-in (gateway on 54321).
Q=$(cd "$(dirname "$0")" && pwd)
ANON=$(node -e "const c=require('crypto');const b=o=>Buffer.from(JSON.stringify(o)).toString('base64url');const h=b({alg:'HS256',typ:'JWT'}),p=b({role:'anon',iss:'local',exp:4102444800});console.log(h+'.'+p+'.'+c.createHmac('sha256','local-test-secret-local-test-secret-1234').update(h+'.'+p).digest('base64url'))")
cd "$Q/.." && rm -rf "$Q/.local/web" && EXPO_PUBLIC_SUPABASE_URL=http://localhost:54321 EXPO_PUBLIC_SUPABASE_ANON_KEY=$ANON \
  npx expo export --platform web --output-dir "$Q/.local/web" > "$Q/.local/export.log" 2>&1; tail -1 "$Q/.local/export.log"
psql -h /tmp -p 5433 -U postgres -d limen -c "notify pgrst, 'reload schema'" >/dev/null
