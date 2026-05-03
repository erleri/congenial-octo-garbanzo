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

  const [isMailingModalOpen, setIsMailingModalOpen] = useState(false)
  const [mailingList, setMailingList] = useState<string[]>([])
  const [newEmail, setNewEmail] = useState('')

  const openMailingModal = async () => {
    setIsMailingModalOpen(true)
    try {
      const res = await fetch('/api/mailing-list')
      if (res.ok) {
        const data = await res.json()
        setMailingList(Array.isArray(data) ? data : [])
      } else {
        setMailingList([])
      }
    } catch {
      console.warn('Failed to load mailing list, API might not be available.')
    }
  }

  const saveMailingList = async () => {
    try {
      const res = await fetch('/api/mailing-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mailingList),
      })
      if (res.ok) {
        alert('메일링 리스트가 저장되었습니다. 변경 사항은 저장소에 반영해야 운영 환경에 적용됩니다.')
        setIsMailingModalOpen(false)
      } else {
        alert('저장 실패: 로컬 개발 서버에서만 동작합니다.')
      }
    } catch {
      alert('저장 오류: 로컬 서버 연결을 확인해 주세요.')
    }
  }

  const addEmail = () => {
    const trimmed = newEmail.trim()
    if (trimmed && trimmed.includes('@') && !mailingList.includes(trimmed)) {
      setMailingList([...mailingList, trimmed])
      setNewEmail('')
    }
  }

  const removeEmail = (emailToRemove: string) => {
    setMailingList(mailingList.filter((email) => email !== emailToRemove))
  }

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
    <div className="panel">
      <div className="panel-header-inline">
        <div>
          <h2>관리</h2>
          <p className="table-help">데이터 업로드, 원본 확인, 메일링 리스트를 관리합니다.</p>
        </div>
        <button type="button" onClick={openMailingModal} className="quiet-button">
          메일링 리스트
        </button>
      </div>

      <div className="table-card">
        <h3>Excel 업로드</h3>
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
            Excel 우선
          </label>
          <label>
            <input
              type="checkbox"
              checked={localFillMissing}
              onChange={(event) => setLocalFillMissing(event.target.checked)}
            />
            보정 포함
          </label>
        </div>
      </div>

      <div className="table-card" style={{ marginTop: 12 }}>
        <h3>원본 데이터</h3>
        <div className="inline-controls" style={{ marginBottom: 8 }}>
          <select value={sheetName} onChange={(event) => setSheetName(event.target.value)} aria-label="시트 선택">
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
            className="quiet-button"
            disabled={!selectedSheet}
            onClick={() => {
              if (!selectedSheet) {
                return
              }

              downloadCsv(selectedSheet.name, selectedSheet.headers, filteredRows)
            }}
          >
            CSV 내보내기
          </button>
        </div>

        <p className="mobile-table-hint">표를 좌우로 이동해 전체 데이터를 확인할 수 있습니다.</p>
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

      <div className="table-card" style={{ marginTop: 12 }}>
        <h3>데이터 상태</h3>
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
      </div>

      {error ? <p className="error-message">{error}</p> : null}

      {isMailingModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>메일링 리스트</h3>
            <p>
              일일 대시보드 리포트를 받을 이메일을 관리합니다. 로컬에서 저장한 뒤 저장소에 반영해야 운영 환경에 적용됩니다.
            </p>

            <div className="inline-controls" style={{ margin: '16px 0' }}>
              <input
                type="email"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && addEmail()}
                placeholder="이메일 주소"
              />
              <button type="button" onClick={addEmail} className="quiet-button">추가</button>
            </div>

            <div className="table-scroll" style={{ maxHeight: '250px' }}>
              <table className="dense-table" style={{ minWidth: '100%' }}>
                <thead>
                  <tr>
                    <th>이메일</th>
                    <th>삭제</th>
                  </tr>
                </thead>
                <tbody>
                  {mailingList.length === 0 ? (
                    <tr>
                      <td colSpan={2}>등록된 이메일이 없습니다.</td>
                    </tr>
                  ) : (
                    mailingList.map((email) => (
                      <tr key={email}>
                        <td>{email}</td>
                        <td>
                          <button type="button" onClick={() => removeEmail(email)} className="quiet-button">삭제</button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="inline-controls" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" onClick={() => setIsMailingModalOpen(false)} className="quiet-button">취소</button>
              <button type="button" onClick={saveMailingList} className="header-refresh-button">저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Admin
