# Pinned software base publication

The E9-T01 raw 512 MiB image remains unchanged. `web/session-alpine-image.json` names its 4,096 128 KiB chunks (227 distinct hashes). Eight content-addressed chunks absent from the existing R2 prefix were added; existing objects were not overwritten. All 227 public responses passed independent SHA and length checks in `public-chunks.json`. The browser still authenticates every requested chunk through the production fetch path.

These are asset-publication receipts, not the final E9-T04 runtime proof. The acceptance recorder independently rechecks the full base image against this manifest.
