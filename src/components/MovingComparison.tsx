import { useMemo, useState } from 'react'
import { formatCellValue } from '../lib/formatters'
import { buildMovingComparisonRows } from '../lib/moving'
import { CURRENCIES } from '../types/exchangeRate'
import type {
  BusinessPlan,
  BusinessPlanStatus,
  CurrencyCode,
  ExchangeRateDataset,
  MovingColumn,
} from '../types/exchangeRate'

interface MovingComparisonProps {
  data: ExchangeRateDataset
  businessPlan: BusinessPlan
  onUpdatePlan: (plan: BusinessPlan) => Promise<{ type: 'success' | 'warning'; text: string }>
  businessPlanStatus: BusinessPlanStatus
  onRequestPlanAccess: (email: string) => Promise<void>
  onSignOutPlanAccess: () => Promise<void>
}

const COLUMNS: Array<{ key: MovingColumn; label: string }> = [
  { key: 'KRW', label: 'KRW' },
  { key: 'BRL', label: 'BRL' },
  { key: 'COP', label: 'COP' },
  { key: 'CLP', label: 'CLP' },
  { key: 'PEN', label: 'PEN' },
  { key: 'ARS', label: 'ARS' },
  { key: 'MXN', label: 'MXN' },
  { key: 'PYG', label: 'PYG' },
  { key: 'GTQ', label: 'GTQ' },
  { key: 'UYU', label: 'UYU' },
  { key: 'CNY', label: 'CNY' },
  { key: 'OIL', label: 'Oil' },
]

const TARGET_CURRENCIES: CurrencyCode[] = ['USD', 'BRL', 'MXN', 'COP', 'CLP', 'PEN']
const REST_CURRENCIES: CurrencyCode[] = CURRENCIES.filter(
  (currency) => !TARGET_CURRENCIES.includes(currency),
)

function formatMovingValue(value: number | null, column: MovingColumn, isPercent: boolean): string {
  if (column === 'OIL') {
    if (value === null) {
      return '-'
    }

    if (isPercent) {
      return `${(value * 100).toFixed(2)}%`
    }

    return new Intl.NumberFormat('ko-KR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  }

  return formatCellValue(
    value,
    value !== null ? 'ok' : 'empty',
    column === 'KRW' ? 'KRW' : column,
    isPercent,
  )
}

function formatStatusDateTime(value: string | null): string {
  if (!value) {
    return '기록 없음'
  }

  return new Date(value).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatPeriodMonth(value: string | null): string {
  if (!value) {
    return '-'
  }

  return value.slice(0, 7)
}

function getPlanSourceLabel(status: BusinessPlanStatus): string {
  if (!status.configured || status.remoteLoadStatus === 'not_configured') {
    return '설정 필요'
  }

  if (status.source === 'supabase' && status.remoteLoadStatus === 'loaded') {
    return status.canEdit ? '운영 데이터 확인됨' : '읽기 전용'
  }

  if (status.source === 'local') {
    return '로컬 임시 보기'
  }

  return '설정 필요'
}

function getPlanStatusTone(status: BusinessPlanStatus): 'success' | 'warning' | 'error' {
  if (status.remoteLoadStatus === 'loaded' && status.canEdit) {
    return 'success'
  }

  if (status.remoteLoadStatus === 'loaded' || status.source === 'local') {
    return 'warning'
  }

  return 'error'
}

function getPlanStatusSummary(status: BusinessPlanStatus): string {
  if (!status.configured || status.remoteLoadStatus === 'not_configured') {
    return '운영 저장소 연결이 없어 임시값을 보여주고 있습니다.'
  }

  if (status.remoteLoadStatus === 'loaded' && status.canEdit) {
    return '운영 데이터로 확인했고, 현재 계정은 저장할 수 있습니다.'
  }

  if (status.remoteLoadStatus === 'loaded') {
    return '운영 데이터는 확인했지만, 현재 계정은 읽기 전용입니다.'
  }

  if (status.remoteLoadStatus === 'failed' || status.source === 'local') {
    return '운영 데이터를 불러오지 못해 임시값을 보여주고 있습니다.'
  }

  return '계획 환율 상태를 아직 확인하지 못했습니다.'
}

function MovingComparison({
  data,
  businessPlan,
  onUpdatePlan,
  businessPlanStatus,
  onRequestPlanAccess,
  onSignOutPlanAccess,
}: MovingComparisonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [tempPlan, setTempPlan] = useState<BusinessPlan>(businessPlan)
  const [loginEmail, setLoginEmail] = useState('')
  const [authMessage, setAuthMessage] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null)

  const rows = useMemo(() => {
    const baseDate = new Date(data.baseDate)
    const year = baseDate.getFullYear()
    const month = baseDate.getMonth() + 1
    return buildMovingComparisonRows(data, year, month, businessPlan)
  }, [data, businessPlan])

  const planStatusTone = getPlanStatusTone(businessPlanStatus)
  const planStatusSummary = getPlanStatusSummary(businessPlanStatus)
  const planSourceLabel = getPlanSourceLabel(businessPlanStatus)
  const lastUpdatedLabel = formatStatusDateTime(businessPlanStatus.lastUpdatedAt)
  const lastUpdatedByLabel = businessPlanStatus.lastUpdatedBy ?? '저장 주체 없음'
  const lastVerifiedLabel = businessPlanStatus.lastVerifiedAt
    ? new Date(businessPlanStatus.lastVerifiedAt).toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '확인 기록 없음'

  const openModal = () => {
    setTempPlan(businessPlan)
    setAuthMessage(null)
    setSaveMessage(null)
    setIsModalOpen(true)
  }

  const handlePlanChange = (type: 'leading' | 'moving', currency: CurrencyCode, valueStr: string) => {
    const value = valueStr === '' ? undefined : Number(valueStr)
    setTempPlan((prev) => ({
      ...prev,
      [type]: {
        ...prev[type],
        [currency]: value,
      },
    }))
  }

  const handleSave = async () => {
    try {
      const result = await onUpdatePlan(tempPlan)
      setSaveMessage({
        tone: result.type,
        text: result.text,
      })
      if (result.type === 'success') {
        window.setTimeout(() => setIsModalOpen(false), 600)
      }
    } catch (saveError) {
      setSaveMessage({
        tone: 'error',
        text:
          saveError instanceof Error
            ? saveError.message
            : '계획 환율 저장에 실패했습니다.',
      })
    }
  }

  const handleRequestLogin = async () => {
    const trimmed = loginEmail.trim()
    if (!trimmed) {
      setAuthMessage('회사 이메일을 입력해 주세요.')
      return
    }

    try {
      await onRequestPlanAccess(trimmed)
      setAuthMessage('로그인 링크를 이메일로 보냈습니다.')
    } catch (requestError) {
      setAuthMessage(
        requestError instanceof Error
          ? requestError.message
          : '로그인 링크 발송에 실패했습니다.',
      )
    }
  }

  const renderCurrencyRow = (currency: CurrencyCode, isTarget: boolean) => (
    <tr key={currency} style={{ opacity: isTarget ? 1 : 0.62 }}>
      <td>{currency === 'USD' ? 'USD (KRW)' : currency}</td>
      <td>
        <input
          type="number"
          step="0.0001"
          value={tempPlan.leading[currency] ?? ''}
          disabled={!businessPlanStatus.canEdit || businessPlanStatus.saving}
          onChange={(event) => handlePlanChange('leading', currency, event.target.value)}
          placeholder="자동 평균"
        />
      </td>
      <td>
        <input
          type="number"
          step="0.0001"
          value={tempPlan.moving[currency] ?? ''}
          disabled={!businessPlanStatus.canEdit || businessPlanStatus.saving}
          onChange={(event) => handlePlanChange('moving', currency, event.target.value)}
          placeholder="자동 평균"
        />
      </td>
    </tr>
  )

  return (
    <div className="panel">
      <div className="panel-header-inline">
        <div>
          <h2>계획 대비</h2>
          <p className="table-help">이동 평균, 선행 평균, 실제 환율을 비교합니다.</p>
        </div>
        <button type="button" onClick={openModal} className="quiet-button">
          계획 환율 입력
        </button>
      </div>

      <div className={`operational-status-panel operational-status-${planStatusTone}`}>
        <div>
          <span className="scope-badge scope-badge-operational">계획 환율 상태</span>
          <h3>{planSourceLabel}</h3>
          <p>{planStatusSummary}</p>
        </div>
        <div className="operational-status-grid">
          <div>
            <span>적용 월</span>
            <strong>{formatPeriodMonth(businessPlanStatus.periodMonth)}</strong>
          </div>
          <div>
            <span>저장 권한</span>
            <strong>{businessPlanStatus.canEdit ? '편집 가능' : '읽기 전용'}</strong>
          </div>
          <div>
            <span>마지막 저장</span>
            <strong>{lastUpdatedLabel}</strong>
          </div>
          <div>
            <span>저장 주체</span>
            <strong>{lastUpdatedByLabel}</strong>
          </div>
          <div>
            <span>마지막 확인</span>
            <strong>{lastVerifiedLabel}</strong>
          </div>
          <div>
            <span>저장 결과</span>
            <strong>{businessPlanStatus.lastSaveMessage ?? '대기 중'}</strong>
          </div>
        </div>
      </div>

      <div className="scope-grid">
        <div className="scope-card">
          <span className={`scope-badge ${businessPlanStatus.canEdit ? 'scope-badge-operational' : 'scope-badge-readonly'}`}>
            {businessPlanStatus.canEdit ? '운영 반영 가능' : '권한 필요'}
          </span>
          <strong>계획 환율 저장</strong>
          <p>
            {businessPlanStatus.canEdit
              ? '저장하면 운영 기준값이 갱신됩니다.'
              : '현재는 읽기 전용입니다. 편집 권한이 있는 계정으로 로그인해야 저장할 수 있습니다.'}
          </p>
        </div>
        <div className="scope-card">
          <span className={businessPlanStatus.remoteLoadStatus === 'loaded' ? 'scope-badge scope-badge-operational' : 'scope-badge scope-badge-readonly'}>
            {businessPlanStatus.remoteLoadStatus === 'loaded' ? '운영 데이터 확인됨' : '로컬 임시 보기'}
          </span>
          <strong>현재 계획 데이터 출처</strong>
          <p className="source-state">{planSourceLabel}</p>
          <p>운영 데이터가 아닐 때는 보고용 참고값으로만 사용하세요.</p>
        </div>
      </div>

      <div className="plan-auth-panel" style={{ marginBottom: 12 }}>
        <div className="plan-auth-grid">
          <span>적용 월</span>
          <strong>{formatPeriodMonth(businessPlanStatus.periodMonth)}</strong>
          <span>현재 출처</span>
          <strong>{planSourceLabel}</strong>
          <span>권한 상태</span>
          <strong>{businessPlanStatus.canEdit ? '편집 가능' : '읽기 전용'}</strong>
          <span>최종 저장</span>
          <strong>
            {lastUpdatedLabel}
            {businessPlanStatus.lastUpdatedBy ? ` / ${businessPlanStatus.lastUpdatedBy}` : ''}
          </strong>
          <span>마지막 확인</span>
          <strong>{lastVerifiedLabel}</strong>
        </div>
      </div>

      <p className="mobile-table-hint">표는 좌우로 이동해 전체 데이터를 확인할 수 있습니다.</p>
      <div className="moving-table-wrapper sticky-table-wrapper">
        <table className="dense-table">
          <thead>
            <tr>
              <th rowSpan={2}>항목</th>
              <th colSpan={COLUMNS.length}>통화별 환율</th>
            </tr>
            <tr>
              {COLUMNS.map((col) => (
                <th key={col.key}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className={row.isPercent ? 'row-percent' : ''}>
                <td style={{ whiteSpace: 'nowrap', fontWeight: row.isPercent ? 650 : 450 }}>
                  {row.label}
                </td>
                {COLUMNS.map((col) => {
                  const val = row.values[col.key]
                  return <td key={`${row.label}-${col.key}`}>{formatMovingValue(val, col.key, row.isPercent)}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="table-help" style={{ marginTop: 10 }}>
        계획 환율을 입력하지 않은 통화는 최근 3개월 평균값으로 자동 계산합니다.
      </p>

      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: 650 }}>
            <h3>계획 환율 설정</h3>
            <p>각 통화의 USD 기준 계획 환율을 입력합니다. USD 항목에는 1 USD 기준 KRW 값을 입력합니다.</p>

            <div className={`inline-notice ${planStatusTone}-notice`} style={{ marginBottom: 12 }}>
              {planStatusSummary}
            </div>

            <div className="plan-auth-panel">
              <div className="plan-auth-grid">
                <span>적용 월</span>
                <strong>{formatPeriodMonth(businessPlanStatus.periodMonth)}</strong>
                <span>데이터 위치</span>
                <strong>{planSourceLabel}</strong>
                <span>로그인</span>
                <strong>{businessPlanStatus.userEmail ?? '로그인 필요'}</strong>
                <span>권한</span>
                <strong>{businessPlanStatus.canEdit ? '편집 가능' : '읽기 전용'}</strong>
                <span>마지막 저장</span>
                <strong>
                  {lastUpdatedLabel}
                  {businessPlanStatus.lastUpdatedBy ? ` / ${businessPlanStatus.lastUpdatedBy}` : ''}
                </strong>
                <span>마지막 확인</span>
                <strong>{lastVerifiedLabel}</strong>
              </div>

              {!businessPlanStatus.isAuthenticated ? (
                <div className="inline-controls plan-login-row">
                  <input
                    type="email"
                    value={loginEmail}
                    onChange={(event) => setLoginEmail(event.target.value)}
                    placeholder="company email"
                  />
                  <button type="button" onClick={handleRequestLogin} className="quiet-button">
                    로그인 링크 받기
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => void onSignOutPlanAccess()} className="quiet-button">
                  로그아웃
                </button>
              )}

              {!businessPlanStatus.canEdit ? (
                <p className="inline-notice warning-notice">
                  현재 계정은 읽기 전용입니다. 운영 기준을 바꾸려면 편집 권한이 있는 계정으로 로그인해 주세요.
                </p>
              ) : null}
              {authMessage ? <p className="table-help">{authMessage}</p> : null}
              {saveMessage ? (
                <p className={`inline-notice ${saveMessage.tone}-notice`}>{saveMessage.text}</p>
              ) : null}
              {!saveMessage && businessPlanStatus.lastSaveMessage ? (
                <p className={`inline-notice ${businessPlanStatus.lastSaveStatus === 'verified' ? 'success' : businessPlanStatus.lastSaveStatus === 'unverified' ? 'warning' : businessPlanStatus.lastSaveStatus === 'failed' ? 'error' : 'info'}-notice`}>
                  {businessPlanStatus.lastSaveMessage}
                </p>
              ) : null}
              {businessPlanStatus.error ? (
                <p className="table-help error-text">{businessPlanStatus.error}</p>
              ) : null}
            </div>

            <div className="table-scroll" style={{ margin: '16px 0' }}>
              <table className="dense-table" style={{ minWidth: '100%' }}>
                <thead>
                  <tr>
                    <th>통화</th>
                    <th>선행 평균</th>
                    <th>이동 평균</th>
                  </tr>
                </thead>
                <tbody>
                  {TARGET_CURRENCIES.map((currency) => renderCurrencyRow(currency, true))}
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'center', color: '#667085' }}>
                      기타 통화
                    </td>
                  </tr>
                  {REST_CURRENCIES.map((currency) => renderCurrencyRow(currency, false))}
                </tbody>
              </table>
            </div>
            <div className="inline-controls" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" onClick={() => setIsModalOpen(false)} className="quiet-button">
                닫기
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="header-refresh-button"
                disabled={!businessPlanStatus.canEdit || businessPlanStatus.saving}
              >
                {businessPlanStatus.saving ? '저장 중' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default MovingComparison
