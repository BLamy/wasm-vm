#!/usr/bin/env python3
"""Package the reproducible ext2 fixture as immutable, deduplicated browser chunks."""
import hashlib
import json
from pathlib import Path
import sys

image = Path(sys.argv[1]).read_bytes()
output = Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)
chunk_size = 256 * 1024
hashes = []
for start in range(0, len(image), chunk_size):
    chunk = image[start:start + chunk_size]
    digest = hashlib.sha256(chunk).hexdigest()
    (output / f"{digest}.bin").write_bytes(chunk)
    hashes.append(digest)
manifest = dict(version=1, image_len=len(image), chunk_size=chunk_size,
                layout="split", chunks=hashes)
(output / "image.json").write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
print(json.dumps(dict(imageSha256=hashlib.sha256(image).hexdigest(),
                     imageBytes=len(image), uniqueChunks=len(set(hashes))), indent=2))
