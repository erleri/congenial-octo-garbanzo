import { createHash } from 'node:crypto'
import { composeEmailBody, getCurrencyDetails, getUsdKrwAnchor, formatRate } from '../email-template.js'
import { renderEmailReportDigest } from '../email-report-digest.js'

export const EMAIL_FRAME_MARKER = '<!--LATAM_FX_APPROVED_REPORT_DIGEST-->'
export const EMAIL_CHANNEL = 'latamfx-daily'
export const EMAIL_CURRENCIES = ['BRL','MXN','CLP','COP','ARS','PEN']
const names = {BRL:'브라질',MXN:'멕시코',CLP:'칠레',COP:'콜롬비아',ARS:'아르헨티나',PEN:'페루'}
const publicId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
export const emailHash = value => createHash('sha256').update(value).digest('hex')
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')
export function validEmailDate(value) {
  return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value
}
export function emailEditionDate(instant) {
  if(typeof instant!=='string'||!Number.isFinite(Date.parse(instant))) throw Error('email_cutoff_required')
  return new Date(Date.parse(instant)+9*3600000).toISOString().slice(0,10)
}
export function normalizeEmailRecipients(values) {
  if(!Array.isArray(values)) throw Error('email_recipient_list_required')
  const unique = new Map()
  for(const value of values) {
    if(typeof value!=='string') throw Error('invalid_email_recipient')
    const address=value.trim()
    if(address.length>254 || !/^[^@\s<>;,\r\n]+@[^@\s<>;,\r\n]+\.[^@\s<>;,\r\n]+$/.test(address)) throw Error('invalid_email_recipient')
    const canonical=address.toLowerCase()
    if(!unique.has(canonical)) unique.set(canonical,address)
  }
  return [...unique.values()]
}
// This identifier is pseudonymous private data, not an anonymized address.
export const emailRecipientKey = address => emailHash('latamfx:recipient/1:'+normalizeEmailRecipients([address])[0].toLowerCase())
export const emailMessageId = key => {
  if(!/^[a-f0-9]{64}$/.test(key)) throw Error('invalid_email_delivery_identity')
  return `<${key}@latamforex.netlify.app>`
}
export function publicEmailReportLink(currency,date,id) {
  if(!EMAIL_CURRENCIES.includes(currency)||!validEmailDate(date)||!publicId.test(id)) throw Error('invalid_email_report_link')
  return `https://latamforex.netlify.app/?entry=email&run=${encodeURIComponent(id)}#report/${currency}/${date}`
}
export function captureDashboardEmailFrame({dataset,businessPlan=null,asOf=new Date().toISOString(),workflowRunId=null}) {
  if(!validEmailDate(dataset?.baseDate)||dataset.baseDate>emailEditionDate(asOf)) throw Error('invalid_email_dataset_date')
  const {subject,html}=composeEmailBody({dataset,businessPlan,reportDigest:[],digestPlaceholder:true})
  const details=getCurrencyDetails(dataset,businessPlan)
  const anchor=getUsdKrwAnchor(dataset)
  const plainText=[`LATAM FX Daily Brief · 환율 기준일 ${dataset.baseDate}`,'https://latamforex.netlify.app/?entry=email',
    `USD/KRW: ${formatRate(anchor.rate)}`,...details.map(d=>`${d.currency}/USD 기준환율 ${formatRate(d.rate)} · 월평균 ${formatRate(d.mtdAverage)}`)].join('\n')
  return {version:'dashboard-email-frame/1',channel:EMAIL_CHANNEL,editionDate:emailEditionDate(asOf),
    cutoff:asOf,dataDate:dataset.baseDate,datasetHash:emailHash(JSON.stringify(dataset)),subject,html,plainText,
    ...(workflowRunId?{workflowRunId}:{})}
}
export function assertEmailFrame(frame) {
  if(frame?.version!=='dashboard-email-frame/1'||frame.channel!==EMAIL_CHANNEL||!validEmailDate(frame.dataDate)
    ||!validEmailDate(frame.editionDate)||frame.editionDate!==emailEditionDate(frame.cutoff)||frame.dataDate>frame.editionDate
    ||!/^[a-f0-9]{64}$/.test(frame.datasetHash)||typeof frame.html!=='string'
    ||frame.html.split(EMAIL_FRAME_MARKER).length!==2||typeof frame.plainText!=='string'
    ||typeof frame.subject!=='string'||/[\r\n]/.test(frame.subject)
    ||frame.workflowRunId!==undefined&&!/^[1-9][0-9]{0,30}$/.test(frame.workflowRunId)) throw Error('invalid_dashboard_email_frame')
  return frame
}
export function publicationReasonForEmail(report) {
  if(report.revisionKind==='correction') return {kind:'correction'}
  const c=report.cadence
  if(c && c.currency===report.currency && Array.isArray(c.triggers)) {
    if(c.triggers.includes('cumulative') && Number.isFinite(c.cumulativePct) && Number.isFinite(c.thresholdPct)
      && c.thresholdPct>0 && Math.abs(c.cumulativePct)>=c.thresholdPct
      && c.direction===(c.cumulativePct>0?'local_currency_weaker':'local_currency_stronger')) {
      return {kind:'cumulative',direction:c.direction,cumulativePct:c.cumulativePct}
    }
    if(c.triggers.includes('bootstrap')) return {kind:'bootstrap'}
    if(c.triggers.includes('periodic')) return {kind:'periodic'}
    if(c.triggers.includes('event_research')) return {kind:'event'}
  }
  if(report.purpose==='periodic_check'||report.reportKind==='periodic') return {kind:'periodic'}
  // Missing cumulative metadata cannot be filled using the current daily quote.
  return {kind:'movement'}
}
function sourceIdentity(item,frame) {
  return EMAIL_CURRENCIES.includes(item?.currency)&&validEmailDate(item.baseDate)&&item.baseDate<=frame.dataDate
    &&publicId.test(item.publicId)&&Number.isSafeInteger(item.stateVersion)&&item.stateVersion>0
    &&typeof item.publishedAt==='string'&&Number.isFinite(Date.parse(item.publishedAt))
    &&Date.parse(item.publishedAt)<=Date.parse(frame.cutoff)&&item.testOnly===false&&item.historicalReview===false
}
export function buildApprovedEmailPayload(frame,sources,{lookupStatus='ready'}={}) {
  assertEmailFrame(frame)
  if(!['ready','unavailable','changed_before_send'].includes(lookupStatus)) throw Error('invalid_email_lookup_status')
  if(sources!=null&&(!Array.isArray(sources.reports)||!Array.isArray(sources.notices))) throw Error('invalid_email_source_projection')
  const reports=[],notices=[],refs=[],holds=[]
  const seen=new Set()
  for(const item of sources?.reports??[]) {
    if(!sourceIdentity(item,frame)||item.state!=='active'||item.approved!==true
      ||typeof item.title!=='string'||!item.title.trim()||typeof item.summary!=='string'||!item.summary.trim()
      ||item.revisionKind==='editorial'||seen.has(item.currency)) {holds.push('invalid_or_duplicate_public_report');continue}
    seen.add(item.currency)
    reports.push({currency:item.currency,baseDate:item.baseDate,title:item.title,summary:item.summary,
      // Only a separately approved public field may shorten the approved summary.
      // Existing reports keep the full approved summary, never a guessed excerpt.
      shortSummary:typeof item.emailSummary==='string'&&item.emailSummary.trim()?item.emailSummary:item.summary,
      href:publicEmailReportLink(item.currency,item.baseDate,item.publicId),publicationReason:publicationReasonForEmail(item)})
    refs.push({key:'report:'+item.publicId,kind:'report',publicId:item.publicId,currency:item.currency,
      baseDate:item.baseDate,stateVersion:item.stateVersion})
    if(reports.length===6) break
  }
  for(const item of sources?.notices??[]) {
    if(!sourceIdentity(item,frame)||!(['withdrawn','superseded'].includes(item.state)
      ||item.state==='active'&&item.noticeKind==='correction'&&item.approved===true)
      ||typeof item.changedAt!=='string'||!Number.isFinite(Date.parse(item.changedAt))
      ||Date.parse(item.changedAt)>Date.parse(frame.cutoff)) {holds.push('invalid_public_notice');continue}
    if(reports.some(r=>r.currency===item.currency&&r.baseDate===item.baseDate)) continue
    const key=`notice:${item.publicId}:${item.stateVersion}`
    if(refs.some(r=>r.key===key)) continue
    notices.push({currency:item.currency,baseDate:item.baseDate,state:item.state,noticeKind:item.noticeKind,
      href:publicEmailReportLink(item.currency,item.baseDate,item.publicId)})
    refs.push({key,kind:'notice',publicId:item.publicId,currency:item.currency,baseDate:item.baseDate,stateVersion:item.stateVersion})
    if(notices.length===6) break
  }
  const noticeHtml=notices.length?`<table role="presentation" data-email-section="notices" style="width:100%;border-collapse:collapse;margin:0 0 20px;border:1px solid #d4dce8;background:#f7f9fc;"><tr><td style="padding:12px 14px;"><strong style="font-size:14px;color:#253f61;">리포트 변경 안내</strong>${notices.map(n=>`<p style="margin:8px 0 0;font-size:13px;line-height:1.7;color:#425166;">${names[n.currency]} · ${escape(n.baseDate)} 리포트가 ${n.noticeKind==='correction'?'정정되었습니다.':n.state==='withdrawn'?'철회되었습니다.':'새 판본으로 교체되었습니다.'} <a href="${escape(n.href)}" style="color:#24598c;">상태 확인 →</a></p>`).join('')}</td></tr></table>`:''
  const digest=noticeHtml+renderEmailReportDigest(reports)
  const reportText=reports.map(r=>`${names[r.currency]} ${r.currency} · ${r.baseDate}\n${r.title}\n${r.summary}\n${r.href}`).join('\n\n')
  const noticeText=notices.map(n=>`${names[n.currency]} ${n.baseDate} 리포트 ${n.noticeKind==='correction'?'정정':n.state==='withdrawn'?'철회':'교체'}: ${n.href}`).join('\n')
  const payload={version:'dashboard-email-payload/1',subject:frame.subject,
    html:frame.html.replace(EMAIL_FRAME_MARKER,digest),
    text:[frame.plainText,noticeText,reportText].filter(Boolean).join('\n\n'),refs,lookupStatus,holds}
  if(/sk-or-v1-|sb_secret_|-----BEGIN .*PRIVATE KEY|serializedRuntime|sourceContext/.test(JSON.stringify(payload))) throw Error('private_email_content_rejected')
  return payload
}
