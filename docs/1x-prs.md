# 1.x draft PR publication packet

Published as draft PRs on 2026-09-09 after user-completed Git Credential Manager authentication. All four branch pushes succeeded. No production merge, deploy or DB change was performed. CI was running at publication; this record does not claim CI completion.

- [PR #6 — validation and upload](https://github.com/erleri/congenial-octo-garbanzo/pull/6); [preview](https://deploy-preview-6--latamforex.netlify.app) reported ready, visual smoke test still pending.
- [PR #7 — plan storage](https://github.com/erleri/congenial-octo-garbanzo/pull/7).
- [PR #8 — data fallback](https://github.com/erleri/congenial-octo-garbanzo/pull/8).
- [PR #9 — admin history](https://github.com/erleri/congenial-octo-garbanzo/pull/9).

| Order | Head | Review base | Title |
| --- | --- | --- | --- |
| 1 | `codex/1x-validation-upload` | `main` | 1.x: reproducible checks and safe Excel uploads |
| 2 | `codex/1x-plan-storage` | `codex/1x-validation-upload` | 1.x: additive plan current values and explicit access checkpoint |
| 3 | `codex/1x-data-fallback` | `codex/1x-plan-storage` | 1.x: bounded JSON fallback and data coverage warnings |
| 4 | `codex/1x-admin-history` | `codex/1x-data-fallback` | 1.x: admin history pagination and session invalidation |

Stacked bases keep each diff focused. Retarget subsequent PRs after their predecessor is merged, and re-run checks against the then-current main. Never merge the whole stack at once. The contract file is outside automatic migrations and requires its own explicit approval/promotion after reader transition.

## Publication

Publication is complete. Git is bundled in the local runtime and is not necessarily on a user's PowerShell PATH; use its verified absolute executable path if authentication is needed again. Do not paste access tokens into chat. Only push named review branches (no force push). Publication may create previews, but must not deploy production or dispatch the email workflow.

## PR bodies

1. Preserve existing production calculation/data paths. Add npm-ci quality CI, Vitest, parser/size/extension checks and delayed upload-state replacement. Local stage-1 check: 11 tests plus build passed. Known xlsx advisory is not fixed. Preview and mounted upload-state regression remain required.
2. Add current table/backfill/insert synchronization, explicit grants and compatible frontend/email current reads. Restrict compatibility fallback to schema error codes. Preserve original migrations and local DB; access closure SQL is a separate checkpoint. Test populated history and all four roles before requesting approval.
3. Keep full history for sync/recovery/email, publish inclusive 400-day daily fallback plus full monthly history. Enforce 5,000,000 bytes. Handle actual data coverage and adjacent-year prefetch errors. Local full/fallback calculation parity passed; real browser outage/cache and email rendering remain gates.
4. Add admin-only invoker RPC and history panel, timestamp+group cursor, no-change page advancement, legacy display-only groups. Clear history on auth changes, guard pending requests, and recheck active membership every 30 seconds while the page remains visible. Mounted UI race and active-admin workflow verification remain required before production approval.

Attach `docs/1x-rollout.md` evidence and uncompleted gates to every draft. No production-ready label until those gates pass.
