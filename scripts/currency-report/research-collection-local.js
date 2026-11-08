// Offline-only CLI. Does not load env or write originals/reports/approvals.
import fs from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { replayResearchCollection } from './research-collection.js'
import { researchReplayFixture } from './research-collection-fixtures.js'

try {
  const { values } = parseArgs({ options: { scenario: { type: 'string' }, input: { type: 'string' } }, strict: true })
  if (!!values.scenario === !!values.input) throw new Error('one_replay_source_required')
  let replay
  if (values.scenario) replay = researchReplayFixture(values.scenario)
  else {
    const stat = await fs.stat(values.input)
    if (!stat.isFile() || stat.size > 5_000_000 || !values.input.endsWith('.json')) throw new Error('invalid_replay_file')
    replay = JSON.parse(await fs.readFile(values.input, 'utf8'))
  }
  const result = await replayResearchCollection(replay)
  // Print status only; private originals, arbitrary URLs and inputs stay out of logs.
  console.log(JSON.stringify({ mode: result.mode, scenario: values.scenario ?? 'saved_replay',
    collectionId: result.collectionId, planId: result.plan.planId, status: result.status,
    outcomes: result.outcomes.map(o => ({ needId: o.needId, required: o.required, status: o.status,
      reason: o.reason, originalCount: o.originalIds.length, collectionIssues: o.collectionIssues })),
    simulatedRequests: result.simulatedRequests, simulatedBytes: result.simulatedBytes,
    networkCalls: result.networkCalls, modelCalls: result.modelCalls, apiCostUsd: result.apiCostUsd,
    writingEligibility: result.writingEligibility, publicationApproved: result.publicationApproved }, null, 2))
} catch {
  console.error('research_collection_replay_invalid; supply --scenario news|official|missing or --input replay.json')
  process.exitCode = 1
}
