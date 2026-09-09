# LATAM FX 1.x release checkpoints

## Preserved baselines

- Candidate: `dc6414ce8bf314b9f5048997dd2f678484db85af` on `codex/ops-hardening`.
- Production verified through Netlify on 2026-09-09: `b1e9ceb43add6dd00866334309d8927adc8d6796`.
- Published deploy: `6aa0e49e4f424f00088f9b29`, state ready, production context, published 2026-09-09T04:46:41.361Z.
- Production DB migration listing: `20260504120000`, `20260623112518`, `20260623130259`. Candidate hardening migration is not listed.
- Original working directory contains uncommitted 2026-09-09 full/fallback data. Preserve it; do not overwrite or treat it as part of the code baseline.
- Pending evidence: deployed data-source configuration, latest scheduled run details, preview comparison and production approval.

## Release order

1. Validation and Excel upload: clean install, check, existing tests, real workbook parsing, failed upload preserves prior state. Existing production data paths remain in use.
2. Plan storage: additive structure/backfill/trigger, compatibility app and email, then a separately approved access closure. Never rewrite an already applied migration.
3. Data fallback: full history for sync/recovery, 400 calendar days for public JSON, 5,000,000-byte maximum, dashboard/monthly/email parity and outage/cache cases.
4. Admin history: 20 groups, stable pagination, legacy preservation, session-safe clearing.

Every PR must pass CI. Record actual checks rather than assuming a local PASS proves production readiness. Each production change requires an explicit approval and observation of one subsequent scheduled refresh/email before the next stage.

## Rollback

- UI: restore the previous verified Netlify deploy.
- Data: restore generator, sync/verification paths and dataset files together; retain the latest complete history for recovery.
- DB: preserve all inserted history. Repair current-value synchronization using a reviewed forward migration. Do not automatically restore public access to saver email or raw history.
- Do not trigger production mail, mutate DB policies, or merge deployment changes as part of preview verification.

## Dependency exception

The npm xlsx 0.18.5 package has known prototype-pollution and ReDoS advisories without an npm-provided fix. Extension, 25 MB size and parsing checks reduce accidental bad uploads but do not remove parser vulnerabilities. Accept only trusted workbooks. Production npm audit remains visible and non-blocking for this known exception.
