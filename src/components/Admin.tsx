import { useMemo, useState } from 'react'
import type { ExchangeRateDataset } from '../types/exchangeRate'

interface AdminProps {
  error: string | null
  dataset: ExchangeRateDataset | null
  onUploadExcel: (
    file: File,
    options: { excelPriority: boolean; fillMissing: boolean },
  ) => Promise<void>
  excelPriority: boolean
  fillMissing: boolean
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

function Admin({
  error,
  dataset,
  onUploadExcel,
  excelPriority,
  fillMissing,
}: AdminProps) {
  const [localExcelPriority, setLocalExcelPriority] = useState(excelPriority)
  const [localFillMissing, setLocalFillMissing] = useState(fillMissing)
  const [sheetName, setSheetName] = useState(dataset?.rawSheets[0]?.name ?? 'Summary')
  const [query, setQuery] = useState('')

  const selectedSheet = dataset?.rawSheets.find((sheet) => sheet.name === sheetName) ?? dataset?.rawSheets[0]

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
    <section className="panel">
      <div className="panel-header">
        <h2>Admin</h2>
      </div>

      <article className="table-card">
        <h3>엑셀 업로드</h3>
        <div className="inline-controls">
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null
              if (file) {
                onUploadExcel(file, {
                  excelPriority: localExcelPriority,
                  fillMissing: localFillMissing,
                })
              }
              event.target.value = ''
            }}
          />
          <label>
            <input
              type="checkbox"
              checked={localExcelPriority}
              onChange={(event) => setLocalExcelPriority(event.target.checked)}
            />
            엑셀 우선(EXCEL {'>'} API)
          </label>
          <label>
            <input
              type="checkbox"
              checked={localFillMissing}
              onChange={(event) => setLocalFillMissing(event.target.checked)}
            />
            빈칸 자동 보정
          </label>
        </div>
      </article>

      <article className="table-card">
        <h3>데이터 조회 및 내보내기</h3>
        <div className="inline-controls" style={{ marginBottom: 8 }}>
          <select value={sheetName} onChange={(event) => setSheetName(event.target.value)}>
            {dataset?.rawSheets.map((sheet) => (
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

        <p className="mobile-table-hint">모바일에서는 표를 좌우로 밀어 전체 데이터를 볼 수 있습니다.</p>
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
      </article>

      <article className="table-card">
        <h3>데이터 통계</h3>
        <div className="meta-grid">
          <div>
            <strong>기준일</strong>
            <div>{dataset?.baseDate ?? '-'}</div>
          </div>
          <div>
            <strong>최종 갱신</strong>
            <div>{dataset ? new Date(dataset.fetchedAt).toLocaleString('ko-KR') : '-'}</div>
          </div>
          <div>
            <strong>일별 레코드</strong>
            <div>{dataset?.dailyRates.length.toLocaleString('ko-KR') ?? '0'}</div>
          </div>
          <div>
            <strong>월별 레코드</strong>
            <div>{dataset?.monthlyRates.length.toLocaleString('ko-KR') ?? '0'}</div>
          </div>
        </div>
      </article>

      {error ? <p className="error-message">{error}</p> : null}
    </section>
  )
}

export default Admin
