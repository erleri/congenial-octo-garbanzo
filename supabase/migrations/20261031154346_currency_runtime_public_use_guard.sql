-- New runtime drafts only. Historical publications are not withdrawn/regraded.
-- Invoker runs inside the already authorized publishing transaction.
create function app_private.guard_currency_runtime_public_use() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v jsonb;
begin
 if exists(select 1 from app_private.currency_report_runtime_jobs where run_id=new.run_id) then
  select validation into v from public.currency_report_runs where id=new.run_id;
  if v->'sourceUseReview'->>'publicDisplay' is distinct from 'pass' then
   raise exception 'runtime source public-use review required' using errcode='55000';
  end if;
 end if;
 return new;
end;
$$;
revoke all on function app_private.guard_currency_runtime_public_use() from public,anon,authenticated,service_role;
create trigger currency_runtime_public_use_guard
before insert or update of run_id on public.currency_reports
for each row execute function app_private.guard_currency_runtime_public_use();
