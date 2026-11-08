import { expect, it } from 'vitest'
import { diagnosticStages, diagnosticPlan } from './prepare-gemini-diagnostics.js'
import { comparisonPacket } from './test-support.js'
import { paidBody } from './paid-comparison.js'
import { GEMINI_MODEL, GEMINI_PRICE, geminiWireSchema } from './run-gemini-clp-trial.js'

it('isolates short protocol probes from full evidence and ledger without mutating the historical contract', () => {
  const body = paidBody(comparisonPacket(), 'openai/gpt-5.4')
  body.model = GEMINI_MODEL
  body.response_format.json_schema.schema = geminiWireSchema(body.response_format.json_schema.schema)
  const before = structuredClone(body)
  const stages = diagnosticStages({ body })
  expect(body).toEqual(before)
  expect(stages.map(s => s.id)).toEqual(['connection', 'structure', 'evidence', 'full-ledger'])
  expect(stages.map(s => s.body.max_tokens)).toEqual([256, 2048, 4096, 8192])
  expect(stages[0].body.messages).not.toEqual(body.messages)
  expect(stages[2].body.messages[1]).toEqual(body.messages[1])
  expect(stages[3].body.messages).toEqual(body.messages)
  expect(stages[1].body.response_format.json_schema.schema.required).not.toContain('ruleLedger')
  expect(stages[3].body.response_format.json_schema.schema).toEqual(body.response_format.json_schema.schema)
  for (const s of stages) {
    expect(s).toMatchObject({ publishable: false, requiresNewApproval: true, maxCalls: 1, retries: 0 })
    expect(s.reservedUsd).toBeGreaterThanOrEqual((s.inputTokensUpperBound * GEMINI_PRICE.prompt + s.body.max_tokens * GEMINI_PRICE.completion) / 1e6)
  }
})

it('refuses altered historical inputs even for an offline diagnostic plan', () => {
  expect(() => diagnosticPlan({ inputHash: 'unapproved', body: {}, packet: {} })).toThrow('approved_input_changed')
})
