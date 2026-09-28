#!/usr/bin/env node
// One existing cap-24/cap-256 comparison; both keep recycling disabled.
import { runInputTrialPair } from "./omarchy-recycling-ab.mjs";

await runInputTrialPair(process.argv[2], "residency");
