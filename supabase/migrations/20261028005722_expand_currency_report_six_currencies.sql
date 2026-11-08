-- Extend the existing report contract; no grants, RLS, reviews or content change.
begin;
alter table public.currency_report_runs drop constraint currency_report_runs_currency_check;
alter table public.currency_report_runs add constraint currency_report_runs_currency_check
  check (currency in ('BRL','MXN','CLP','COP','PEN','ARS'));
alter table public.currency_reports drop constraint currency_reports_currency_check;
alter table public.currency_reports add constraint currency_reports_currency_check
  check (currency in ('BRL','MXN','CLP','COP','PEN','ARS'));
commit;
