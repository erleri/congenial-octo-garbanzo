import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

// Read-only comparison. The preserved original working directory is an explicit argument.
const original = process.argv[2]
if (!original) throw new Error('Usage: node scripts/audit-preserved-data.mjs <preserved-repository>')
const parse = (path) => JSON.parse(readFileSync(path, 'utf8'))
const full = parse(resolve(original, 'data/fx-full-history.json'))
const fallback = parse(resolve(original, 'public/data.json'))
const baseline = JSON.parse(execFileSync('git', ['-c', `safe.directory=${process.cwd().replaceAll('\\', '/')}`, 'show', 'dc6414c:data/fx-full-history.json'], { maxBuffer: 100_000_000, encoding: 'utf8' }))
const current = parse('data/fx-full-history.json')
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const delta = (before, after, key) => {
  const oldRows = new Map(before.map(row => [key(row), JSON.stringify(row)]))
  const newRows = new Map(after.map(row => [key(row), JSON.stringify(row)]))
  return {
    before: before.length, after: after.length,
    added: [...newRows.keys()].filter(key => !oldRows.has(key)).length,
    removed: [...oldRows.keys()].filter(key => !newRows.has(key)).length,
    changed: [...newRows].filter(([key, value]) => oldRows.has(key) && oldRows.get(key) !== value).length,
  }
}
const selectedDaily = full.dailyRates.filter(row => row.date >= fallback.coverage.dailyFrom && row.date <= fallback.baseDate)
console.log(JSON.stringify({
  baselineDate: baseline.baseDate, preservedDate: full.baseDate,
  fullHash: digest(full), fallbackHash: digest(fallback),
  matchingDates: full.baseDate === fallback.baseDate && full.fetchedAt === fallback.fetchedAt,
  matchingMonthly: digest(full.monthlyRates) === digest(fallback.monthlyRates),
  matchingRecentDaily: digest(selectedDaily) === digest(fallback.dailyRates),
  matchingMoving: digest(full.movingComparison) === digest(fallback.movingComparison),
  dailyDelta: delta(baseline.dailyRates, full.dailyRates, r => `${r.date}|${r.currency}|${r.rateType}`),
  monthlyDelta: delta(baseline.monthlyRates, full.monthlyRates, r => `${r.year}|${r.month}|${r.currency}|${r.rateType}`),
  sameAsProductionSnapshot: { daily: digest(full.dailyRates) === digest(current.dailyRates), monthly: digest(full.monthlyRates) === digest(current.monthlyRates), moving: digest(full.movingComparison) === digest(current.movingComparison) },
}, null, 2))
