# Operations TODO

This checklist tracks the remaining production setup needed for business plan rates.

## Verified on 2026-05-30

- GitHub `main` is deployed on Netlify with build commit `ee404d2`.
- Production site responds at `https://latamforex.netlify.app/`.
- Production `public/data.json` reports `baseDate = 2026-05-30`.
- The latest checked `Daily Dashboard Email` run completed successfully, including API secret validation, market context creation, email composition, mailing-list validation, send, and artifact upload. That run used an older commit, so the new hybrid market context still needs the next run or a deliberate manual run to be confirmed in production email.
- Supabase publishable config is present in the production bundle, and `business_plan_rates` can be read through the public REST API.
- No `service_role`, `sb_secret_...`, or literal `secret key` value pattern was found in the production bundle.

## Local Verification Notes

- Use `npm.cmd run dev:local` from a normal local CMD/PowerShell window when the Codex shell cannot keep the Vite server alive.
- Use `npm.cmd run build:local` followed by `npm.cmd run preview:local` when checking static preview behavior.
- Keep the dashboard header lightweight: show only factual context such as base date and active averaging period.

## Supabase Business Plan Rates

- [x] Run `supabase/migrations/20260504120000_business_plan_rates.sql` in the Supabase SQL Editor.
- [ ] Add each editor email to `public.business_plan_admins` with `active = true`.
- [ ] Confirm `public.business_plan_rates` can be read by anonymous and authenticated users. Anonymous read is verified; authenticated read still needs an admin/non-admin session check.
- [ ] Confirm only active `business_plan_admins` can insert business plan rates.

## Environment Variables

- [x] Add `VITE_SUPABASE_URL` to Netlify.
- [x] Add `VITE_SUPABASE_ANON_KEY` to Netlify.
- [x] Confirm the browser app never receives `service_role`, `secret key`, or `sb_secret_...` values.

## Auth Redirect URLs

- [ ] Add `https://latamforex.netlify.app` to Supabase Auth redirect URLs.
- [ ] Add `http://127.0.0.1:4173` to Supabase Auth redirect URLs for local verification.
- [ ] Add `http://localhost:4173` if local testing uses `localhost` instead of `127.0.0.1`.

## Production Verification

- [ ] Open the production site and confirm the plan panel shows `운영 저장값 확인됨` when Supabase is configured.
- [ ] Verify a non-admin or signed-out user sees the operational values as read-only.
- [ ] Request a login link from the plan modal and confirm the redirect returns to the app.
- [ ] Sign in with an admin email and confirm the save button becomes enabled.
- [ ] Save a small test change and confirm the success message says Supabase re-read verification succeeded.
- [ ] Confirm `마지막 저장`, `저장 주체`, and `마지막 검증` update after saving.
- [ ] Reopen the production site in a fresh browser session and confirm the saved values are still loaded from Supabase.

## Failure Checks

- [ ] Temporarily test without Supabase env vars in a local build and confirm the panel shows `설정 필요` or `로컬 임시값`.
- [ ] Confirm remote load failure does not present cached values as operational values.
- [ ] Confirm insert success plus re-read failure shows a warning, not a success message.

## Daily No-Cost Improvement Checks

- [ ] Confirm the dashboard header stays factual and shows only the base date and active averaging period.
- [ ] Confirm the generated email still uses the latest no-cost market context and chart notes after the next scheduled GitHub Actions run.
