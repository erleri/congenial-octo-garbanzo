import {withConnectionDeadline} from './connection-deadline'

// A timeout is an unknown write result, never permission to submit again.
export function createReviewActionGate(milliseconds=15_000) {
  let busy=false
  return {
    get busy(){return busy},
    async run<T>(operation:(signal:AbortSignal)=>PromiseLike<T>):Promise<{state:'received';value:T}|{state:'busy'|'unknown'}>{
      if(busy)return {state:'busy'}
      busy=true
      try{return {state:'received',value:await withConnectionDeadline(operation,milliseconds)}}
      catch{return {state:'unknown'}}
      finally{busy=false}
    },
  }
}
export function reviewFailureMessage(error:{code?:string;message?:string}):string {
  if(error.code==='42501')return '관리자 권한을 다시 확인해 주세요.'
  if(error.code==='55000')return '공개 판본·검토 버전 또는 저장 확인이 달라졌습니다. 현재 상태를 다시 읽은 뒤 확인해 주세요.'
  if(error.code==='22023'&&error.message==='invalid public field type')return '공개용 숫자·날짜 형식 검사에서 거부됐습니다. 원고는 보존됐으며 운영 코드 확인이 필요합니다.'
  if(error.code==='22023')return '승인에 필요한 내용·형식 검사를 통과하지 못했습니다. 아래 검증 결과를 확인해 주세요.'
  return '처리하지 못했습니다. 원고는 유지되며 현재 상태를 다시 확인해 주세요.'
}
