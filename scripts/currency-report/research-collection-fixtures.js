// Synthetic offline demonstrations, never production evidence or report inputs.
import { syntheticCase } from './rule-fixtures.js'
import { questionSearchUrl } from './public-research-adapter.js'
import { CHILE_MONTHLY_SOURCES } from './chile-monthly-originals.js'
import { chileConsumptionScopes } from './chile-consumption-scopes.js'

export function researchReplayFixture(kind = 'news') {
  if (!['news', 'official', 'missing'].includes(kind)) throw new Error('unknown_replay_fixture')
  const packet = { ...syntheticCase('CLP').packet, baseDate: '2026-10-15', observedDate: '2026-10-15',
    purpose: 'economic_update', evidence: [], evidenceScopeCards: [] }
  const registry = chileConsumptionScopes()
  const pay = { id: 'pay', period: '2026-08', scope: registry.pay.scope }
  const input = { packet, purpose: 'economic_update', asOf: '2026-10-15T23:00:00Z', topics: ['real_pay','retail'],
    requirements: { economic_release: [pay], economic_scope: [pay] } }
  if (kind === 'official') {
    const responses = CHILE_MONTHLY_SOURCES.flatMap(source => {
      const url = `https://www.ine.gob.cl/docs/default-source${source.path}2026/synthetic-agosto-2026.pdf`
      return [{ url: source.url, body: `<a href="${url}">Agosto de 2026</a>` },
        { url, contentType: 'application/pdf', body: '%PDF-1.4\nSynthetic transport fixture only; not statistics.\n%%EOF' }]
    })
    return { input, scopeProfile: 'clp-consumption', period: '2026-08', responses }
  }
  input.topics = []
  const url = 'https://www.df.cl/synthetic-consumer-source'
  const responses = [
    { url: questionSearchUrl({ currency: 'CLP', baseDate: packet.baseDate, questionId: 'consumer' }),
      contentType: 'application/json', body: JSON.stringify({ articles: kind === 'missing' ? [] : [{ url, title: 'Synthetic consumer fixture', seendate: '20261015T120000Z' }] }) },
    { url, body: `<script type="application/ld+json">${JSON.stringify({ '@type': 'NewsArticle', datePublished: '2026-10-14T12:00:00Z',
      articleBody: 'Synthetic consumer evidence for offline adapter checks only. No real market claim is made.' })}</script>` },
  ]
  return { input, responses }
}
