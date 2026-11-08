begin;
set local search_path=public,extensions,pg_catalog;
select no_plan();
select ok(not has_table_privilege('anon','app_private.currency_report_terminal_cost_escrows','SELECT'),'escrow is not public');
select ok(not has_function_privilege('authenticated','public.escrow_currency_report_terminal_failure(uuid,text)','EXECUTE'),'normal login cannot fund failed calls');
insert into app_private.currency_report_runtime_jobs(id,task_key,currency,base_date,stage,state,request_hash,context,reserved_nano,actual_nano,cost_state,control_revision,response,response_id)
values('a1000000-0000-0000-0000-000000000001',repeat('1',64),'COP','2097-01-01','writer','received',repeat('b',64),'{}',100000000,0,'confirmed',1,'{"valid":true}','gen-synthetic-parent');
insert into app_private.currency_report_runtime_jobs(id,task_key,currency,base_date,stage,parent_id,state,request_hash,context,reserved_nano,cost_state,control_revision,response,response_id)
values('a1000000-0000-0000-0000-000000000002',repeat('2',64),'COP','2097-01-01','reviewer','a1000000-0000-0000-0000-000000000001','received',repeat('b',64),'{}',100000000,'unknown',1,
 '{"valid":false,"partialText":"","usage":null,"providerError":{"code":429},"errors":["provider_stream_error"]}','gen-synthetic-429');
select ok(not public.currency_report_terminal_cost_escrow('a1000000-0000-0000-0000-000000000002'),'unfunded terminal response is not implicitly safe');
select throws_ok($$insert into app_private.currency_report_runtime_jobs(task_key,currency,base_date,stage,parent_id,request_hash,context,reserved_nano,control_revision)
 values(repeat('3',64),'COP','2097-01-01','reviewer','a1000000-0000-0000-0000-000000000001',repeat('b',64),
 '{"retryOf":"a1000000-0000-0000-0000-000000000002","retryAttempt":1,"retryRoot":"2222222222222222222222222222222222222222222222222222222222222222"}',100000000,1)$$,
 '55000','bounded terminal retry with funded prior reservation required','unknown cost cannot be retried without full funding');
select ok((public.escrow_currency_report_terminal_failure('a1000000-0000-0000-0000-000000000002','synthetic-budget-28')->>'escrowed')::boolean,'explicit service action reserves full failed cost');
select is((select cost_state from app_private.currency_report_runtime_jobs where id='a1000000-0000-0000-0000-000000000002'),'unknown','escrow never calls cost confirmed');
select is((select actual_nano from app_private.currency_report_runtime_jobs where id='a1000000-0000-0000-0000-000000000002'),null::bigint,'escrow never invents zero spending');
select is((select reserved_nano from app_private.currency_report_terminal_cost_escrows where job_id='a1000000-0000-0000-0000-000000000002'),100000000::bigint,'entire prior reservation remains funded');
insert into app_private.currency_report_runtime_jobs(id,task_key,currency,base_date,stage,parent_id,state,request_hash,context,reserved_nano,cost_state,control_revision,response,response_id)
values('a1000000-0000-0000-0000-000000000003',repeat('3',64),'COP','2097-01-01','reviewer','a1000000-0000-0000-0000-000000000001','received',repeat('b',64),
 '{"retryOf":"a1000000-0000-0000-0000-000000000002","retryAttempt":1,"retryRoot":"2222222222222222222222222222222222222222222222222222222222222222"}',100000000,'unknown',1,
 '{"valid":false,"partialText":"","usage":null,"providerError":{"code":429},"errors":["provider_stream_error"]}','gen-synthetic-429-retry');
select is((select count(*) from app_private.currency_report_runtime_jobs where parent_id='a1000000-0000-0000-0000-000000000001'),2::bigint,'reviewer retry preserves original failed job alongside the new attempt');
select public.escrow_currency_report_terminal_failure('a1000000-0000-0000-0000-000000000003','synthetic-budget-28');
select throws_ok($$insert into app_private.currency_report_runtime_jobs(task_key,currency,base_date,stage,parent_id,request_hash,context,reserved_nano,control_revision)
 values(repeat('4',64),'COP','2097-01-01','reviewer','a1000000-0000-0000-0000-000000000001',repeat('c',64),
 '{"retryOf":"a1000000-0000-0000-0000-000000000003","retryAttempt":2,"retryRoot":"2222222222222222222222222222222222222222222222222222222222222222"}',100000000,1)$$,
 '55000','bounded terminal retry with funded prior reservation required','retry cannot silently change the request');
select throws_ok($$insert into app_private.currency_report_runtime_jobs(task_key,currency,base_date,stage,parent_id,request_hash,context,reserved_nano,control_revision)
 values(repeat('4',64),'COP','2097-01-01','reviewer','a1000000-0000-0000-0000-000000000001',repeat('b',64),
 '{"retryOf":"a1000000-0000-0000-0000-000000000003","retryAttempt":3,"retryRoot":"2222222222222222222222222222222222222222222222222222222222222222"}',100000000,1)$$,
 '55000','bounded terminal retry with funded prior reservation required','retry cannot exceed two additional attempts');
insert into app_private.currency_report_runtime_jobs(id,task_key,currency,base_date,stage,state,request_hash,context,reserved_nano,cost_state,control_revision,response,response_id)
values('a1000000-0000-0000-0000-000000000004',repeat('4',64),'COP','2097-01-01','writer','calling',repeat('b',64),'{}',100000000,'unknown',1,
 '{"valid":false,"partialText":"","usage":null,"providerError":{"code":429}}','gen-synthetic-live');
select throws_ok($$select public.escrow_currency_report_terminal_failure('a1000000-0000-0000-0000-000000000004','synthetic-budget-28')$$,
 '55000','terminal rejection and explicit full reservation required','live/uncertain request cannot be escrowed to allow a second call');
update app_private.currency_report_runtime_jobs set state='received',response=jsonb_set(response,'{partialText}','"partial response"') where id='a1000000-0000-0000-0000-000000000004';
select throws_ok($$select public.escrow_currency_report_terminal_failure('a1000000-0000-0000-0000-000000000004','synthetic-budget-28')$$,
 '55000','terminal rejection and explicit full reservation required','partial-output failure cannot masquerade as a pre-generation rejection');
select is((select sum(case when cost_state='confirmed' then actual_nano else reserved_nano end) from app_private.currency_report_runtime_jobs
 where id in ('a1000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000003')),200000000::numeric,'two unknown failed calls consume two full reservations');
select * from finish();
rollback;
