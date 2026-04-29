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
    } catch (e) {
      console.warn('Failed to load mailing list, API might not be available.')
    }
  }

  const saveMailingList = async () => {
    try {
      const res = await fetch('/api/mailing-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mailingList)
      })
      if (res.ok) {
        alert('메일링 리스트가 저장되었습니다. 변경사항을 깃허브에 푸시해주세요.')
        setIsMailingModalOpen(false)
      } else {
        alert('저장 실패: 로컬 개발 서버(npm run dev) 환경에서만 작동합니다.')
      }
    } catch (e) {
      alert('저장 오류: 서버 연결 실패. 로컬 환경인지 확인하세요.')
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
    setMailingList(mailingList.filter(e => e !== emailToRemove))
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
    <section className="panel">
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Admin</h2>
        <button type="button" onClick={openMailingModal} className="primary" style={{ padding: '6px 12px', background: '#1f3c88', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          메일링 리스트 관리
        </button>
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

      {isMailingModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '500px' }}>
            <h3>수신자 이메일 목록 관리</h3>
            <p style={{ margin: '8px 0', fontSize: '13px', color: '#5b6778' }}>
              매일 대시보드를 이메일로 받아볼 팀원들을 추가하세요. <br/>
              <b>주의:</b> 이 설정은 로컬 서버에서만 저장 가능하며, 저장 후 깃허브에 Push해야 클라우드 메일 서버가 인식합니다.
            </p>
            
            <div style={{ display: 'flex', gap: '8px', margin: '16px 0' }}>
              <input 
                type="email" 
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addEmail()}
                placeholder="이메일 주소 입력"
                style={{ flex: 1, padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}
              />
              <button type="button" onClick={addEmail} style={{ padding: '8px 16px', background: '#e2e8f0', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>추가</button>
            </div>

            <div className="table-scroll" style={{ maxHeight: '250px', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
              <table className="dense-table" style={{ minWidth: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#f8fbff' }}>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px' }}>이메일</th>
                    <th style={{ width: '60px', textAlign: 'center', padding: '8px' }}>삭제</th>
                  </tr>
                </thead>
                <tbody>
                  {mailingList.length === 0 ? (
                    <tr>
                      <td colSpan={2} style={{ textAlign: 'center', padding: '16px', color: '#94a3b8' }}>등록된 이메일이 없습니다.</td>
                    </tr>
                  ) : (
                    mailingList.map(email => (
                      <tr key={email}>
                        <td style={{ textAlign: 'left', padding: '8px' }}>{email}</td>
                        <td style={{ textAlign: 'center', padding: '8px' }}>
                          <button type="button" onClick={() => removeEmail(email)} style={{ color: '#ef4444', background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>X</button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button type="button" onClick={() => setIsMailingModalOpen(false)} style={{ padding: '8px 16px', border: '1px solid #ccc', background: 'white', borderRadius: '4px', cursor: 'pointer' }}>취소</button>
              <button type="button" onClick={saveMailingList} style={{ padding: '8px 16px', background: '#1f3c88', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>저장</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default Admin
