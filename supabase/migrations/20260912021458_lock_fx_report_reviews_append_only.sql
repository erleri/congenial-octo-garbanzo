-- Supabase grants service_role broad privileges on newly created tables by
-- default. Keep report reviews append-only even for automation credentials.
revoke all on table public.fx_report_reviews from service_role;
grant select, insert on table public.fx_report_reviews to service_role;

