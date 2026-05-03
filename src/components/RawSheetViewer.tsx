import { useMemo, useState } from 'react'
import type { ExchangeRateDataset } from '../types/exchangeRate'

interface RawSheetViewerProps {
  data: ExchangeRateDataset
}

function downloadCsv(filename: string, headers: string[], rows: Array<Record<string, string | number | null>>) {
  const escaped = (value: string | number | null): string => {
    if (value === null) {
      return ''
    }

    const text = String(value).replaceAll('"', '""')
    return `"${text}"`
  }

  const csv = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escaped(row[header] ?? null)).join(',')),
  ].join('\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = `${filename}.csv`
  anchor.click()
  URL.revokeObjectURL(href)
}

function RawSheetViewer({ data }: RawSheetViewerProps) {
  const [sheetName, setSheetName] = useState(data.rawSheets[0]?.name ?? 'Summary')
  const [query, setQuery] = useState('')

  const selectedSheet =
    data.rawSheets.find((sheet) => sheet.name === sheetName) ?? data.rawSheets[0]

  const filteredRows = useMemo(() => {
    if (!selectedSheet) {
      return []
    }

    if (!query.trim()) {
      return selectedSheet.rows
    }

    const lowered = query.toLowerCase()
    return selectedSheet.rows.filter((row) =>
      selectedSheet.headers.some((header) =>
        String(row[header] ?? '').toLowerCase().includes(lowered),
      ),
    )
  }, [query, selectedSheet])

  return (
    <div className="panel">
      <div className="panel-header panel-header-inline">
        <h2>Data Table</h2>
        <div className="inline-controls">
          <select value={sheetName} onChange={(event) => setSheetName(event.target.value)}>
            {data.rawSheets.map((sheet) => (
              <option key={sheet.name} value={sheet.name}>
                {sheet.name}
              </option>
            ))}
          </select>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="검색"
          />
          <button
            type="button"
            disabled={!selectedSheet}
            onClick={() => {
              if (!selectedSheet) {
                return
              }

              downloadCsv(selectedSheet.name, selectedSheet.headers, filteredRows)
            }}
          >
            CSV 다운로드
          </button>
        </div>
      </div>

      <div className="table-scroll">
        <table className="dense-table">
          <thead>
            <tr>
              {selectedSheet?.headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, rowIndex) => (
              <tr key={`${selectedSheet?.name}-${rowIndex}`}>
                {selectedSheet?.headers.map((header) => (
                  <td key={`${rowIndex}-${header}`}>{String(row[header] ?? '-')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default RawSheetViewer
