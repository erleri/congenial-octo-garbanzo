// One question contract for all six countries. A valid product supports only
// its registered topic, never every aspect of national consumption or FX cause.
export const OFFICIAL_BACKGROUND_QUESTIONS=Object.freeze([
 {id:'retail_conditions',metrics:['retail'],label:'조사 대상 소매·구매 활동'},
 {id:'purchasing_power',metrics:['consumer_prices','real_pay'],label:'물가·실질소득의 구매 여건'},
 {id:'financing_conditions',metrics:['consumer_credit','policy_target_rate'],label:'정의된 상품·정책의 금융 여건'},
])
export function officialBackgroundCoverage(admission){
 const sources=admission?.admitted??[]
 const questions=OFFICIAL_BACKGROUND_QUESTIONS.map(q=>({id:q.id,label:q.label,
  status:sources.some(s=>q.metrics.includes(s.scope.metric))?'registered_numeric_context_available':'not_verified_in_this_input',
  seriesIds:sources.filter(s=>q.metrics.includes(s.scope.metric)).map(s=>s.seriesId)}))
 return {version:'official-background-coverage/1',currency:admission.currency,questions,
  minimumRule:'official_numeric_context_requires_one_verified_topic;other_reviewed_background_remains_valid;market_explanations_require_separate_market_evidence',
  numericContextAvailable:questions.some(q=>q.status==='registered_numeric_context_available'),
  completeConsumerPicture:false,directFxCauseAllowed:false,contentReview:'pending',publicationApproved:false}
}
