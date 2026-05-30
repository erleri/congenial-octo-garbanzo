import { useEffect, useMemo, useState } from 'react'
import { fetchRawSheetsDataset } from '../lib'
import {
  DATASET_SOURCE_LABELS,
  type DatasetSource,
  type ExchangeRateDataset,
  type RawSheet,
} from '../types/exchangeRate'

interface ActionNotice {
  type: 'success' | 'error'
  text: string
}

interface AdminProps {
  error: string | null
  dataset: ExchangeRateDataset | null
  datasetSource: DatasetSource
  onUploadExcel: (
    file: File,
    options: { excelPriority: boolean; fillMissing: boolean },
  ) => Promise<ActionNotice>
  excelPriority: boolean
  fillMissing: boolean
  initialMailingOpen?: boolean
}

interface InlineNotice {
  tone: 'info' | 'success' | 'warning' | 'error'
  text: string
}

function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Record<string, string | number | null>>,
) {
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

function noticeClassName(tone: InlineNotice['tone']) {
  return `inline-notice ${tone}-notice`
}

function Admin({
  error,
  dataset,
  datasetSource,
  onUploadExcel,
  excelPriority,
  fillMissing,
  initialMailingOpen = false,
}: AdminProps) {
  const [localExcelPriority, setLocalExcelPriority] = useState(excelPriority)
  const [localFillMissing, setLocalFillMissing] = useState(fillMissing)
  const [sheetName, setSheetName] = useState('Summary')
  const [fetchedRawSheets, setFetchedRawSheets] = useState<RawSheet[]>([])
  const [excelNotice, setExcelNotice] = useState<InlineNotice | null>(null)

  const [isMailingModalOpen, setIsMailingModalOpen] = useState(initialMailingOpen)
  const [mailingList, setMailingList] = useState<string[]>([])
  const [newEmail, setNewEmail] = useState('')
  const [mailingNotice, setMailingNotice] = useState<InlineNotice | null>(null)

  const isLocalDev = useMemo(() => {
    const host = window.location.hostname
    return host === '127.0.0.1' || host === 'localhost'
  }, [])

  useEffect(() => {
    let isMounted = true

    if (dataset?.rawSheets?.length) {
      return () => {
        isMounted = false
      }
    }

    void fetchRawSheetsDataset().then((payload) => {
      if (!isMounted || !payload?.rawSheets?.length) {
        return
      }

      setFetchedRawSheets(payload.rawSheets)
    })

    return () => {
      isMounted = false
    }
  }, [dataset?.rawSheets])

  const rawSheets = dataset?.rawSheets?.length ? dataset.rawSheets : fetchedRawSheets
  const activeSheetName = rawSheets.some((sheet) => sheet.name === sheetName)
    ? sheetName
    : (rawSheets[0]?.name ?? '')
  const selectedSheet = rawSheets.find((sheet) => sheet.name === activeSheetName) ?? rawSheets[0]

  const loadMailingList = async () => {
    try {
      const res = await fetch('/api/mailing-list')
      if (res.ok) {
        const data = await res.json()
        setMailingList(Array.isArray(data) ? data : [])
        return
      }

      setMailingList([])
    } catch {
      setMailingList([])
    }
  }

  const openMailingModal = async () => {
    setMailingNotice(
      isLocalDev
        ? {
            tone: 'info',
            text: '로컬 개발 서버에서만 저장됩니다. 운영 수신 대상은 배포 설정 기준으로 유지됩니다.',
          }
        : {
            tone: 'warning',
            text: '운영 화면은 읽기 전용입니다. 실제 수신 대상은 저장소와 배포 설정 기준으로 관리됩니다.',
          },
    )
    setIsMailingModalOpen(true)
    await loadMailingList()
  }

  useEffect(() => {
    if (initialMailingOpen) {
      const timeoutId = window.setTimeout(() => {
        void loadMailingList()
      }, 0)
      return () => window.clearTimeout(timeoutId)
    }
  }, [initialMailingOpen])

  const saveMailingList = async () => {
    if (!isLocalDev) {
      setMailingNotice({
        tone: 'warning',
        text: '운영 화면에서는 저장할 수 없습니다. 수신 대상은 저장소 기준 설정에서 관리해 주세요.',
      })
      return
    }

    try {
      const res = await fetch('/api/mailing-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mailingList),
      })

      if (!res.ok) {
        throw new Error('로컬 메일링 API에 연결할 수 없습니다.')
      }

      setMailingNotice({
        tone: 'success',
        text: '로컬 개발 서버에 메일링 리스트를 저장했습니다.',
      })
      window.setTimeout(() => setIsMailingModalOpen(false), 400)
    } catch (mailingError) {
      setMailingNotice({
        tone: 'error',
        text:
          mailingError instanceof Error
            ? mailingError.message
            : '메일링 리스트 저장에 실패했습니다.',
      })
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

  return (
    <div className="panel">
      <div className="panel-header-inline">
        <div>
          <h2>관리</h2>
          <p className="table-help">
            데이터 확인, 로컬 미리보기, 메일 운영 범위를 이 화면에서 구분합니다.
          </p>
        </div>
        <button type="button" onClick={openMailingModal} className="quiet-button">
          메일링 리스트
        </button>
      </div>

      <div className="scope-grid">
        <div className="scope-card">
          <span className="scope-badge scope-badge-local">로컬 임시 보기</span>
          <strong>Excel 업로드</strong>
          <p>이 브라우저에서만 확인하는 미리보기입니다. 운영 데이터나 일일 발송 메일에는 반영되지 않습니다.</p>
        </div>
        <div className="scope-card">
          <span className="scope-badge scope-badge-operational">운영 데이터 확인됨</span>
          <strong>현재 데이터 출처</strong>
          <p className="source-state">{DATASET_SOURCE_LABELS[datasetSource]}</p>
          <p>build, 기준일, 데이터 출처를 함께 보고 지금 화면의 기준을 확인합니다.</p>
        </div>
        <div className="scope-card">
          <span className={`scope-badge ${isLocalDev ? 'scope-badge-local' : 'scope-badge-readonly'}`}>
            {isLocalDev ? '로컬 임시 보기' : '읽기 전용'}
          </span>
          <strong>메일링 리스트</strong>
          <p>
            {isLocalDev
              ? '로컬 개발 서버에서만 저장됩니다. 운영 수신 대상은 저장소와 배포 설정 기준입니다.'
              : '운영 화면에서는 편집하지 않습니다. 실제 수신 대상은 저장소와 배포 설정 기준입니다.'}
          </p>
        </div>
      </div>

      <div className="table-card">
        <h3>Excel 업로드</h3>
        <p className={noticeClassName('warning')}>
          이 브라우저에서만 반영되는 로컬 임시 보기입니다.
        </p>
        <p className="table-help" style={{ marginTop: 8 }}>
          현재 화면 출처: <strong>{DATASET_SOURCE_LABELS[datasetSource]}</strong>
        </p>
        <div className="inline-controls" style={{ marginTop: 10 }}>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={async (event) => {
              const file = event.target.files?.[0] ?? null
              if (file) {
                const notice = await onUploadExcel(file, {
                  excelPriority: localExcelPriority,
                  fillMissing: localFillMissing,
                })
                setExcelNotice({
                  tone: notice.type,
                  text: notice.text,
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
            결측값 보정 포함
          </label>
        </div>
        {excelNotice ? <p className={noticeClassName(excelNotice.tone)}>{excelNotice.text}</p> : null}
      </div>

      <div className="table-card" style={{ marginTop: 12 }}>
        <h3>원본 데이터 미리보기</h3>
        <div className="inline-controls" style={{ marginBottom: 8 }}>
          <select
            value={activeSheetName}
            onChange={(event) => setSheetName(event.target.value)}
            aria-label="시트 선택"
            disabled={!rawSheets.length}
          >
            {rawSheets.map((sheet) => (
              <option key={sheet.name} value={sheet.name}>
                {sheet.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="quiet-button"
            disabled={!selectedSheet}
            onClick={() => {
              if (!selectedSheet) {
                return
              }

              downloadCsv(selectedSheet.name, selectedSheet.headers, selectedSheet.rows)
            }}
          >
            CSV 내보내기
          </button>
        </div>
        <p className="table-help">
          메인 대시보드 데이터와 별개로, 원본 시트 자체를 확인할 때 사용합니다.
        </p>
        {!rawSheets.length ? (
          <p className="table-help">원본 시트 데이터를 아직 불러오지 못했습니다.</p>
        ) : null}
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
            <strong>데이터 출처</strong>
            <div>{DATASET_SOURCE_LABELS[datasetSource]}</div>
          </div>
          <div>
            <strong>일별 레코드</strong>
            <div>{dataset?.dailyRates.length.toLocaleString('ko-KR') ?? '0'}</div>
          </div>
          <div>
            <strong>월별 레코드</strong>
            <div>{dataset?.monthlyRates.length.toLocaleString('ko-KR') ?? '0'}</div>
          </div>
          <div>
            <strong>메일 운영 상태</strong>
            <div>{isLocalDev ? '로컬 임시 보기' : '읽기 전용'}</div>
          </div>
        </div>
      </div>

      {error ? <p className="error-message">{error}</p> : null}

      {isMailingModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>메일링 리스트</h3>
            <p>
              일일 대시보드 리포트를 받는 메일 주소입니다. 운영 화면에서는 실제 수신 대상이 바로 바뀌지 않습니다.
            </p>

            {mailingNotice ? <p className={noticeClassName(mailingNotice.tone)}>{mailingNotice.text}</p> : null}

            <div className="inline-controls" style={{ margin: '16px 0' }}>
              <input
                type="email"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && addEmail()}
                placeholder="email@example.com"
                disabled={!isLocalDev}
              />
              <button type="button" onClick={addEmail} className="quiet-button" disabled={!isLocalDev}>
                추가
              </button>
            </div>

            <div className="table-scroll" style={{ maxHeight: '250px' }}>
              <table className="dense-table" style={{ minWidth: '100%' }}>
                <thead>
                  <tr>
                    <th>이메일</th>
                    <th>작업</th>
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
                          <button
                            type="button"
                            onClick={() => removeEmail(email)}
                            className="quiet-button"
                            disabled={!isLocalDev}
                          >
                            제거
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="inline-controls" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" onClick={() => setIsMailingModalOpen(false)} className="quiet-button">
                닫기
              </button>
              <button
                type="button"
                onClick={saveMailingList}
                className="header-refresh-button"
                disabled={!isLocalDev}
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Admin
