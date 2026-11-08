import {describe,it,expect} from 'vitest'
import {captureDashboardEmailFrame,buildApprovedEmailPayload,emailEditionDate,emailRecipientKey,normalizeEmailRecipients,publicationReasonForEmail,emailHash} from './delivery-core.js'
import {assertEmailSendEnvironment} from './smtp-transport.js'
import {loadEmailChartDataset} from './frozen-dataset.js'
import {deliverDashboardEmail} from './delivery-worker.js'

const dataset={baseDate:'2026-11-02',fetchedAt:'2026-11-03T00:00:00Z',dailyRates:[
  ...['BRL','MXN','CLP','COP','PEN','ARS'].flatMap((currency,i)=>[
    {currency,rateType:'LOCAL_PER_USD',date:'2026-10-30',year:2026,month:10,value:10+i,source:'API'},
    {currency,rateType:'LOCAL_PER_USD',date:'2026-11-02',year:2026,month:11,value:11+i,source:'API'},
  ]),{currency:'USD',rateType:'KRW',date:'2026-11-02',year:2026,month:11,value:1300}],monthlyRates:[]}
const frame=()=>captureDashboardEmailFrame({dataset,asOf:'2026-11-03T00:15:00Z'})
const report=(extra={})=>({publicId:'MXN-public-1',currency:'MXN',baseDate:'2026-11-02',state:'active',stateVersion:2,
  publishedAt:'2026-11-02T10:00:00Z',approved:true,testOnly:false,historicalReview:false,purpose:'periodic_check',
  title:'승인된 제목 <원문>',summary:'승인된 사실 문장. 출처에 귀속한 승인된 설명 문장.',...extra})

describe('approved dashboard email boundary',()=>{
  it('pins Korea send date, dataset date and exact report version without rewriting approved copy',()=>{
    expect(emailEditionDate('2026-11-02T15:01:00Z')).toBe('2026-11-03')
    const payload=buildApprovedEmailPayload(frame(),{reports:[report()],notices:[]})
    expect(payload.refs).toEqual([{key:'report:MXN-public-1',kind:'report',publicId:'MXN-public-1',currency:'MXN',baseDate:'2026-11-02',stateVersion:2}])
    expect(payload.html).toContain('https://latamforex.netlify.app/?run=MXN-public-1#report/MXN/2026-11-02')
    expect(payload.html).toContain('승인된 제목 &lt;원문&gt;')
    expect(payload.html).toContain(report().summary)
    expect(payload.text).toContain(report().summary)
    expect(payload.html).not.toContain('APPROVED_REPORT_DIGEST')
    expect(payload.text).toContain('BRL/USD 기준환율 11')
  })
  it('excludes drafts, future approvals, historical/test records and malformed identities',()=>{
    const variants=[{state:'pending_review'},{publishedAt:'2026-11-03T01:00:00Z'},{testOnly:true},
      {historicalReview:true},{approved:false},{publicId:'../private'},{baseDate:'2026-02-30'},{revisionKind:'editorial'}]
    const payload=buildApprovedEmailPayload(frame(),{reports:variants.map(extra=>report(extra)),notices:[]})
    expect(payload.refs).toEqual([])
    expect(payload.holds).toHaveLength(variants.length)
    expect(payload.html).not.toContain('승인된 제목')
  })
  it('keeps correction announcements ahead of ordinary digests without exposing the withdrawn manuscript',()=>{
    const payload=buildApprovedEmailPayload(frame(),{reports:[report({currency:'BRL',publicId:'BRL-new',revisionKind:'correction'})],
      notices:[{...report(),publicId:'MXN-old',state:'withdrawn',changedAt:'2026-11-03T00:00:00Z',title:'DO_NOT_COPY_WITHDRAWN_TEXT',summary:'DO_NOT_COPY_WITHDRAWN_TEXT'},
        {...report(),currency:'PEN',publicId:'PEN-corrected',state:'active',noticeKind:'correction',changedAt:'2026-11-03T00:00:00Z'}]})
    expect(payload.html.indexOf('리포트 변경 안내')).toBeLessThan(payload.html.indexOf('새 환율 리포트'))
    expect(payload.html).toContain('정정')
    expect(payload.html).toContain('철회되었습니다')
    expect(payload.html).toContain('정정되었습니다')
    expect(payload.html).not.toContain('DO_NOT_COPY_WITHDRAWN_TEXT')
    expect(payload.refs.map(r=>r.kind)).toEqual(['report','notice','notice'])
  })
  it('uses recorded cumulative direction rather than a headline or daily change',()=>{
    const item=report({purpose:'fx_explanation',title:'급등',cadence:{currency:'MXN',triggers:['cumulative'],cumulativePct:-2.4,thresholdPct:2,direction:'local_currency_stronger'}})
    expect(publicationReasonForEmail(item).kind).toBe('cumulative')
    expect(buildApprovedEmailPayload(frame(),{reports:[item],notices:[]}).html).toContain('누적 변동 · 통화 강세')
    expect(publicationReasonForEmail({...item,cadence:{...item.cadence,direction:'local_currency_weaker'}})).toEqual({kind:'movement'})
  })
  it('uses approved summaries for six currencies and does not guess a one-sentence teaser',()=>{
    const reports=['BRL','MXN','CLP','COP','PEN','ARS'].map(currency=>report({currency,publicId:currency+'-1'}))
    const payload=buildApprovedEmailPayload(frame(),{reports,notices:[]})
    expect(payload.html.split(report().summary)).toHaveLength(7)
    expect(payload.refs).toHaveLength(6)
  })
  it('continues the frozen FX content on a report-only failure',()=>{
    const payload=buildApprovedEmailPayload(frame(),null,{lookupStatus:'unavailable'})
    expect(payload.refs).toEqual([])
    expect(payload.html).toContain('Six-currency KPI summary')
    expect(payload.html).not.toContain('새 환율 리포트')
  })
  it('deduplicates addresses without leaking addresses into delivery identities',()=>{
    expect(normalizeEmailRecipients(['Reader@example.invalid',' reader@example.invalid '])).toEqual(['Reader@example.invalid'])
    expect(emailRecipientKey(' Reader@example.invalid ')).toBe(emailRecipientKey('reader@example.invalid'))
    expect(emailRecipientKey('reader@example.invalid')).toMatch(/^[a-f0-9]{64}$/)
    expect(()=>normalizeEmailRecipients(['reader@example.invalid\r\nBcc:x@y.z'])).toThrow()
  })
  it('keeps actual SMTP inaccessible to a local preview or a plan-mode runner',()=>{
    expect(()=>assertEmailSendEnvironment({})).toThrow('explicit_workflow_email_send_required')
    expect(()=>assertEmailSendEnvironment({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'erleri/congenial-octo-garbanzo',FX_EMAIL_REPORT_MODE:'approved',FX_EMAIL_SEND_APPROVED:'false'})).toThrow()
    expect(()=>assertEmailSendEnvironment({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'other/repository',FX_EMAIL_REPORT_MODE:'approved',FX_EMAIL_SEND_APPROVED:'true'})).toThrow()
    expect(()=>assertEmailSendEnvironment({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'erleri/congenial-octo-garbanzo',FX_EMAIL_REPORT_MODE:'approved',FX_EMAIL_SEND_APPROVED:'true',FX_EMAIL_HOLD:'true'})).toThrow()
  })
  it('uses the captured dataset for chart rendering and refuses a changed snapshot without fetching a replacement',async()=>{
    let loads=0
    const loadCurrent=async()=>{loads++;return dataset}
    const readJson=async(file:string)=>file==='email-compose-context.json'?frame():dataset
    const result=await loadEmailChartDataset({env:{FX_EMAIL_REPORT_MODE:'approved'},readJson,loadCurrent})
    expect(result).toEqual({dataset,frozen:true});expect(loads).toBe(0)
    await expect(loadEmailChartDataset({env:{FX_EMAIL_REPORT_MODE:'shadow'},readJson:async(file:string)=>file==='email-compose-context.json'?frame():{...dataset,fetchedAt:'changed'},loadCurrent})).rejects.toThrow('email_chart_snapshot_changed')
    expect(loads).toBe(0)
    expect((await loadEmailChartDataset({env:{FX_EMAIL_REPORT_MODE:'legacy'},readJson,loadCurrent})).frozen).toBe(false)
    expect(loads).toBe(1)
  })
  it('rejects a chart from another dataset or modified PNG before any ledger write or SMTP attempt',async()=>{
    let calls=0
    const store={stage:async()=>{calls++;throw Error('should not stage')}}
    const chartBase64=Buffer.from('synthetic PNG').toString('base64')
    const snapshot={datasetHash:frame().datasetHash,baseDate:dataset.baseDate,chartHash:emailHash(Buffer.from(chartBase64,'base64'))}
    for(const chartSnapshot of [{...snapshot,datasetHash:'0'.repeat(64)},{...snapshot,chartHash:'0'.repeat(64)},{...snapshot,baseDate:'2026-10-30'}]) {
      const result=await deliverDashboardEmail({frame:frame(),chartBase64,chartSnapshot,recipients:['reader@example.invalid'],store,transport:async()=>{calls++}})
      expect(result.status).toBe('chart_snapshot_mismatch')
    }
    expect(calls).toBe(0)
  })
})
