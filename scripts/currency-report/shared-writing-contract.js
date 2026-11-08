// Lossless projection of an already-bound reference/material packet. Hashes are
// integrity checks, not new semantic review, publisher permission or approval.
import {createHash} from 'node:crypto'
import {FX_REPORT_PRIORITY_VERSION,inspectFxPriority} from './fx-report-priority.js'
import {isOfficialSnapshotBackground} from './official-statistic-availability.js'
import {validMarketPeriod,samePeriod} from './news-period.js'
export const SHARED_WRITING_VERSION='shared-reference-writing/1'
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
export const SHARED_REFERENCE_LIMITATION='수치는 대시보드 기준환율입니다. 뉴스는 별도 현지 거래일의 해설이며 이 기준환율 변화의 직접 원인이나 현지 종가를 인증하지 않습니다.'
export function sealSharedPacket(packet) {
 const next=structuredClone(packet)
 delete next.sharedReference.binding
 next.sharedReference.binding=hash(next)
 return next
}
export function assertSharedPacket(packet) {
 const clone=structuredClone(packet),binding=clone?.sharedReference?.binding
 if(clone?.sharedReference)delete clone.sharedReference.binding
 if(packet?.sharedReference?.version!==SHARED_WRITING_VERSION||binding!==hash(clone)
  ||!['BRL','MXN','CLP','COP','PEN','ARS'].includes(packet.currency)
  ||packet.observationAt!==null||packet.sharedReference.referenceRateCausalityEstablished!==false
  ||packet.mechanismApplications?.length!==0||packet.evidence.some(e=>!e.sharedNotes))throw new Error('shared_writer_packet_binding_required')
 const cutoff=packet.sharedReference.materialCutoff
 const period=packet.sharedReference.commentaryPeriod
 if(period&&(!validMarketPeriod(period)||!cutoff||period.end>cutoff.asOf.slice(0,10)
  ||packet.evidence.some(e=>e.sharedNotes.claims.some(c=>['market_observation','attributed_fx_explanation','global_context','countercontext'].includes(c.role)
   &&(!samePeriod(c.marketPeriod,period)||c.sourceSessionDate!==null||e.eventDate!==null)))))throw Error('shared_market_period_mismatch')
 if(cutoff&&(cutoff.version!=='independent-material-cutoff/1'||typeof cutoff.asOf!=='string'||!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(cutoff.asOf)
  ||!Number.isFinite(Date.parse(cutoff.asOf))||packet.baseDate>cutoff.asOf.slice(0,10)
  ||packet.evidence.some(e=>!Number.isFinite(Date.parse(e.publishedAt))&&!isOfficialSnapshotBackground(e,cutoff.asOf)||!Number.isFinite(Date.parse(e.collectedAt))
   ||Date.parse(e.publishedAt)>Date.parse(cutoff.asOf)||Date.parse(e.collectedAt)>Date.parse(cutoff.asOf)
   ||e.eventDate!=null&&e.eventDate>cutoff.asOf.slice(0,10))))throw Error('shared_material_cutoff_required')
 const edition=packet.sharedReference.edition
 if(edition?.kind==='periodic_check'){
  const p=edition.previous
  if(edition.version!=='shared-periodic-check/1'||edition.comparison!=='published_reference_and_explanation'
   ||edition.relation!=='unverified_until_separate_review'||!p?.id||p.currency!==packet.currency||p.origin!=='published_record'
   ||!/^\d{4}-\d{2}-\d{2}$/.test(p.observedDate)||p.observedDate>=packet.observedDate
   ||!Number.isFinite(p.value)||p.value<=0||!Array.isArray(p.explanations)||p.explanations.length>8
   ||!packet.series.some(r=>r.date===p.observedDate&&r.value===p.value))throw Error('published_periodic_anchor_required')
 }else if(edition?.kind==='context_update'){
  if(edition.version!=='shared-context-update/1'||edition.comparison!=='new_evidence_separate_from_reference_price'
   ||edition.priceCauseEstablished!==false)throw Error('context_update_scope_required')
  const p=edition.previous
  if(p!==null&&(!p?.id||p.origin!=='published_record'||p.currency!==packet.currency||!Array.isArray(p.explanations)
   ||p.explanations.length>8||!Number.isFinite(p.value)||p.value<=0||p.observedDate>packet.observedDate))throw Error('context_update_prior_publication_required')
 }else if(edition!==undefined&&JSON.stringify(edition)!==JSON.stringify({version:'initial-reference-check/1',kind:'initial_check',previousReportId:null,
  comparison:'previous_reference_observation_only',noPublishedAnchor:true}))throw Error('initial_check_edition_required')
 return packet.sharedReference
}
export function sealSharedEvidence(evidence) {
 const result=structuredClone(evidence)
 result.sharedNotes.binding=hash(result)
 return result
}
export function projectSharedSource(evidence) {
 const copy=structuredClone(evidence),binding=copy.sharedNotes?.binding
 if(copy.sharedNotes)delete copy.sharedNotes.binding
 const notes=evidence.sharedNotes?.claims
 if(evidence.sharedNotes?.version!==SHARED_WRITING_VERSION||hash(copy)!==binding||!Array.isArray(notes)||!notes.length
  ||notes.some(r=>!r.claimId||!r.passageId||r.evidenceId!==evidence.id||typeof r.text!=='string')
  ||new Set(notes.map(r=>r.claimId)).size!==notes.length)throw new Error('shared_note_projection_binding_required')
 return {version:SHARED_WRITING_VERSION,sourceVersion:evidence.officialStatistic?'registered_numeric_projection':'reviewer_authored_notes',noteHash:binding,
  semanticReview:evidence.officialStatistic?'numeric_integrity_only_not_economic_entailment':'prior_bound_notes_not_new_independent_original_review',passageHash:hash(notes),
  passages:notes.map(r=>({id:r.passageId,kind:r.kind==='source_interpretation'?'reviewer_attributed_view':'reviewer_fact',
   selected:true,text:r.text,materialClaimId:r.claimId,role:r.role,attributions:r.attributions,
   referencePeriod:r.referencePeriod,sourceSessionDate:r.sourceSessionDate,...(r.marketPeriod?{marketPeriod:structuredClone(r.marketPeriod)}:{}),writingContext:structuredClone(r.writingContext??null)}))}
}
export function projectSharedScopes(packet) {
 assertSharedPacket(packet)
 return packet.evidence.map(e=>{
  projectSharedSource(e)
  const notes=e.sharedNotes.claims,first=notes[0]
  if(notes.some(n=>['scope','allowedUse','countercontext','excludedExpansions','coverageGaps','crossSourceClaims'].some(k=>hash(n[k])!==hash(first[k]))))
   throw new Error('shared_source_scope_conflict')
  return {evidenceId:e.id,period:e.period,passageIds:notes.map(r=>r.passageId),scope:structuredClone(first.scope),
   admittedClaims:notes.map(r=>({id:r.passageId,kind:r.kind,text:r.text,passageIds:[r.passageId]})),
   allowedUse:first.allowedUse,countercontext:first.countercontext,excludedExpansions:first.excludedExpansions,
   coverageGaps:first.coverageGaps,crossSourceClaims:first.crossSourceClaims}
 })
}
export function sharedRoleIssues(packet,draft) {
 assertSharedPacket(packet)
 const notes=packet.evidence.flatMap(e=>e.sharedNotes.claims),issues=[]
 for(const row of draft.ruleLedger?.claims??[]){
  const selected=(row.materialClaimIds??[]).map(id=>notes.find(n=>n.claimId===id))
  if(!selected.length||selected.some(n=>!n)||new Set(row.materialClaimIds).size!==selected.length){issues.push(`shared_claim_reference:${row.target}`);continue}
  const ids=[...new Set(selected.map(n=>n.evidenceId))]
  if(ids.length!==row.evidenceIds.length||ids.some(id=>!row.evidenceIds.includes(id)))issues.push(`shared_source_claim_mismatch:${row.target}`)
  if(row.target.startsWith('drivers.')&&selected.some(n=>!['market_observation','attributed_fx_explanation','global_context','countercontext'].includes(n.role)))
   issues.push(`background_used_as_fx_driver:${row.target}`)
  if(row.target.startsWith('drivers.')&&row.target.endsWith('.text')&&!selected.some(n=>n.role==='attributed_fx_explanation'))
   issues.push(`local_explanation_reference_missing:${row.target}`)
  if(row.target.startsWith('implications.')&&selected.some(n=>!['consumer_background','policy_background'].includes(n.role)))
   issues.push(`unreviewed_business_background:${row.target}`)
  if(row.kind==='mechanism'||row.mechanismId||row.applicationId)issues.push(`shared_mechanism_not_approved:${row.target}`)
  if(row.kind==='fact'&&selected.some(n=>n.kind==='source_interpretation'))issues.push(`attributed_view_promoted_to_fact:${row.target}`)
  const [section,index,field]=row.target.split('.'),prose=index===undefined?draft[section]:draft[section]?.[Number(index)]?.[field]
  if(sharedForeignCurrencyIssue(packet.currency,prose,selected))issues.push(`unlinked_foreign_currency:${row.target}`)
 }
 if(packet.sharedReference.fxPriority===FX_REPORT_PRIORITY_VERSION)issues.push(...inspectFxPriority(draft,draft.ruleLedger?.claims,notes).holds)
 return [...new Set(issues)]
}
// Shared by the prose safety check and the exact per-position card check.
// A lexical source link is only a scope guard, never proof of entailment.
export function sharedForeignCurrencyIssue(currency,text,notes) {
 const countries={BRL:/브라질|헤알|\bBRL\b/u,MXN:/멕시코|\bMXN\b/u,CLP:/칠레|\bCLP\b/u,
  COP:/콜롬비아|\bCOP\b/u,PEN:/페루|솔화|\bPEN\b/u,ARS:/아르헨티나|\bARS\b/u}
 return Object.entries(countries).some(([country,pattern])=>country!==currency&&pattern.test(text??'')&&!notes.some(n=>pattern.test(n.text)))
}
export function sharedBackgroundHeader(packet,draft,target) {
 const row=draft.ruleLedger?.claims?.find(r=>r.target===target)
 const all=packet.evidence.flatMap(e=>e.sharedNotes.claims),selected=row?.materialClaimIds?.map(id=>all.find(n=>n.claimId===id))
 return Boolean(selected?.length&&selected.every(n=>n&&['consumer_background','policy_background'].includes(n.role)))
}
// Admission to sentence review, not a semantic verdict. Only bound local
// market notes for the explicit commentary session/period can open this path.
export function sharedMarketHeader(packet,draft,target) {
 const row=draft.ruleLedger?.claims?.find(r=>r.target===target)
 const all=packet.evidence.flatMap(e=>e.sharedNotes.claims),ids=row?.materialClaimIds
 if(!ids?.length||new Set(ids).size!==ids.length)return false
 const selected=ids.map(id=>all.find(n=>n.claimId===id))
 const sources=[...new Set(selected.map(n=>n?.evidenceId))]
 return Boolean(row.evidenceIds?.length===sources.length&&sources.every(id=>row.evidenceIds.includes(id))
  &&selected.every(n=>n&&['market_observation','attributed_fx_explanation','global_context','countercontext'].includes(n.role)
   &&(packet.sharedReference.commentaryPeriod?samePeriod(n.marketPeriod,packet.sharedReference.commentaryPeriod)
    :typeof packet.sharedReference.commentaryDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(packet.sharedReference.commentaryDate)
     &&n.sourceSessionDate===packet.sharedReference.commentaryDate))
  &&selected.some(n=>['market_observation','attributed_fx_explanation'].includes(n.role)))
}
export function sharedOwnedChange(packet) {
 assertSharedPacket(packet)
 if(packet.sharedReference.edition?.kind==='periodic_check')return {title:'전회 발행 기준환율 대비 변화',
  text:'기준환율은 {{spot}}이며, 전회 발행 기준환율은 {{published_previous}}, 전회 대비 누적 변화는 {{published_change}}입니다.',
  kind:'fact',factIds:['spot','published_previous','published_change'],evidenceIds:[]}
 return {title:'대시보드 기준환율과 이전 기준일 대비 변화',
  text:'기준환율은 {{spot}}이며, 이전 기준일 값은 {{previous}}, 두 기준일 사이 변화는 {{day}}입니다.',
  kind:'fact',factIds:['spot','previous','day'],evidenceIds:[]}
}
