import { describe, expect, it } from 'vitest'
import { blindOrder, buildBlindReview, selectEvaluationDates } from './evaluate-openrouter-models.js'

const ultra = 'nvidia/nemotron-3-ultra-550b-a55b:free'
const superModel = 'nvidia/nemotron-3-super-120b-a12b:free'

describe('OpenRouter model evaluation harness', () => {
  it('selects only recent observed BRL business dates and clamps the requested range', () => {
    const dataset = {
      baseDate: '2026-09-12',
      dailyRates: [
        { currency: 'BRL', rateType: 'LOCAL_PER_USD', date: '2026-09-08', source: 'API', imputationMethod: 'NONE' },
        { currency: 'BRL', rateType: 'LOCAL_PER_USD', date: '2026-09-09', source: 'IMPUTED', imputationMethod: 'PREVIOUS' },
        { currency: 'BRL', rateType: 'LOCAL_PER_USD', date: '2026-09-10', source: 'API', imputationMethod: 'NONE' },
        { currency: 'BRL', rateType: 'LOCAL_PER_USD', date: '2026-09-11', source: 'API', imputationMethod: 'NONE' },
        { currency: 'MXN', rateType: 'LOCAL_PER_USD', date: '2026-09-12', source: 'API', imputationMethod: 'NONE' },
      ],
    }
    expect(selectEvaluationDates(dataset, 2)).toEqual(['2026-09-10', '2026-09-11'])
    expect(selectEvaluationDates(dataset, 0)).toEqual(['2026-09-11'])
  })

  it('uses a stable alternating blind order', () => {
    const models = [ultra, superModel]
    expect(blindOrder('2026-09-10', models)).toEqual(blindOrder('2026-09-10', models))
    expect(blindOrder('2026-09-10', models)).not.toEqual(blindOrder('2026-09-11', models))
  })

  it('keeps model identities out of the blind review while recording a separate mapping', () => {
    const results = [ultra, superModel].map((model) => ({
      baseDate: '2026-09-11', requestedModel: model, actualModel: model, ok: false, errorCode: 'test_failure',
    }))
    const output = buildBlindReview(results, [ultra, superModel])
    expect(output.markdown).toContain('후보 A')
    expect(output.markdown).not.toContain(ultra)
    expect(output.markdown).not.toContain(superModel)
    expect(output.mapping).toHaveLength(2)
  })
})

