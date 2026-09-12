# LATAM FX 2.0 report rollout

## Safety boundary

- Start from the merged 1.x production main and use `codex/2.0-report-foundation`.
- The FX report steps are `continue-on-error`; they must never block dataset generation, Supabase FX sync, the existing market-context email, Git commit, or Netlify deploy.
- Do not add `OPENROUTER_API_KEY` to Netlify or any `VITE_` variable.
- Do not enable automatic publication during the ten-trading-day pilot.
- Never upload `fx-report-run.json` or raw AI output as a public-repository Actions artifact.
- Treat the free model as a constrained editor: it may rank known facts and evidence and select approved context/scenario tags, but code owns every public sentence, number, direction, date, and link.

## Pre-deploy checks

- [ ] `npm ci`, typecheck, lint, unit tests, the 40-fixture offline report evaluation, and production build pass.
- [ ] `supabase test db --local` passes the anon, non-admin, active-admin, revoked-admin, and service-role report cases.
- [ ] `supabase db advisors --local --fail-on error` reports no errors.
- [ ] A no-key report run produces `generationMode=deterministic` and a complete Korean report.
- [ ] Mocked OpenRouter success, timeout, 429, invalid schema, unknown evidence, prompt injection, repetitive selection, and forbidden content are tested.
- [ ] The dashboard, `#report`, locked admin panel, recent-history selection, and mobile layout are checked in a preview.
- [ ] Automatic-mode email inclusion is checked locally without sending mail.

## Production checkpoint

1. Apply `20260912021010_fx_report_storage.sql` and `20260912021458_lock_fx_report_reviews_append_only.sql` only after the database PR is approved.
2. Verify explicit grants and RLS with anon, authenticated non-admin, active admin, and service role.
3. Add GitHub Secret `OPENROUTER_API_KEY`; never record its value in the repository or issue logs.
   Before the production workflow uses it, manually run `FX Report Free-Model Evaluation` with at most five fixtures. Review the actual selected model, hard-gate result, quality score, and latency artifact; the workflow never publishes its output.
4. Merge and deploy the UI while the committed `FX_REPORT_ENABLED` default remains `false`; confirm the five 1.x screens are unchanged.
5. At the pilot-start checkpoint, set repository variables:
   - `FX_REPORT_ENABLED=true`
   - `FX_REPORT_PUBLISH_MODE=review`
   - `FX_REPORT_AI_MODE=optional`
   - `FX_REPORT_AI_MODEL=openrouter/free`
6. Run `Daily Dashboard Email` manually once. Confirm the legacy email still arrives, a private pending run appears in Supabase, and no private run file is uploaded as an Actions artifact.
7. Sign in as an active admin, review the candidate, approve it, and confirm the public dashboard and `#report` show only sanitized content.

## Ten-trading-day pilot log

Record one row per new FX base date. Never store email addresses, API keys, prompts, or raw output in this document.

| Base date | Deterministic generated | Actual AI model | Hard gate | Quality score | AI selected | Review decision | Critical issue |
| --- | --- | --- | --- | --- | --- | --- | --- |

Automatic publication requires ten generated reports, at least nine approvals, zero incorrect figures/directions/evidence leaks, zero privacy issues, and zero 1.x operational failures. AI selection rate is informational only.

The AI candidate is eligible only when the hard gate has no errors and its deterministic quality score is at least 80. A lower score, invalid schema, unavailable free endpoint, timeout, or rate limit always leaves the deterministic report selected.

## Automatic publication

- Change only `FX_REPORT_PUBLISH_MODE` to `automatic` after explicit operational approval.
- A valid AI candidate is published as `ai_enhanced`; every other case publishes `deterministic`.
- The email includes the report only after database publication succeeds in the same workflow run.

## Recovery

1. Set `FX_REPORT_ENABLED=false`, then run `Daily Dashboard Email` manually so the workflow commits the matching UI flag and Netlify returns to the 1.x-only screen set.
2. Leave report tables and audit rows intact; do not roll back by deleting reviewer history.
3. Revert the UI/workflow PR if necessary. Existing 1.x routes and email remain independent.
4. If the free-model policy changes, set `FX_REPORT_AI_MODE=off`. Never switch to a paid model automatically.
