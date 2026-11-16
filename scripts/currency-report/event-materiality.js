import {fingerprint} from './research-harness.js'

export const EVENT_RULE='report-event-materiality/1'

export function reportPurpose(triggers) {
 if(triggers.includes('cumulative'))return 'market'
 if(triggers.includes('bootstrap'))return 'initial'
 if(triggers.includes('periodic'))return 'periodic'
 return 'policy'
}

export function latestExplanation(publications,currency,asOf) {
 return publications.filter(p=>p.currency===currency&&p.state==='published'&&p.approved&&!p.withdrawn&&p.report
  &&Date.parse(p.publishedAt)<=Date.parse(asOf)).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)||a.id.localeCompare(b.id))[0]
}

// Only public editorial text is used as a comparator. Price anchors have a different purpose.
export function eventBaseline(publication) {
 if(!publication?.report?.content)return null
 const {summary,drivers=[],implications=[]}=publication.report.content
 const explanations=[summary,...drivers.map(c=>c.text),...implications.map(c=>c.text)].filter(t=>typeof t==='string'&&t.trim())
 if(!explanations.length)return null
 return {version:EVENT_RULE,reportId:publication.id,currency:publication.currency,publishedAt:publication.publishedAt,explanations}
}

export function assessEventChange(baseline,decisions,evidence) {
 if(!baseline)return {status:'event_evidence_wait'}
 const sources=evidence.filter(e=>e.sharedNotes.claims.some(c=>c.role==='attributed_fx_explanation'))
 let repeated=0
 for(const source of sources){
  const proof=decisions.find(d=>d.evidenceId===source.id&&d.baselineHash===fingerprint(baseline))
  if(!proof)continue
  if(proof.verdict==='repeat'){repeated++;continue}
  if(!['new_event','changed_explanation'].includes(proof.verdict))continue
  if(!source.sharedNotes.claims.some(c=>c.role==='attributed_fx_explanation'&&c.text===proof.supportingText))continue
  return {status:'material_change',change:{reason:proof.reason,evidenceId:source.id,previousReportId:baseline.reportId}}
 }
 return {status:sources.length&&repeated===sources.length?'event_explanation_unchanged':'event_evidence_wait'}
}
