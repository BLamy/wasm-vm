#!/usr/bin/env bash
# Scratch screening scripts from the webbuild A/B (paths point at the session scratch dir; edit S= / W= to rerun).
S=/private/tmp/claude-501/-Users-blamy-Documents-Codex-wasm-vm/c38a19b9-ce95-4fcc-b09d-e4bcfb239086/scratchpad/webbuild
OUT=$1; REPS=$2; shift 2; roots=("$@"); n=${#roots[@]}
for ((rep=0; rep<REPS; rep++)); do
  for ((i=0; i<n; i++)); do
    if (( rep % 2 == 0 )); then r=${roots[i]}; else r=${roots[n-1-i]}; fi
    load=$(sysctl -n vm.loadavg | awk '{print $2}')
    res=$($S/rurun node $S/nodebench.mjs $S/roots/$r ${INSTR:-330000000} ${FAST:-1})
    j=$(echo "$res" | grep '^{'); ru=$(echo "$res" | grep '^RU ' | cut -c4-)
    echo "{\"rep\":$rep,\"load\":$load,\"ru\":$ru,\"r\":$j}" >> $OUT
  done
done
