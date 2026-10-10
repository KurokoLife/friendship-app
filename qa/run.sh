#!/bin/bash
# Run on-screen suites in the background, one after another:
#   bash qa/run.sh qa-remind qa-share      (or: bash qa/run.sh all)
# Output: qa/.local/out-<suite>.txt, and qa/.local/out-all.txt when done.
Q=$(cd "$(dirname "$0")" && pwd)
list="$*"; [ "$list" = "all" ] && list=$(cd "$Q/suites" && ls qa-*.js | sed 's/\.js$//')
rm -f "$Q/.local/out-all.txt"
(cd "$Q" && setsid nohup bash -c "for f in $list; do node suites/\$f.js > .local/out-\$f.txt 2>&1; done; echo done > .local/out-all.txt" >/dev/null 2>&1 &)
echo "started: $list"
