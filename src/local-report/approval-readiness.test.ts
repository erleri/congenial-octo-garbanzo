import { expect, it } from 'vitest'
import { approvalBlockers } from './approval-readiness'

it('explains unscored content without assigning a passing score', () => {
  expect(approvalBlockers({ structureValid: true, contentReview: 'unverified', criticalErrors: 0, qualityAverage: null, evidenceScore: null }))
    .toEqual(['내용 검토 미완료', '품질 평균 미평가', '근거 충실도 미평가'])
})
it('explains a completed review whose cause score fails even when its average passes',()=>{
 expect(approvalBlockers({structureValid:true,contentReview:'unverified',criticalErrors:0,qualityAverage:4,evidenceScore:5,review:{scores:{cause:3}}}))
  .toEqual(['내용 검토 기준 미달','원인 설명 3점 · 필수 4~5점'])
})
it('keeps structural, material-error and score failures distinct', () => {
  expect(approvalBlockers({ structureValid: false, contentReview: 'passed', criticalErrors: 1, qualityAverage: 3.9, evidenceScore: 5.1 }))
    .toEqual(['구조 검사 미통과', '중대한 오류 0건 확인 필요', '품질 평균 승인 기준 미충족 (4~5점)', '근거 충실도 승인 기준 미충족 (4~5점)'])
})
it('accepts boundary scores only with completed checks and rejects nonfinite values', () => {
  const valid = { structureValid: true, contentReview: 'passed', criticalErrors: 0, qualityAverage: 4, evidenceScore: 5 }
  expect(approvalBlockers(valid)).toEqual([])
  expect(approvalBlockers({ ...valid, qualityAverage: NaN, evidenceScore: Infinity })).toEqual(['품질 평균 미평가', '근거 충실도 미평가'])
})
it('holds managed drafts without a storage receipt while leaving legacy reviews compatible',()=>{
 const valid={structureValid:true,contentReview:'passed',criticalErrors:0,qualityAverage:4,evidenceScore:4}
 expect(approvalBlockers({...valid,storageRequired:true,storageComplete:false})).toEqual(['자료 저장 완료 확인 필요'])
 expect(approvalBlockers({...valid,storageRequired:true,storageComplete:true})).toEqual([])
})
it('does not treat model-input permission as public-display permission',()=>{
 const valid={structureValid:true,contentReview:'passed',criticalErrors:0,qualityAverage:4,evidenceScore:4}
 expect(approvalBlockers({...valid,sourceUseReview:{externalModel:'pass',publicDisplay:'unverified'}}))
  .toEqual(['출처 자료의 공개 사용 범위 확인 필요'])
 expect(approvalBlockers({...valid,sourceUseReview:{externalModel:'pass',publicDisplay:'pass'}})).toEqual([])
})
