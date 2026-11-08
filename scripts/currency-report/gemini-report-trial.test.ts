import { expect, it } from 'vitest'
import { diagnosticStages } from './prepare-gemini-diagnostics.js'
import { approvedReportStage } from './run-gemini-report-trial.js'
import { paidBody, fingerprint } from './paid-comparison.js'
import { comparisonPacket } from './test-support.js'
import { GEMINI_MODEL, geminiWireSchema } from './run-gemini-clp-trial.js'

it('binds the one-report authorization to a hashed full-ledger request and the exact output and spending limits', () => {
  const body = paidBody(comparisonPacket(), 'openai/gpt-5.4')
  body.model = GEMINI_MODEL
  // Authorization boundary, not an actual report prompt: the historical .045
  // approval must not expand automatically when new editorial guidance grows.
  body.messages = [{ role: 'system', content: 'Synthetic bounded authorization test only.' }, { role: 'user', content: '{}' }]
  body.response_format.json_schema.schema = geminiWireSchema(body.response_format.json_schema.schema)
  const stages = diagnosticStages({ body })
  expect(approvedReportStage({ stages }).id).toBe('full-ledger')
  const stage = stages[3]
  stage.body.max_tokens = 8193
  stage.requestHash = fingerprint(stage.body)
  expect(() => approvedReportStage({ stages })).toThrow('report_trial_not_authorized')
  stage.body.max_tokens = 8192
  stage.requestHash = fingerprint(stage.body)
  stage.reservedUsd = .04501
  expect(() => approvedReportStage({ stages })).toThrow('report_trial_not_authorized')
})
