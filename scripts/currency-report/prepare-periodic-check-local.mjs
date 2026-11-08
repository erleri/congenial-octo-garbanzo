// File preparation only. No .env loading or generation transport.
import fs from 'node:fs'
import path from 'node:path'
import { preparePeriodicCheck } from './periodic-check.js'
import { requestBody } from './openrouter.js'
import {applyWriterPolicy} from './writer-policy.js'
globalThis.fetch = () => { throw new Error('offline_periodic_preparation_only') }
const file = process.argv[2]
if (!file || !file.endsWith('.json') || path.basename(file).startsWith('.env')) throw new Error('periodic_input_json_required')
const prepared = preparePeriodicCheck(JSON.parse(fs.readFileSync(file, 'utf8')))
const out = fs.mkdtempSync('.local-reports/private/periodic-preparation-')
if (prepared.packet) {
  const base = requestBody(prepared.packet, 'openrouter/free')
  const selected=applyWriterPolicy(base,process.argv[3])
  const contract=selected.body
  fs.writeFileSync(out+'/writer-plan.json',JSON.stringify(selected,null,2))
  fs.writeFileSync(out + '/writer-input.json', contract.messages[1].content)
  fs.writeFileSync(out + '/writer-instructions.txt', contract.messages[0].content)
  fs.writeFileSync(out + '/writer-schema.json', JSON.stringify(contract.response_format.json_schema.schema, null, 2))
}
fs.writeFileSync(out + '/prepared.json', JSON.stringify(prepared, null, 2))
console.log(JSON.stringify({ output: out, status: prepared.status, holds: prepared.holds,
  modelCalls: 0, externalCalls: 0, publicationApproved: false }))
