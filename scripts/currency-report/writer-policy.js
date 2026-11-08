// Local report writer selection. Policy ceilings reuse saved trial settings;
// they are not current advertised prices or execution/endpoint authorization.
import {generationWire,GENERATION_WIRE_INSTRUCTIONS,assertGenerationWireRequest} from './generation-wire.js'
import {requestTokenBound} from './request-budget.js'

export const WRITER_POLICY_VERSION='local-writer-policy/2'
export const DEFAULT_WRITER='sol'
const profiles={
 sol:{model:'openai/gpt-6.1-sol',route:'azure',outputField:'max_completion_tokens',prompt:2,completion:10,inputReservation:2.5},
 'sol-us':{model:'openai/gpt-6.1-sol',route:'azure/us',outputField:'max_completion_tokens',prompt:2.2,completion:11,inputReservation:2.75},
 sonnet:{model:'anthropic/claude-sonnet-5.5',route:'google-vertex/global',outputField:'max_tokens',prompt:2,completion:10,inputReservation:4},
 argon:{model:'google/gemini-4-argon',route:'google-vertex/us',outputField:'max_tokens',prompt:2.2,completion:11,inputReservation:2.2},
}
export function writerProfile(selection=DEFAULT_WRITER,version=WRITER_POLICY_VERSION) {
 if(typeof selection!=='string'||!Object.hasOwn(profiles,selection))throw new Error('registered_writer_required')
 if(!['local-writer-policy/1',WRITER_POLICY_VERSION].includes(version))throw Error('registered_writer_version_required')
 const pricing=profiles[selection],outputTokens=8192,perCallUsd=.25
 // Byte reservation bound, not the provider's native-token context window.
 // Derive capacity from the existing cost ceiling; do not increase that ceiling.
 const inputTokens=version==='local-writer-policy/1'?44000:Math.floor((perCallUsd*1e6-outputTokens*pricing.completion)/pricing.inputReservation)
 return {version,selection,...pricing,reasoning:'medium',outputTokens,inputTokens,timeoutMs:120000,retries:0,perCallUsd}
}
function applyStructuredPolicy(request,selection,report) {
 const profile=writerProfile(selection),body=structuredClone(request)
 if(!body.response_format?.json_schema?.schema||body.tools?.length||body.plugins?.length)throw new Error('structured_writer_request_required')
 delete body.temperature;delete body.max_tokens;delete body.max_completion_tokens
 body.model=profile.model;body.reasoning={effort:profile.reasoning};body.stream=true;body[profile.outputField]=profile.outputTokens
 const wire=generationWire(body.response_format.json_schema.schema,profile.model)
 body.response_format.json_schema.schema=wire.schema
 const sent=JSON.parse(body.messages[1].content);sent.outputLayout=wire.contract
 body.messages[1].content=JSON.stringify(sent)
 if(report)body.messages[0].content+='\n'+GENERATION_WIRE_INSTRUCTIONS
 body.provider={only:[profile.route],require_parameters:true,zdr:true,data_collection:'deny',allow_fallbacks:false,
  max_price:{prompt:profile.prompt,completion:profile.completion}}
 assertWriterPolicy(body,profile)
 if(report)assertGenerationWireRequest(body,wire.contract)
 const inputBound=requestTokenBound(body),maximumUsd=writerReservation(body,profile)
 return {profile,body,outputContract:wire.contract,localOnlyOutputConstraints:wire.localOnlyConstraints,inputBound,maximumUsd,
  status:inputBound>profile.inputTokens||maximumUsd>profile.perCallUsd?'request_budget_hold':'prepared_not_called',
  timeoutMs:profile.timeoutMs,retries:0,paidCallAuthorized:false,publicationApproved:false}
}
export function applyWriterPolicy(request,selection=DEFAULT_WRITER) {
 return applyStructuredPolicy(request,selection,true)
}
// Same registered model/privacy/price policy; the sentence-review schema is
// not a report and must not inherit drivers/implications slot instructions.
export function applyReviewWriterPolicy(request,selection=DEFAULT_WRITER) {
 const selected=applyStructuredPolicy(request,selection,false)
 return {...selected,localSchema:structuredClone(request.response_format.json_schema.schema)}
}
export function assertWriterPolicy(body,record) {
 const profile=writerProfile(record?.selection,record?.version)
 if(JSON.stringify(record)!==JSON.stringify(profile)||body.model!==profile.model||body[profile.outputField]!==profile.outputTokens
  ||Object.hasOwn(body,profile.outputField==='max_tokens'?'max_completion_tokens':'max_tokens')
  ||body.reasoning?.effort!==profile.reasoning||body.temperature!==undefined||body.tools?.length||body.plugins?.length
  ||JSON.stringify(body.provider)!==JSON.stringify({only:[profile.route],require_parameters:true,zdr:true,data_collection:'deny',allow_fallbacks:false,
    max_price:{prompt:profile.prompt,completion:profile.completion}}))throw new Error('writer_policy_changed')
 return profile
}
export function writerReservation(body,profile) {
 assertWriterPolicy(body,profile)
 return Math.ceil((requestTokenBound(body)*profile.inputReservation+profile.outputTokens*profile.completion)/1e6*1e9)/1e9
}
// The caller supplies saved catalogs for offline tests or verified live catalogs
// immediately before a separately approved call. No network or keys here.
export function inspectWriterEndpoint(body,record,catalog,zdr) {
 const p=assertWriterPolicy(body,record),input=requestTokenBound(body)
 const e=catalog?.data?.endpoints?.find(e=>e.tag===p.route)
 const price=(v,max)=>v!=null&&Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=max/1e6
 if(!e||e.model_id!==p.model||e.status!==0||!zdr?.data?.some(x=>x.model_id===p.model&&x.tag===p.route)
  ||!['reasoning','response_format','structured_outputs',p.outputField].every(x=>e.supported_parameters?.includes(x))
  ||Object.keys(body).some(k=>!['model','messages','provider','stream'].includes(k)&&!e.supported_parameters?.includes(k))
  ||input>p.inputTokens||e.context_length<input+p.outputTokens||e.max_completion_tokens<p.outputTokens
  ||!price(e.pricing?.prompt,p.prompt)||!price(e.pricing?.completion,p.completion)
  ||!price(e.pricing?.internal_reasoning??e.pricing?.completion,p.completion)
  ||['input_cache_read','input_cache_write','input_cache_write_1h'].some(k=>e.pricing[k]!==undefined&&!price(e.pricing[k],p.inputReservation))
  ||Number(e.pricing?.request??0)!==0||e.pricing?.overrides?.some(x=>x.min_prompt_tokens<=input))throw new Error('writer_endpoint_privacy_support_or_price_hold')
 return {model:p.model,route:p.route,zdr:true,dataCollection:'deny',pricing:e.pricing,modelCalls:0}
}
