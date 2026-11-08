begin;
select no_plan();
select set_config('runtime.test.public_payload','{"id":"SYNTHETIC-PUBLIC-USE","testOnly":true,"content":{"change":{"title":"합성 변화","text":"공개 권한 검사 대역","kind":"fact","factIds":[],"evidenceIds":[]},"drivers":[],"implications":[],"watch":[]},"facts":[],"series":[],"evidence":[]}',true);
insert into public.currency_report_runs(id,currency,base_date,attempt,rule_version,event_binding,packet,candidate,validation)
values('61000000-0000-0000-0000-000000000001','BRL','2097-01-02',1,'runtime-public-use-synthetic/1','synthetic','{}','{"id":"SYNTHETIC-PUBLIC-USE","testOnly":true}',
 '{"structureValid":true,"contentReview":"passed","criticalErrors":0,"qualityAverage":4,"evidenceScore":4,"sourceUseReview":{"externalModel":"pass","publicDisplay":"unverified"}}');
insert into app_private.currency_report_runtime_jobs(task_key,currency,base_date,stage,request_hash,context,reserved_nano,control_revision,run_id)
values(repeat('a',64),'BRL','2097-01-02','writer',repeat('b',64),'{}',100,1,'61000000-0000-0000-0000-000000000001');
select throws_ok($$insert into public.currency_reports(currency,base_date,run_id,report)
 values('BRL','2097-01-02','61000000-0000-0000-0000-000000000001',current_setting('runtime.test.public_payload')::jsonb)$$,
 '55000','runtime source public-use review required','writer/model-use approval is not public-use approval');
update public.currency_report_runs set validation=validation-'sourceUseReview' where id='61000000-0000-0000-0000-000000000001';
select throws_ok($$insert into public.currency_reports(currency,base_date,run_id,report)
 values('BRL','2097-01-02','61000000-0000-0000-0000-000000000001',current_setting('runtime.test.public_payload')::jsonb)$$,
 '55000','runtime source public-use review required','missing public-use review also blocks a new runtime publication');
update public.currency_report_runs set validation=validation||'{"sourceUseReview":{"externalModel":"pass","publicDisplay":"pass"}}' where id='61000000-0000-0000-0000-000000000001';
select lives_ok($$insert into public.currency_reports(currency,base_date,run_id,report)
 values('BRL','2097-01-02','61000000-0000-0000-0000-000000000001',current_setting('runtime.test.public_payload')::jsonb)$$,
 'an explicit public-use pass satisfies this gate; normal publishing authorization remains separate');
select * from finish();
rollback;
