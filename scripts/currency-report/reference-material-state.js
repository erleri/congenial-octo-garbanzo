// Re-evaluate a selected claim projection; historical approvals are not inputs.
export function referenceMaterialHolds({sections,held,priceHeld,priorHolds=[]}) {
 const current=Object.values(sections).flat(),holds=priorHolds.filter(h=>
  !['selected_session_market_observation_missing','selected_session_attributed_fx_explanation_missing',
   'shared_reference_price_held','selected_material_holds_require_resolution'].includes(h)
  &&!h.startsWith('external_source_use_pending:')&&!h.startsWith('cross_source_dependency_unavailable:'))
 if(!sections.market_observation.length)holds.push('selected_session_market_observation_missing')
 if(!sections.attributed_fx_explanation.length)holds.push('selected_session_attributed_fx_explanation_missing')
 for(const item of current)if(item.sourceUses.external_model.status!=='allowed')holds.push(`external_source_use_pending:${item.evidenceId}`)
 const currentIds=new Set(current.map(item=>item.evidenceId))
 for(const item of current)if(item.crossSourceClaims.some(c=>c.requiredEvidenceIds.some(id=>!currentIds.has(id))))
  holds.push(`cross_source_dependency_unavailable:${item.evidenceId}`)
 if(priceHeld)holds.push('shared_reference_price_held')
 if(held.length)holds.push('selected_material_holds_require_resolution')
 return [...new Set(holds)]
}
