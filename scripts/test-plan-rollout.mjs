import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

// Fixed local test container: never accepts a production URL or credentials.
const expand = readFileSync('supabase/migrations/20260909105853_plan_current_expand.sql', 'utf8')
const contract = readFileSync('supabase/migrations/20260911133319_close_business_plan_history_access.sql', 'utf8')
const sql = `begin;
alter table public.business_plan_rates disable trigger sync_business_plan_current_after_insert;
insert into public.business_plan_rates(period_month,plan_type,currency,rate_value,created_at)
values ('2099-02-01','leading','BRL',5,'2099-02-01'),('2099-02-01','leading','BRL',6,'2099-02-02');
alter table public.business_plan_rates enable trigger sync_business_plan_current_after_insert;
${expand}
do $$ begin assert (select rate_value=6 from public.business_plan_current where period_month='2099-02-01' and currency='BRL'), 'backfill latest value'; end $$;
set local role anon;
select count(*) from public.business_plan_rates;
reset role;
${contract}
set local role anon;
select count(*) from public.business_plan_current;
do $$ begin
  begin perform count(*) from public.business_plan_rates; raise exception 'anon history leaked';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into public.business_plan_admins(email,active) values ('rollout-admin@example.test',true);
set local role authenticated;
select set_config('request.jwt.claims','{"email":"reader@example.test"}',true);
do $$ begin
 assert (select count(*)=0 from public.business_plan_rates), 'reader history leaked';
 begin insert into public.business_plan_rates(period_month,plan_type,currency,rate_value,created_by_email)
 values ('2099-02-01','moving','BRL',7,'reader@example.test'); raise exception 'reader inserted';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"email":"rollout-admin@example.test"}',true);
insert into public.business_plan_rates(period_month,plan_type,currency,rate_value,created_by_email,change_set_id)
values ('2099-02-01','moving','BRL',7,'rollout-admin@example.test',gen_random_uuid());
do $$ begin assert (select rate_value=7 from public.business_plan_current where period_month='2099-02-01' and plan_type='moving' and currency='BRL'), 'admin save not visible'; end $$;
reset role;
set local role service_role;
do $$ begin assert has_table_privilege(current_user,'public.fx_daily_rates','INSERT'), 'service sync lost'; end $$;
reset role;
rollback;`
const result = spawnSync('docker', ['exec','-i','supabase_db_latamfx-1x-staging','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' })
if (result.error || result.status !== 0) {
  console.error(result.error?.message ?? result.stderr)
  process.exit(1)
}
console.log('PASS: existing history backfill, compatible reads, access closure, four roles and current-value synchronization; transaction rolled back.')
