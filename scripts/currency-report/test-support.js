// Test-only factories. Synthetic ledgers are not factual or human publication approval.
import { syntheticCase, syntheticLedger } from './rule-fixtures.js'
import { buildPacket } from './core.js'
import { clpEvidence } from './clp-case.js'
import { WRITING_CONTRACT_VERSION } from './writing-contract.js'
export function comparisonPacket() {
  const baseDate = '2026-09-11'
  const dates = ['2026-08-31', '2026-09-04', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', baseDate]
  return buildPacket({ baseDate, dailyRates: dates.map((date, i) => ({ date, currency: 'CLP', rateType: 'LOCAL_PER_USD', source: 'API', value: 920 + i })) }, 'CLP', baseDate, clpEvidence)
}
export const currentCase = (currency = 'BRL') => syntheticCase(currency)
export function wireDraft(args) {
  const blocks = items => items.map(({ title, text, kind, evidenceIds }) => ({ title, text, kind, evidenceIds }))
  return { title: args.content.title, summary: args.content.summary,
    drivers: blocks(args.content.drivers), implications: blocks(args.content.implications), watch: blocks(args.content.watch),
    ruleLedger: syntheticLedger(args.packet, args.content) }
}
// Synthetic current writer output; not a migration or semantic review of a real draft.
export function writerDraft(args) {
  const draft = wireDraft(args), rows = draft.ruleLedger.claims
  draft.ruleLedger = { version: WRITING_CONTRACT_VERSION,
    claims: [...new Set(rows.map(r => r.target))].map(target => {
      const matches = rows.filter(r => r.target === target), first = matches[0]
      return { target, kind: first.kind, evidenceIds: [...new Set(matches.flatMap(r => r.evidenceIds))],
        mechanismId: first.mechanismId, applicationId: first.applicationId }
    }) }
  return draft
}
export function modelResponse(draft, model) {
  return new Response(JSON.stringify({ model, choices: [{ finish_reason: 'stop',
    message: model === 'nvidia/nemotron-3-ultra-550b-a55b:free'
      ? { tool_calls: [{ function: { name: 'submit_currency_brief', arguments: JSON.stringify(draft) } }] }
      : { content: JSON.stringify(draft) } }] }))
}
