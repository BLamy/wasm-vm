// Independent expected Pages manifest: release bytes are immutable on public R2.
// Every other byte still has to match the committed, reproducible dist.
export function expectedPublishedSource(relative, original) {
  if (!/^artifacts(?:-[a-z-]+)?\.json$/.test(relative)) return original;
  const value = JSON.parse(original), base = 'https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev';
  let changed = false;
  for (const artifact of Object.values(value.artifacts ?? {})) {
    const url = artifact.url;
    if (/^releases\/(?:kernel|initramfs|rootfs)\//.test(url) ||
        /^releases\/boot-snapshot\//.test(url) && artifact.size > 25 * 1024 * 1024) {
      artifact.url = base + '/sha256/' + artifact.sha256 + '/' + url; changed = true;
    }
  }
  const rewriteChunks = item => {
    if (typeof item === 'string' && /^releases\/chunked-(?:alpine|node-alpine|omarchy)\//.test(item)) {
      changed = true; return base + '/' + item.slice('releases/'.length);
    }
    if (Array.isArray(item)) return item.map(rewriteChunks);
    if (item && typeof item === 'object') for (const key of Object.keys(item)) item[key] = rewriteChunks(item[key]);
    return item;
  };
  rewriteChunks(value);
  return changed ? Buffer.from(JSON.stringify(value, null, 2) + '\n') : original;
}
