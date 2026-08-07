#!/usr/bin/env bash
# E4-T19 cost matrix — ONE command from a clean checkout. Installs the Playwright browsers if needed,
# then runs the compile/instantiate/instance-cliff matrix on Chromium + Firefox + WebKit, writing
# results/<engine>.json. Live capture is DEV work (this mac OS-reaps long browser runs); on the Linux
# dev box this reproduces the committed cost matrix. No numbers are fabricated: results/ ships empty.
set -euo pipefail
cd "$(dirname "$0")"

npm install
npx playwright install chromium firefox webkit
npm run matrix
echo "cost matrix written to $(pwd)/results/"
