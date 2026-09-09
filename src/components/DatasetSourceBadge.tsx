import type { DatasetSource } from '../types/exchangeRate'

const BADGES: Record<DatasetSource, { label: string; style: string }> = {
  supabase: { label: '운영 데이터 확인됨', style: 'operational' },
  excel: { label: '로컬 임시 보기', style: 'local' },
  cache: { label: '로컬 캐시', style: 'local' },
  static: { label: '정적 배포 데이터', style: 'readonly' },
  remote: { label: '외부 API 조회', style: 'readonly' },
  none: { label: '데이터 미확인', style: 'readonly' },
}

export default function DatasetSourceBadge({ source }: { source: DatasetSource }) {
  const badge = BADGES[source]
  return <span className={`scope-badge scope-badge-${badge.style}`}>{badge.label}</span>
}
