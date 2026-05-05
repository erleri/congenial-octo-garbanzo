import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import XLSX from 'xlsx'

const DEFAULT_SOURCE_PATH = 'C:\\Users\\Koo Imjun\\Documents\\FX Back Fill for history.xlsx'
const TARGET_CURRENCIES = ['GTQ', 'PYG', 'UYU'] as const

type TargetCurrency = (typeof TARGET_CURRENCIES)[number]
type BackfillRatesByDate = Record<string, Partial<Record<TargetCurrency, number>>>

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function columnToIndex(column: string): number {
  let result = 0
  for (const char of column) {
    result = result * 26 + (char.charCodeAt(0) - 64)
  }
  return result
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<x:si>([\s\S]*?)<\/x:si>/g)].map((match) => {
    const texts = [...match[1].matchAll(/<x:t[^>]*>([\s\S]*?)<\/x:t>/g)].map((entry) =>
      decodeXmlEntities(entry[1]),
    )
    return texts.join('')
  })
}

function parseWorkbookSheetTargets(workbookXml: string, relsXml: string): Record<string, string> {
  const relTargetById = [...relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].reduce<
    Record<string, string>
  >((acc, match) => {
    acc[match[1]] = `xl/${match[2].replace(/^\/+/, '')}`
    return acc
  }, {})

  return [...workbookXml.matchAll(/<x:sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].reduce<
    Record<string, string>
  >((acc, match) => {
    const [, name, relId] = match
    const target = relTargetById[relId]
    if (target) {
      acc[name] = target
    }
    return acc
  }, {})
}

function parseSheetRows(
  sheetXml: string,
  sharedStrings: string[],
): Map<number, Map<string, string | number>> {
  const rows = new Map<number, Map<string, string | number>>()

  for (const rowMatch of sheetXml.matchAll(/<x:row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/x:row>/g)) {
    const rowNumber = Number(rowMatch[1])
    const cells = new Map<string, string | number>()

    for (const cellMatch of rowMatch[2].matchAll(/<x:c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/x:c>)/g)) {
      const column = cellMatch[1]
      const attrs = cellMatch[2] ?? ''
      const inner = cellMatch[3] ?? ''
      const valueMatch = inner.match(/<x:v>([\s\S]*?)<\/x:v>/)

      if (!valueMatch) {
        continue
      }

      const raw = decodeXmlEntities(valueMatch[1])
      if (/t="s"/.test(attrs)) {
        const sharedValue = sharedStrings[Number(raw)]
        if (typeof sharedValue === 'string' && sharedValue.length > 0) {
          cells.set(column, sharedValue)
        }
        continue
      }

      const numeric = Number(raw)
      cells.set(column, Number.isFinite(numeric) ? numeric : raw)
    }

    if (cells.size > 0) {
      rows.set(rowNumber, cells)
    }
  }

  return rows
}

function parseSheetBackfill(
  currency: TargetCurrency,
  sheetXml: string,
  sharedStrings: string[],
): BackfillRatesByDate {
  const rows = parseSheetRows(sheetXml, sharedStrings)
  const yearHeaders = rows.get(3)
  const monthHeaders = rows.get(4)

  if (!yearHeaders || !monthHeaders) {
    return {}
  }

  const yearRanges = [...yearHeaders.entries()]
    .map(([column, value]) => {
      if (typeof value !== 'string') {
        return null
      }

      const matched = value.match(/'(\d{2})년|(\d{4})년/)
      if (!matched) {
        return null
      }

      const year = matched[2] ? Number(matched[2]) : 2000 + Number(matched[1])
      return { columnIndex: columnToIndex(column), year }
    })
    .filter((entry): entry is { columnIndex: number; year: number } => entry !== null)
    .sort((left, right) => left.columnIndex - right.columnIndex)

  const monthByColumnIndex = [...monthHeaders.entries()].reduce<Record<number, { year: number; month: number }>>(
    (acc, [column, value]) => {
      if (typeof value !== 'string') {
        return acc
      }

      const monthMatch = value.match(/(\d{1,2})월/)
      if (!monthMatch) {
        return acc
      }

      const columnIndex = columnToIndex(column)
      const owningYear = [...yearRanges].reverse().find((entry) => entry.columnIndex <= columnIndex)
      if (!owningYear) {
        return acc
      }

      acc[columnIndex] = {
        year: owningYear.year,
        month: Number(monthMatch[1]),
      }
      return acc
    },
    {},
  )

  const avgRow = [...rows.entries()].find(([, cells]) => cells.get('B') === 'Avg.')
  const dayRows = [...rows.entries()]
    .filter(([rowNumber]) => rowNumber > 4 && (!avgRow || rowNumber < avgRow[0]))
    .map(([rowNumber, cells]) => ({ rowNumber, cells, dayLabel: cells.get('B') }))
    .filter((entry) => typeof entry.dayLabel === 'string' && /^\d{1,2}일$/.test(entry.dayLabel))

  const backfill: BackfillRatesByDate = {}

  for (const { cells, dayLabel } of dayRows) {
    const day = Number((dayLabel as string).replace('일', ''))

    for (const [column, value] of cells.entries()) {
      if (column === 'B' || typeof value !== 'number' || !Number.isFinite(value)) {
        continue
      }

      const columnIndex = columnToIndex(column)
      const yearMonth = monthByColumnIndex[columnIndex]
      if (!yearMonth) {
        continue
      }

      const date = new Date(Date.UTC(yearMonth.year, yearMonth.month - 1, day))
      if (
        date.getUTCFullYear() !== yearMonth.year ||
        date.getUTCMonth() + 1 !== yearMonth.month ||
        date.getUTCDate() !== day
      ) {
        continue
      }

      const key = `${yearMonth.year}-${String(yearMonth.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      if (!backfill[key]) {
        backfill[key] = {}
      }
      backfill[key][currency] = value
    }
  }

  return backfill
}

function mergeBackfillMaps(target: BackfillRatesByDate, source: BackfillRatesByDate): BackfillRatesByDate {
  for (const [date, currencyRates] of Object.entries(source)) {
    if (!target[date]) {
      target[date] = {}
    }

    Object.assign(target[date], currencyRates)
  }

  return target
}

async function main() {
  const sourcePath = process.env.FX_BACKFILL_SOURCE_PATH?.trim() || DEFAULT_SOURCE_PATH
  const outputPaths = [
    resolve(process.cwd(), 'data', 'fx-backfill-history.json'),
    resolve(process.cwd(), 'public', 'fx-backfill-history.json'),
  ]
  const workbook = XLSX.readFile(sourcePath, { bookFiles: true, cellStyles: false })

  if (!workbook.files) {
    throw new Error('Workbook files were not exposed by xlsx parser.')
  }

  const workbookXml = workbook.files['xl/workbook.xml']?.content?.toString('utf8')
  const relsXml = workbook.files['xl/_rels/workbook.xml.rels']?.content?.toString('utf8')
  const sharedStringsXml = workbook.files['xl/sharedStrings.xml']?.content?.toString('utf8')

  if (!workbookXml || !relsXml || !sharedStringsXml) {
    throw new Error('Workbook XML components are missing.')
  }

  const sharedStrings = parseSharedStrings(sharedStringsXml)
  const sheetTargetByName = parseWorkbookSheetTargets(workbookXml, relsXml)
  const mergedBackfill = TARGET_CURRENCIES.reduce<BackfillRatesByDate>((acc, currency) => {
    const sheetTarget = sheetTargetByName[currency]
    const sheetXml = sheetTarget ? workbook.files?.[sheetTarget]?.content?.toString('utf8') : null

    if (!sheetXml) {
      return acc
    }

    return mergeBackfillMaps(acc, parseSheetBackfill(currency, sheetXml, sharedStrings))
  }, {})

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceWorkbook: sourcePath,
    currencies: [...TARGET_CURRENCIES],
    ratesByDate: mergedBackfill,
  }

  for (const outputPath of outputPaths) {
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  }

  const summary = TARGET_CURRENCIES.map((currency) => ({
    currency,
    count: Object.values(mergedBackfill).filter((rates) => rates[currency] !== undefined).length,
  }))

  console.log(`Generated ${outputPaths.join(', ')}`)
  console.table(summary)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
