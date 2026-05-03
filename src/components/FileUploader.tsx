import { useState } from 'react'
import type { ExchangeRateDataset } from '../types/exchangeRate'

interface FileUploaderProps {
  loading: boolean
  error: string | null
  dataset: ExchangeRateDataset | null
  onRefresh: () => Promise<void>
  onUploadExcel: (
    file: File,
    options: { excelPriority: boolean; fillMissing: boolean },
  ) => Promise<void>
  excelPriority: boolean
  fillMissing: boolean
}

function FileUploader({
  loading,
  error,
  dataset,
  onRefresh,
  onUploadExcel,
  excelPriority,
  fillMissing,
}: FileUploaderProps) {
  // Removed selectedFile
  const [localExcelPriority, setLocalExcelPriority] = useState(excelPriority)
  const [localFillMissing, setLocalFillMissing] = useState(fillMissing)

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Upload / Refresh</h2>
      </div>

      <div className="refresh-box">
        <p>
          엑셀 업로드 대신 외부 환율 API에서 데이터를 수집해 로컬 캐시에 저장합니다.
        </p>
        <button type="button" onClick={onRefresh} disabled={loading}>
          {loading ? '새로고침 중...' : '환율 데이터 새로고침'}
        </button>
      </div>

      <div className="table-card" style={{ marginTop: 12 }}>
        <h3>엑셀 업로드(우선 병합)</h3>
        <div className="inline-controls" style={{ marginBottom: 8 }}>
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
        </div>
        <div className="inline-controls">
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
      </div>

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

      {error ? <p className="error-message">{error}</p> : null}
    </div>
  )
}

export default FileUploader
