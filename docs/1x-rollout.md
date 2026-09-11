# LATAM FX 1.x release checkpoints

## Preserved baselines

- Candidate: `dc6414ce8bf314b9f5048997dd2f678484db85af` on `codex/ops-hardening`.
- Production verified through Netlify on 2026-09-09: `b1e9ceb43add6dd00866334309d8927adc8d6796`.
- Published deploy: `6aa0e49e4f424f00088f9b29`, state ready, production context, published 2026-09-09T04:46:41.361Z.
- Production DB migration listing: `20260504120000`, `20260623112518`, `20260623130259`. Candidate hardening migration is not listed.
- Original working directory contains uncommitted 2026-09-09 full/fallback data. Preserve it; do not overwrite or treat it as part of the code baseline.
- Latest scheduled run: [Daily Dashboard Email, 2026-09-09](https://github.com/erleri/congenial-octo-garbanzo/actions/runs/34312191134), success. Data generation, Supabase sync, chart, mail and artifact steps all reported success. This is the pre-change baseline, not validation of the candidate. Receipt/rendering of the actual email was not inspected.
- Pending evidence: deployed data-source configuration, preview comparison and production approval.

## Release order

1. Validation and Excel upload: clean install, check, existing tests, real workbook parsing, failed upload preserves prior state. Existing production data paths remain in use.
2. Plan storage: additive structure/backfill/trigger, compatibility app and email, then a separately approved access closure. Never rewrite an already applied migration.
3. Data fallback: full history for sync/recovery, 400 calendar days for public JSON, 5,000,000-byte maximum, dashboard/monthly/email parity and outage/cache cases.
4. Admin history: 20 groups, stable pagination, legacy preservation, session-safe clearing.

Every PR must pass CI. Record actual checks rather than assuming a local PASS proves production readiness. Each production change requires an explicit approval and observation of one subsequent scheduled refresh/email before the next stage.

## Rollback

The access-closure SQL is intentionally outside `supabase/migrations`, in `supabase/checkpoints`. Ordinary migration application must only add the compatible structure. After preview and production reader verification, promote the closure using a new CLI-generated migration as a separately reviewed change. Do not apply it automatically with the additive change. The original candidate migration and original local database stay untouched.

- UI: restore the previous verified Netlify deploy.
- Data: restore generator, sync/verification paths and dataset files together; retain the latest complete history for recovery.
- DB: preserve all inserted history. Repair current-value synchronization using a reviewed forward migration. Do not automatically restore public access to saver email or raw history.
- Do not trigger production mail, mutate DB policies, or merge deployment changes as part of preview verification.

## Dependency exception

The npm xlsx 0.18.5 package has known prototype-pollution and ReDoS advisories without an npm-provided fix. Extension, 25 MB size and parsing checks reduce accidental bad uploads but do not remove parser vulnerabilities. Accept only trusted workbooks. Production npm audit remains visible and non-blocking for this known exception.

## Local verification record — 2026-09-09

Worktree: `latamfx-1x`; original `congenial-octo-garbanzo` and its applied local migration history are untouched. Isolated database container: `supabase_db_latamfx-1x-staging` (DB port 55322). No production migration, deploy, merge or email dispatch was performed.

| Area | Evidence | Remaining release gate |
| --- | --- | --- |
| Installation / build | Node 20.19.0; clean `npm ci`; typecheck, ESLint, 25 Vitest tests, production build PASS on final candidate | Repeat CI on each published PR; CI has not run yet |
| Existing regression scripts | `test:verify-values`, `test:period-selection` PASS | Actual operational representative values and email rendering |
| Excel | Valid in-memory workbook, corrupt ZIP, unrelated workbook, extension/size tests PASS; hook commits upload options only after successful merge | Real user workbooks; failed upload preserves mounted UI state |
| Plan storage | Additive local DB startup; 11 pgTAP assertions PASS; transaction-based historical backfill, contract, four-role check PASS | Preview/test Data API login, save, failed re-read, re-login; staged live reader verification |
| Data | Public JSON 3,276,467 bytes; 8,800 daily rows vs 127,030 full rows; monthly/recent daily/moving equality and rendered dashboard text equality PASS | Five screens/mobile tables; email representative-value parity; real browser outage/cache paths |
| History | 20 groups with identical timestamp; next-page boundary; no-change groups; legacy rows; revoked admin RPC tests PASS | Preview mounted UI workflow completed 2026-09-11; production approval remains separate |

History requests are invalidated on auth events/sign-out and details are hidden on window blur. Membership is rechecked on focus, each history page, and every 30 seconds while an active admin keeps the page visible. A failed recheck clears the sensitive history and editing state. This bounds focused-idle external revocation exposure to the next recheck; the mounted Preview verification is recorded below and production approval remains separate.

## Supabase Preview mounted verification — 2026-09-11

Target: draft PR #9 head `aa31b6b1e57343c1d6d0400ebba05f8567be2c64`, Supabase Preview project `umgguqeeeqkfavdgnote`. The production database, production Netlify deploy and production Auth redirect configuration were not changed.

- The exact Preview DB build was served temporarily at `127.0.0.1:3000` because the Preview Auth project redirected its Magic Link to the configured localhost site URL. The user completed authentication; no token was copied or recorded.
- Active admin recognition for the configured Preview test account PASS: the page reported `편집 가능` and displayed the admin-only history panel. The account address is intentionally omitted from the repository record.
- No-change save PASS: one 22-row `change_set_id` was inserted, the operational current value was re-read successfully, and no empty history card was rendered.
- Changed save PASS: USD leading was set to 1,350 in Preview only. A second 22-row change set was inserted, re-read succeeded, and the history card showed period, saver, previous value and new value.
- External revocation PASS: setting the Preview admin row inactive changed the mounted page to read-only within the 30-second recheck window. The history panel disappeared, all 22 inputs were disabled and Save was disabled. Reactivation plus reload restored edit access and history.
- Logout PASS: detailed history disappeared immediately and Save remained disabled; a new Magic Link login restored the admin view.
- Pagination/legacy PASS: 21 identified no-change groups with one shared timestamp plus one legacy row were seeded in Preview. Page 1 retained `이전 이력 더 보기` after filtering no-change groups; page 2 showed the legacy badge and the original admin change without omission; the terminal page removed the button.
- Cleanup PASS: exactly 507 identified test history rows and 22 current rows were removed. A separate verification query reported zero remaining rows for `2026-09`; the configured Preview admin row remains active. The mounted page returned to `기록 없음` with an empty history list.
- Browser console warning/error review from the earlier exact preview smoke remained zero. GitHub Actions run `34598442999` had already passed both `verify` and `database` jobs for this head.
- After recording this evidence, local `npm run check` on Node.js 20.19.0 passed typecheck, ESLint, all 31 Vitest tests and the production build. The existing bundle-size warning remains non-blocking.
- Current Preview advisors: database/RLS findings requiring a code change were not reported. Auth configuration reports two warnings (leaked-password protection disabled and insufficient MFA options); the app uses Magic Links and this PR does not alter production Auth policy. Performance reports two unused-index INFO items; no index is removed based on a fresh Preview workload.

This completes the mounted admin-history gates listed in PR #9. It does not authorize a production merge, production database change or Auth-setting change; those still require the user's explicit rollout approval.

Non-blocking known warnings: production `xlsx` advisory; full dependency audit reports 17 findings (2 low, 3 moderate, 12 high); bundle chunk exceeds 500 kB. No automatic breaking dependency upgrade was attempted.

## Preserved data audit

Read-only reproduction: `node scripts/audit-preserved-data.mjs ../congenial-octo-garbanzo`.

- Candidate data date changed 2026-09-01 → 2026-09-09.
- Daily: 126,854 → 127,030 rows, 176 added, 0 removed, 6 changed.
- Monthly: 4,488 rows both versions, 0 added/removed, 21 changed.
- Preserved full/fallback agree on baseDate, fetchedAt, monthly, selected recent daily and moving comparison.
- Preserved full rows match the verified production SHA's data snapshot in this worktree (daily/monthly/moving); this is not an independent external-source audit.
- SHA-256 of parsed JSON serialization: full `2fc24e7bcbb10ba9bb6204e064466f41fdd0a6872f75a88a1d0d5c01ec2db59b`; fallback `67c645bc8b5f881c4d2f70e5b39c2860e5d88c6539269d638a472be388d4c4f2`.
- Original uncommitted data remain uncommitted; no rewrite or inclusion in the original candidate commit.

## Approval packet required before each production stage

- [ ] Published draft PR, passing CI and reviewed exact diff.
- [ ] Verified target production deploy SHA and data-source setting immediately before rollout.
- [ ] Preview URL plus five-screen/mobile/upload comparison using the same data.
- [ ] For DB stage: independent test Data API four-role checks, populated-history backfill, frontend AND email current-value reader verification; contract approved separately.
- [ ] Previous deploy recorded; synchronized data-path recovery prepared; history-preserving DB forward-repair reviewed. Never automatically reopen saver-email access.
- [ ] Explicit production approval, then manual smoke check and next scheduled refresh/email observation.
- [ ] Stop at any unexpected calculation difference, permission failure or incomplete data range; do not proceed to the next stage.
