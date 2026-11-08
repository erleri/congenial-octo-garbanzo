// Display only; the server admission and current reservation checks remain the
// authority. Do not present an old administrator action as current permission.
import type {SourcePolicy,SourceTerms} from '../../components/ReportSourceScopeManagement'
export function sourcePolicyStatus(policy:SourcePolicy,terms:SourceTerms|undefined,now:number){
 if(policy.action==='exclude')return '제외'
 if(policy.action==='hold')return '운영자 보류'
 if(policy.action==='prepare')return terms?.status==='available'&&terms.url===policy.termsUrl?'이용 조건 검토 대기':'이용 조건 확인 대기'
 if(!policy.expiresAt||Date.parse(policy.expiresAt)<=now)return '검토 기한 만료'
 if(!terms||terms.url!==policy.termsUrl||terms.status!=='available'||Date.parse(terms.checkedAt)>now||now-Date.parse(terms.checkedAt)>=86400000)return '이용 조건 재확인 대기'
 return terms.hash===policy.approvedTermsHash?'자동 적용 중':'이용 조건 변경 · 재검토 필요'
}
type Proof={currency:string;url:string;host:string;publisher:string|null;binding:string;captureHash:string;articleBinding?:string;status:string;reason:string;expiresAt:string;
 articleChecks?:{ownArticle:boolean;freeAccess:boolean;bodyVerified:boolean}}
type Decision={action:string;proofBinding:string;captureHash?:string;articleBinding?:string}
export function sourceArticleStatus(proof:Proof,decision:Decision|undefined,policies:SourcePolicy[],terms:SourceTerms[],now:number){
 if(decision?.action==='exclude')return '운영자 제외'
 if(decision?.action==='hold')return '운영자 보류'
 if(Date.parse(proof.expiresAt)<=now)return '기한 만료'
 if(proof.status==='exclude')return '접근·처리 조건 미충족'
 if(decision?.action==='apply'&&decision.proofBinding!==proof.binding&&decision.captureHash!==proof.captureHash
  &&(!proof.articleBinding||decision.articleBinding!==proof.articleBinding))return '근거 변경 · 재확인 필요'
 const policy=policies.filter(p=>p.currency===proof.currency&&p.host===proof.host&&new URL(proof.url).pathname.startsWith(p.pathPrefix))
  .sort((a,b)=>b.pathPrefix.length-a.pathPrefix.length)[0]
 if(policy){
  const status=sourcePolicyStatus(policy,terms.find(t=>t.policyId===policy.id),now)
  if(status!=='자동 적용 중')return `매체 기준: ${status}`
  if(proof.publisher!==policy.publisher||!proof.articleChecks?.ownArticle||!proof.articleChecks.freeAccess||!proof.articleChecks.bodyVerified
   ||!['explicit_article_license_matches_policy','use_scope_unconfirmed','conflicting_or_third_party_rights'].includes(proof.reason))return '매체 기준 범위 밖 · 기사 확인 필요'
  return '매체 기준 적용 대상'
 }
 return decision?.action==='apply'?'기사별 기준 적용 대상':proof.status==='eligible'?'공통 기준 자동 적용 대상':'검토 대기'
}
