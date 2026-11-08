// Forensic local display ONLY. Never repairs a ledger, accepts a candidate,
// changes the full generation verdict, or supplies publication approval.
import Ajv from 'ajv'
import { draftSchemaForPacket, assembleReportContent } from './openrouter.js'
import { hasDirectionalText, validateContent } from './core.js'
import { fingerprint } from './paid-comparison.js'

export function inspectRejectedDraft(packet, draft) {
  const validate = new Ajv({ allErrors: true }).compile(draftSchemaForPacket(packet, true, false))
  if (validate(draft)) throw new Error('use_normal_candidate_path')
  const failures = structuredClone(validate.errors ?? [])
  // Very narrow allowance for viewing this returned text: only ledger target
  // formatting failed. ALL prose shape/length/kind/reference checks still apply.
  if (!failures.length || !failures.every(e => e.keyword === 'pattern' && /^\.ruleLedger\.claims\[\d+\]\.target$/.test(e.dataPath)))
    throw new Error('unsafe_rejected_draft_display')
  if (hasDirectionalText(`${draft.title} ${draft.summary}`)) throw new Error('unverified_header_direction')
  const content = assembleReportContent(packet, draft), displaySafety = validateContent(content, packet)
  if (!displaySafety.valid) throw new Error('unsafe_rejected_draft_display')
  return { contentForInspection: content, displaySafety, originalSchemaFailures: failures,
    originalDraftHash: fingerprint(draft), status: 'rejected', inspectionOnly: true,
    candidateAccepted: false, publicationApproved: false }
}
