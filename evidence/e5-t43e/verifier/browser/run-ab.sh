#!/bin/bash
# Verifier interleaved A/B (gen3 = :8125 committed web/dist, gen2 = :8129 same dist with gen 2 manifest).
cd "$(dirname "$0")/../../../.."
D=evidence/e5-t43e/verifier/browser
i=0
for side in gen3 gen2 gen2 gen3 gen3 gen2; do
  i=$((i+1)); port=8125; [ $side = gen2 ] && port=8129
  node tools/perf/desktop-latency.mjs --url http://127.0.0.1:$port --app /app.html --scenarios idle,click,type,node --n 8 \
    --label v-$side-$i --out $D/$i-$side.json > $D/$i-$side.log 2>&1
  echo "$i $side exit $?" >> $D/runs.txt
done
echo DONE >> $D/runs.txt
