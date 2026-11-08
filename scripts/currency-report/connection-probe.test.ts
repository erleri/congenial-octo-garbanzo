import { expect, it } from 'vitest'
import { approvedProbe, assessProbe } from './run-gemini-connection-probe.js'
import { diagnosticStages } from './prepare-gemini-diagnostics.js'
import { paidBody } from './paid-comparison.js'
import { comparisonPacket } from './test-support.js'
import { GEMINI_MODEL, geminiWireSchema } from './run-gemini-clp-trial.js'

it('admits only the authorized short probe and rejects a promoted report stage or increased reservation', () => {
  const body = paidBody(comparisonPacket(), 'openai/gpt-5.4')
  body.model = GEMINI_MODEL
  body.response_format.json_schema.schema = geminiWireSchema(body.response_format.json_schema.schema)
  const stages = diagnosticStages({ body })
  expect(approvedProbe({ stages }).id).toBe('connection')
  const promoted = structuredClone(stages)
  promoted[0].body = promoted[3].body
  expect(() => approvedProbe({ stages: promoted })).toThrow('probe_not_authorized')
  stages[0].reservedUsd = .00431
  expect(() => approvedProbe({ stages })).toThrow('probe_not_authorized')
})
it('requires exact completed probe JSON but never classifies a probe as a report', () => {
  expect(assessProbe({ valid: true, partialText: '{"status":"ok"}' })).toMatchObject({ connectionPassed: true, reportGenerated: false, reportQuality: 'not_evaluated' })
  expect(assessProbe({ valid: false, partialText: '{"status":"ok"}' }).connectionPassed).toBe(false)
  expect(assessProbe({ valid: true, partialText: '{"status":"ok","extra":true}' }).connectionPassed).toBe(false)
})
