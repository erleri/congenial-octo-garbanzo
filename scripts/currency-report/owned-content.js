import { selectMechanisms } from './rules.js'
import { reviewSentences } from './report-text.js'
import { periodicPlan } from './periodic-check.js'

export const ASSEMBLY_VERSION = 'currency-assembly/1'
function usdApplication(packet) {
  const { selected, checks } = selectMechanisms(packet)
  if (checks.length) throw new Error('invalid_mechanism_applications')
  return selected.find(a => a.mechanismId === 'usd-payment-conversion' &&
    a.conditions[0].basis?.type === 'facts' && a.conditions[1].basis?.type === 'conditional')
}
export function ownedImplications(packet) {
  if (periodicPlan(packet)) return []
  const application = usdApplication(packet)
  if (!application) return []
  return [{ title: '같은 달러 결제대금의 현지통화 환산',
    text: '같은 달러 결제금액을 헤지하지 않고 비교한다면, 현지통화 환산액은 달러당 현지통화 환율에 비례합니다. 헤지·선결제·고정 계약 환율이 적용된 결제에는 이 비교를 그대로 적용할 수 없습니다.',
    kind: 'mechanism', factIds: [...application.conditions[0].basis.factIds], evidenceIds: [] }]
}

// These rows are code-owned provenance, not model or human content approval.
export function assembleLedger(packet, modelLedger, content) {
  if(packet.fxWritingBackground||packet.sharedReference)return structuredClone(modelLedger)
  const application = usdApplication(packet)
  const claims = content.implications.flatMap((block, i) => ['title', 'text'].flatMap(field =>
    reviewSentences(block[field]).map(quote => ({
      target: `implications.${i}.${field}`, quote: quote.trim(), kind: 'mechanism',
      factIds: [...block.factIds], evidenceIds: [], mechanismId: application.mechanismId, applicationId: application.applicationId,
      eventKey: '', pathwayKey: 'conditional-usd-payment-conversion', newInformation: '',
      transmission: '', currencyConnection: '', watchPurpose: '',
    }))))
  return { ...structuredClone(modelLedger),
    // Invalid/missing model ledgers are never repaired by injecting code rows.
    claims: Array.isArray(modelLedger?.claims) ? [...modelLedger.claims, ...claims] : undefined }
}

export function codeOwnedTargets(packet, content) {
  if(packet.fxWritingBackground||packet.sharedReference)return []
  const expected = ownedImplications(packet)
  if (JSON.stringify(content.implications) !== JSON.stringify(expected)) return []
  return expected.flatMap((_, i) => [`implications.${i}.title`, `implications.${i}.text`])
}
