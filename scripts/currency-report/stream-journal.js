import fs from 'node:fs/promises'
import { privateDir } from './storage.js'

// Headers are committed before body reading. A process crash therefore leaves an
// ID for later read-only cost lookup, even if no final response could be saved.
export async function createPrivateStreamJournal(runId) {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(runId)) throw new Error('invalid_diagnostic_run_id')
  const dir = `${privateDir}/stream-${runId}`
  await fs.mkdir(dir) // fail closed on duplicate execution; never replace old logs
  let sequence = 0
  return async record => {
    const file = `${dir}/${String(sequence++).padStart(6, '0')}.json`
    await fs.writeFile(file, JSON.stringify(record, null, 2), { flag: 'wx' })
  }
}
