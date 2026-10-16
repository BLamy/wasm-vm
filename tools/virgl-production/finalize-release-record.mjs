// Preserve the primary acceptance result before browser cleanup can reject.
export async function finalizeReleaseRecord(report, save, resources) {
  await save();
  for (const resource of resources) {
    try {
      await resource.close();
    } catch (error) {
      report.status = 'failed';
      (report.cleanupErrors ??= []).push({
        resource: resource.name, error: error?.stack ?? String(error),
      });
    }
  }
  report.finishedAt = new Date().toISOString();
  await save();
}
