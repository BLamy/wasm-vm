import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateCorrectedColdBudget,CORRECTED_COLD_CAP,CORRECTED_COLD_WALL_MS}
  from './e9-corrected-cold-budget.mjs';
import {OLD_COLD_REPORT} from './e9-cold-prefix-budget.mjs';

const GiB=1024**3;
const good={hostFreeBytes:56*GiB,browserQuota:OLD_COLD_REPORT.browserQuotaBefore,
  browserUsage:0};

test('27B corrected cold prefix has finite wall, retention and two-copy host headroom',()=>{
  const result=calculateCorrectedColdBudget(good);
  assert.equal(result.transitionCap,String(CORRECTED_COLD_CAP));
  assert.equal(result.wallMs,CORRECTED_COLD_WALL_MS);
  assert.equal(result.predictedPayloadBytes,16285551436);
  assert.equal(result.predictedHostConsumption,32983545600);
  assert.equal(result.hostRequiredBytes,55711547980);
  assert.equal(result.predictedWallMs,63234047);
  assert(result.predictedPayloadBytes<result.retentionLimitBytes);
  assert(result.predictedWallMs<result.wallMs);
  assert(result.hostRequiredBytes<good.hostFreeBytes);
});

test('low disk, quota and invalid capacity are refused before cold launch',()=>{
  const result=calculateCorrectedColdBudget(good);
  assert.throws(()=>calculateCorrectedColdBudget({...good,
    hostFreeBytes:result.hostRequiredBytes-1}),/host capacity/);
  assert.throws(()=>calculateCorrectedColdBudget({...good,
    browserQuota:result.rollingBrowserRequiredBytes-1}),/browser quota/);
  assert.throws(()=>calculateCorrectedColdBudget({...good,browserUsage:-1}),/invalid/);
});
