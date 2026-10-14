#!/bin/bash
# Runs the real place-search server function on :8000, with Google's answers
# faked (Google can't be reached from the workspace). Used by qa-place.
cd "$(dirname "$0")"
TOK=$(node -e "
const c=require('crypto'),S='local-test-secret-local-test-secret-1234',b=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const h=b({alg:'HS256',typ:'JWT'}),q=b({role:'anon',iss:'local',exp:4102444800});
console.log(h+'.'+q+'.'+c.createHmac('sha256',S).update(h+'.'+q).digest('base64url'))")
pkill -f "deno run -A place-search" 2>/dev/null
SUPABASE_URL=http://localhost:54321 SUPABASE_ANON_KEY=$TOK GOOGLE_PLACES_KEY=test nohup npx deno run -A place-search-fake-google.ts > .local/place-fn.log 2>&1 &
sleep 6; echo "place-search on :8000"
