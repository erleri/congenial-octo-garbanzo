import {expect,it} from 'vitest'
import {runtimeFixture} from './runtime-fixture.js'
import {withoutOptionalBackground} from './runtime-material-selection.js'
import {prepareRuntimeTask,preflightRuntimeReview} from './runtime.js'
import {prepareSharedWriter} from './shared-writer.js'
import {fingerprint} from './research-harness.js'

it('reserves room for the configured prose before a call and omits optional background only when capacity requires it',()=>{
 const f=runtimeFixture('MXN'),h=structuredClone(f.handoff),c=h.materialConnection
 const row=c.sections.consumer_background[0]
 c.sections.consumer_background=Array.from({length:20},(_,i)=>({...row,evidenceId:'background-'+i,text:row.text+String.fromCodePoint(0xac00+i).repeat(200)}))
 delete c.binding;c.binding=fingerprint(c)
 const before=structuredClone(h),full=prepareSharedWriter({handoff:h,purpose:'initial_check'})
 expect(full.status==='request_budget_hold'||preflightRuntimeReview({...f.task,plan:full},{capacity:true}).status==='hold').toBe(true)
 const task=prepareRuntimeTask({...f,handoff:h})
 expect(task.status).toBe('prepared')
 expect(task.plan.packet.sharedReference.writingSelection.omittedEvidenceIds).toHaveLength(20)
 expect(task.plan.packet.evidence.flatMap(e=>e.sharedNotes.claims).some(n=>n.role==='consumer_background')).toBe(false)
 expect(preflightRuntimeReview(task,{capacity:true}).status).toBe('bounded_manuscript_fits')
 expect(task.plan.packet.evidence.flatMap(e=>e.sharedNotes.claims).filter(n=>n.role==='attributed_fx_explanation')).toHaveLength(1)
 expect(h).toEqual(before)
})

it('retains all core conditions and refuses to cut an unresolved cross-source dependency for capacity',()=>{
 const f=runtimeFixture(),before=structuredClone(f.handoff),selected=withoutOptionalBackground(f.handoff)
 expect(selected.materialConnection.sections.attributed_fx_explanation).toEqual(f.handoff.materialConnection.sections.attributed_fx_explanation)
 expect(f.handoff).toEqual(before)
 const dependent=structuredClone(f.handoff);dependent.materialConnection.sections.attributed_fx_explanation[0].crossSourceClaims=[{partner:'news-background'}]
 expect(withoutOptionalBackground(dependent)).toBeNull()
})
