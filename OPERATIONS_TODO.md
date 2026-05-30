# Operations TODO

This checklist tracks the remaining production setup needed for business plan rates.

## Supabase Business Plan Rates

- [ ] Run `supabase/migrations/20260504120000_business_plan_rates.sql` in the Supabase SQL Editor.
- [ ] Add each editor email to `public.business_plan_admins` with `active = true`.
- [ ] Confirm `public.business_plan_rates` can be read by anonymous and authenticated users.
- [ ] Confirm only active `business_plan_admins` can insert business plan rates.

## Environment Variables

- [ ] Add `VITE_SUPABASE_URL` to Netlify.
- [ ] Add `VITE_SUPABASE_ANON_KEY` to Netlify.
- [ ] Confirm the browser app never receives `service_role`, `secret key`, or `sb_secret_...` values.

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
