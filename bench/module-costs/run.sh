#!/usr/bin/env bash
# E4-T19 cost matrix — ONE command from a clean checkout. Installs the Playwright browsers if needed,
# then runs the compile/instantiate/instance-cliff matrix on Chromium + Firefox + WebKit, writing
# results/<engine>.json. The optional separately installed Chrome screen is documented in README.md;
# it is deliberately not part of this clean-checkout three-engine command.
set -euo pipefail
cd "$(dirname "$0")"

npm install
npx playwright install chromium firefox webkit
npm run matrix
echo "cost matrix written to $(pwd)/results/"
