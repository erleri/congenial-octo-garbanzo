// Read one explicit local input; print the plan. No env loading or output writes.
import fs from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { planResearchNeeds } from './research-needs.js'
import { planChileRetailNeeds } from './chile-statistic-scopes.js'
import { planChileConsumptionNeeds } from './chile-consumption-scopes.js'
import { planResearchSourceSelection } from './research-source-selection.js'

async function readJson(file) {
  if(!file || !file.endsWith('.json')) throw new Error('explicit_json_input_required')
  const stat=await fs.stat(file)
  if(!stat.isFile() || stat.size>5_000_000) throw new Error('input_size_limit')
  return JSON.parse(await fs.readFile(file,'utf8'))
}

try {
  const { values } = parseArgs({ options: { input: { type: 'string' }, 'scope-profile': { type: 'string' }, period: { type: 'string' },
    'source-plan': { type: 'string' }, 'source-register': { type: 'string' } }, strict: true })
  const input = await readJson(values.input)
  if (values['scope-profile'] && !['clp-retail','clp-consumption'].includes(values['scope-profile'])) throw new Error('unknown_scope_profile')
  if (!!values['scope-profile'] !== !!values.period) throw new Error('profile_and_period_required')
  if(!!values['source-plan']!==!!values['source-register'] || values['source-plan'] && values['scope-profile']) throw new Error('invalid_source_selection_options')
  const planner = values['scope-profile'] === 'clp-consumption' ? planChileConsumptionNeeds : planChileRetailNeeds
  const plan = values['source-plan'] ? planResearchSourceSelection({input,
    sourcePlan:await readJson(values['source-plan']),sourceRegister:await readJson(values['source-register']),attempts:input.sourceAttempts??[]})
    : values['scope-profile'] ? planner({ ...input, period: values.period }) : planResearchNeeds(input)
  console.log(JSON.stringify(plan, null, 2))
} catch {
  // Never echo an arbitrary input, credential, path or parser excerpt on failure.
  console.error('research_needs_input_invalid; use the documented local JSON contract')
  process.exitCode = 1
}
