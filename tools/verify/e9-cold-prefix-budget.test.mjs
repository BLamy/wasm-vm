import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateColdPrefixBudget,OLD_COLD_REPORT} from './e9-cold-prefix-budget.mjs';

test('old 20B receipt admits a finite 22B cold prefix with live-profile and export headroom',()=>{
  const receipt=calculateColdPrefixBudget({hostFreeBytes:50*1024**3,
    browserQuota:OLD_COLD_REPORT.browserQuotaBefore,browserUsage:0});
  assert.equal(receipt.transitionCap,'22000000000');
  assert.equal(receipt.wallMs,50400000);
  assert(receipt.predictedWallMs<receipt.wallMs);
  assert(receipt.hostRequiredBytes<50*1024**3);
  assert(receipt.hostRequiredBytes>40*1024**3);
  assert(receipt.predictedPayloadBytes<receipt.retentionLimitBytes);
});

test('refuses inadequate disk, quota, and invalid receipts before launch',()=>{
  const good={hostFreeBytes:50*1024**3,browserQuota:OLD_COLD_REPORT.browserQuotaBefore,browserUsage:0};
  const receipt=calculateColdPrefixBudget(good);
  assert.throws(()=>calculateColdPrefixBudget({...good,hostFreeBytes:36*1024**3}),/host capacity/);
  assert.throws(()=>calculateColdPrefixBudget({...good,hostFreeBytes:receipt.hostRequiredBytes-1}),/host capacity/);
  assert.throws(()=>calculateColdPrefixBudget({...good,browserQuota:receipt.rollingBrowserRequiredBytes-1}),/browser quota/);
  assert.throws(()=>calculateColdPrefixBudget({...good,browserUsage:-1}),/invalid/);
});
