// A deterministic, pre-dispatch capacity fallback. Core explanation, its
// contrary evidence and watch context are never trimmed to fit a budget.
import {fingerprint} from './research-harness.js'
export function withoutOptionalBackground(handoff) {
 const c=handoff?.materialConnection
 if(!c?.sections)return null
 const optional=r=>['consumer_background','policy_background'].includes(r.role)
 const rows=Object.values(c.sections).flat(),removed=rows.filter(optional),core=rows.filter(r=>!optional(r))
 // Cross-source dependencies must be resolved explicitly, not broken by a
 // size fallback. The source records and stored handoff remain untouched.
 if(!removed.length||core.some(r=>r.crossSourceClaims?.length))return null
 const next=structuredClone(handoff)
 next.materialConnection.sections=Object.fromEntries(Object.entries(c.sections).map(([key,items])=>[key,items.filter(r=>!optional(r))]))
 next.materialConnection.writingSelection={version:'fx-capacity-selection/1',reason:'optional_background_budget',
  omittedEvidenceIds:[...new Set(removed.map(r=>r.evidenceId))].filter(id=>!core.some(r=>r.evidenceId===id)).sort(),
  omittedClaimIds:removed.map(r=>`${r.evidenceId}:${r.claimId}`).sort(),
  retainedClaimIds:core.map(r=>`${r.evidenceId}:${r.claimId}`).sort(),
  meaning:'optional_material_omitted_before_call_core_and_conditions_preserved_not_evidence_failure'}
 delete next.materialConnection.binding
 next.materialConnection.binding=fingerprint(next.materialConnection)
 return next
}
