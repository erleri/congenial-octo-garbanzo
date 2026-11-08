export interface ReviewValidation {
  storageRequired?: boolean
  storageComplete?: boolean
  contentReview?: string
  structureValid?: boolean
  criticalErrors?: number
  qualityAverage?: number | null
  evidenceScore?: number | null
  sourceUseReview?: {externalModel?:string;publicDisplay?:string}
}

// UX explanation only. The DB RPC remains the authorization and validation authority.
export function approvalBlockers(validation: ReviewValidation): string[] {
  const reasons: string[] = []
  if(validation.storageRequired===true&&validation.storageComplete!==true)reasons.push('자료 저장 완료 확인 필요')
  if(validation.sourceUseReview&&validation.sourceUseReview.publicDisplay!=='pass')reasons.push('출처 자료의 공개 사용 범위 확인 필요')
  if (validation.structureValid !== true) reasons.push('구조 검사 미통과')
  if (validation.contentReview !== 'passed') reasons.push('내용 검토 미완료')
  if (validation.criticalErrors !== 0) reasons.push('중대한 오류 0건 확인 필요')
  for (const [label, value] of [['품질 평균', validation.qualityAverage], ['근거 충실도', validation.evidenceScore]] as const) {
    if (typeof value !== 'number' || !Number.isFinite(value)) reasons.push(`${label} 미평가`)
    else if (value < 4 || value > 5) reasons.push(`${label} 승인 기준 미충족 (4~5점)`)
  }
  return reasons
}
