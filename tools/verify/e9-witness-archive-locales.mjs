// Exercise real storage archive APIs under a browser locale which changes SHA
// collation. These contexts consume retained native evidence, not new execution.
import assert from 'node:assert/strict';
import path from 'node:path';

export async function checkWitnessArchiveLocales(browser, origin, output) {
  const results = [];
  for (const locale of ['en-US', 'en-US-u-kn-true']) {
    const context = await browser.newContext({locale, serviceWorkers: 'block'});
    await context.tracing.start({screenshots: true, snapshots: false, sources: true});
    const page = await context.newPage(), errors = [], external = [];
    page.on('console', message => {if (message.type() === 'error') errors.push(message.text());});
    page.on('pageerror', error => errors.push(String(error.stack ?? error)));
    page.on('request', request => {if (new URL(request.url()).origin !== origin) external.push(request.url());});
    try {
      await page.goto(origin + '/', {waitUntil: 'domcontentloaded'});
      const result = await page.evaluate(async () => {
        const {indexSessionBundle} = await import('/session-bundle-format.js');
        const {inspectSessionWitnessArchive, importSessionWitnessArchive, exportSessionWitnessArchive} = await import('/session-witness-archives.js');
        const {SessionStore} = await import('/session-store.js');
        const need = (ok, why) => {if (!ok) throw Error('Witness archive locale: ' + why);};
        const sha = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        const response = await fetch('/__witness_archive__'); need(response.ok, 'retained archive fetch');
        const input = await response.arrayBuffer(), blob = new Blob([input]), indexed = await indexSessionBundle(blob);
        const originalHash = await sha(input), originalObjects = indexed.header.objects;
        const localOrder = [...originalObjects].sort((a, b) => a.sha256.localeCompare(b.sha256));
        const firstDivergence = originalObjects.findIndex((ref, i) => ref.sha256 !== localOrder[i].sha256);
        const store = await SessionStore.open('wasm-vm-sessions-v1-archive-locale');
        try {
          const before = await store.statistics(); need(before.sessions === 0 && before.objects === 0 && before.chunks === 0, 'fresh destination');
          const inspection = await inspectSessionWitnessArchive(blob);
          need(inspection.witnesses === 130 && inspection.admission === 'storage-only' && inspection.finished, 'complete native archive inspection');
          const imported = await importSessionWitnessArchive(store, blob), after = await store.statistics();
          need(imported.manifestSha256 === indexed.header.manifest.sha256 && after.sessions === 1, 'exact manifest published');
          const exported = await exportSessionWitnessArchive(store, inspection.id), exportedBytes = await exported.blob.arrayBuffer();
          const exportedHash = await sha(exportedBytes), exportedIndex = await indexSessionBundle(exported.blob);
          need(exportedBytes.byteLength === input.byteLength && exportedHash === originalHash, 'locale changed canonical export bytes');
          need(JSON.stringify(exportedIndex.header) === JSON.stringify(indexed.header), 'locale changed header inventory');
          const reinspection = await inspectSessionWitnessArchive(exported.blob);
          need(JSON.stringify(reinspection) === JSON.stringify(inspection), 'export did not preserve exact witness binding');
          return {locale: navigator.language, collation: new Intl.Collator().resolvedOptions(), firstDivergence,
            divergence: firstDivergence < 0 ? null : {strict: originalObjects[firstDivergence].sha256, locale: localOrder[firstDivergence].sha256},
            archive: {bytes: input.byteLength, sha256: originalHash, objects: originalObjects.length},
            inspection, imported, before, after, exported: {bytes: exportedBytes.byteLength, sha256: exportedHash}, status: 'passed'};
        } finally {await store.close();}
      });
      assert.equal(result.collation.numeric, locale !== 'en-US', 'numeric locale must actually affect default Chrome collation');
      assert.equal(result.firstDivergence < 0, locale === 'en-US', 'actual SHA inventory must exercise locale disagreement');
      assert.deepEqual(errors, []); assert.deepEqual(external, []);
      results.push({requestedLocale: locale, ...result, errors, external});
    } finally {
      await context.tracing.stop({path: path.join(output, 'archive-locale-' + locale + '.zip')});
      await context.close();
    }
  }
  assert.equal(results[0].exported.sha256, results[1].exported.sha256, 'cross-locale archive identity');
  return {scope: 'real storage-only archive inspection/import/export; original native execution is retained, not rerun', status: 'passed', locales: results};
}
