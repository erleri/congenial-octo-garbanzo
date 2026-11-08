// Read-only local status projection. No credentials, remote probes or API URLs.
import fs from 'node:fs/promises'
import path from 'node:path'
import {validDate} from './core.js'
import {INEGI_REPORT_INDICATORS,verifyInegiReportSeries} from './inegi-report-indicators.js'

export const API_SERVICES=Object.freeze([
  {id:'exchange-rate-api',name:'ExchangeRate-API',kind:'환율 API',role:'최신 환율 수집 경로',stage:'기존 코드'},
  {id:'frankfurter',name:'Frankfurter',kind:'환율 API',role:'지원 통화의 과거 환율 경로',stage:'기존 코드'},
  {id:'open-er',name:'Open ER API',kind:'환율 API',role:'최신 환율 보조 경로',stage:'기존 코드'},
  {id:'currency-api',name:'Currency API',kind:'환율 API',role:'최신·과거 스냅샷 보조 경로',stage:'기존 코드'},
  {id:'alpha-fx',name:'Alpha Vantage · FX_DAILY',kind:'환율 API',role:'일별 환율 이력 수집',stage:'기존 코드'},
  {id:'alpha-news',name:'Alpha Vantage · 뉴스',kind:'뉴스 API',role:'시장 배경 뉴스 수집',stage:'기존 코드'},
  {id:'supabase',name:'Supabase',kind:'저장·조회',role:'환율·계획환율·리포트 저장과 조회',stage:'기존 코드'},
  {id:'bcch',name:'BCCh',kind:'설명자료 API',role:'칠레 리포트 전용 공식 환율 확인',stage:'로컬 연결'},
  {id:'bcb',name:'BCB SGS',kind:'설명자료 API',role:'브라질 정책금리',stage:'로컬 연결'},
  {id:'ibge',name:'IBGE',kind:'설명자료 API',role:'브라질 소매 통계',stage:'로컬 연결'},
  {id:'banxico',name:'Banxico SIE',kind:'설명자료 API',role:'멕시코 정책금리 · 실제 대출금리는 별도 선정',stage:'로컬 점검'},
  {id:'inegi',name:'INEGI',kind:'설명자료 API',role:'멕시코 통계 · 현재 공식 예제로 인증 확인',stage:'로컬 점검'},
  ...INEGI_REPORT_INDICATORS.map(d=>({id:`inegi-${d.id}`,name:`INEGI · ${d.label}`,kind:'설명자료 API',role:d.limitation,stage:'로컬 수집·근거 검토'})),
  {id:'bcrp',name:'BCRPData',kind:'설명자료 API',role:'페루 상품·만기별 소비자금리',stage:'로컬 연결'},
  {id:'sfc',name:'SFC · datos.gov.co',kind:'설명자료 API',role:'콜롬비아 대출금리·실행액 원자료',stage:'로컬 연결'},
  {id:'publisher-pages',name:'국가별 언론·공식 문서',kind:'공개 페이지',role:'기사·정책 성명·통계 PDF · 개별 출처 검토 필요',stage:'로컬 연결'},
  {id:'openrouter',name:'OpenRouter',kind:'AI API',role:'리포트 집필·선택적 검색 · 유료 실행은 별도',stage:'로컬 연결'},
])
export const API_FAILURES=Object.freeze(['missing_credentials','invalid_local_format','authentication_failed','access_denied','rate_limited',
  'provider_unavailable','http_error','redirect_blocked','response_too_large','empty_body','credential_echo_blocked','invalid_json','provider_rejected',
  'schema_changed','empty_result','values_missing','timeout','connection_failed','definition_mismatch','missing_or_invalid_credentials'])
const timestamp=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T.*Z$/.test(v)&&validDate(v.slice(0,10))&&Number.isFinite(Date.parse(v))
const sampleVerified=c=>c.status==='ok'&&c.authentication==='accepted'&&c.dataStatus==='verified_response'&&c.httpStatus===200
  &&c.seriesId===(c.provider==='banxico'?'SF61745':'1002000001')&&Array.isArray(c.observations)&&c.observations.length>0&&c.observations.length<=24
  &&c.observations.some(o=>Number.isFinite(o.value)&&typeof o.period==='string'&&/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(o.period))

export function projectApiHealth(runs=[],now=new Date().toISOString()) {
  if(!Array.isArray(runs)||runs.length>100||!timestamp(now))throw new Error('invalid_health_inputs')
  const checks=runs.flatMap(run=>{
    if(!Array.isArray(run?.checks))return []
    if(run.version==='mexico-api-local-check/1')return run.checks.filter(c=>['banxico','inegi'].includes(c?.provider)).map(c=>({...c,healthId:c.provider}))
    if(run.version!=='inegi-report-local-check/1'||run.mode!=='live')return []
    return run.checks.flatMap(c=>{
      const definition=INEGI_REPORT_INDICATORS.find(d=>d.indicatorId===c?.seriesId)
      if(!definition)return []
      try {return [{...verifyInegiReportSeries(c),healthId:`inegi-${definition.id}`}]}catch{return []}
    })
  }).filter(c=>timestamp(c.checkedAt)&&Date.parse(c.checkedAt)<=Date.parse(now)
      &&(c.status==='ok'||API_FAILURES.includes(c.status)))
  const providers=API_SERVICES.map(service=>{
    const definition=INEGI_REPORT_INDICATORS.find(d=>`inegi-${d.id}`===service.id)
    const verified=c=>definition?c.status==='ok'&&c.dataStatus==='verified_report_series':sampleVerified(c)
    const history=checks.filter(c=>c.healthId===service.id).sort((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt)),latest=history[0]
    const success=history.find(verified)
    const ok=latest&&verified(latest)
    const source=definition?.indicatorId??(service.id==='banxico'?'SF61745':'1002000001')
    return {...service,status:!latest?'not_checked':ok?'sample_ok':['missing_credentials','missing_or_invalid_credentials'].includes(latest.status)?'needs_configuration':'check_failed',
      checkedAt:latest?.checkedAt??null,lastSuccessAt:success?.checkedAt??null,
      outdated:latest?Date.parse(now)-Date.parse(latest.checkedAt)>86400000:false,
      errorType:latest&&!ok?(API_FAILURES.includes(latest.status)?latest.status:'schema_changed'):null,
      authentication:latest&&['accepted','rejected','unknown','not_tested','not_configured'].includes(latest.authentication)?latest.authentication:'not_tested',
      sample:ok?{seriesId:source,observationCount:Array.isArray(latest.observations)?Math.min(latest.observations.length,definition?25:24):0,
        ...(definition?{latestPeriod:latest.observations.at(-1)?.period??null}:{}),
        use:definition?'통계 응답·계열 정의 확인 · 내용·이용 범위·발표시각 검토는 별도':service.id==='inegi'?'인증 확인용 인구 예제 · 리포트에 사용하지 않음':'정책금리 표본 · 발표시각·소비자금리와 구분'}:null}
  })
  return {version:'local-api-health/1',scope:'local_saved_checks',generatedAt:now,providers,
    limitation:'코드에 정의된 연결 목록과 저장된 로컬 점검 결과입니다. 현재 운영에서 선택한 경로나 서비스 전체의 실시간 정상 여부를 보증하지 않습니다.'}
}

export async function readLocalApiHealth(workspace=process.cwd()) {
  const root=await fs.realpath(workspace),directory=path.join(root,'.local-reports','private','mexico-api-checks'),runs=[]
  try {
    if(await fs.realpath(directory)!==directory)throw new Error('unsafe_health_directory')
    const names=(await fs.readdir(directory)).filter(name=>/^check-[A-Za-z0-9]+$/.test(name))
    if(names.length>100)throw new Error('health_history_limit')
    for(const name of names) {
      const file=path.join(directory,name,'result.json')
      try {
        if(await fs.realpath(file)!==file)continue
        const stat=await fs.lstat(file)
        if(!stat.isFile()||stat.size>100_000)continue
        runs.push(JSON.parse(await fs.readFile(file,'utf8')))
      }catch{/* A partial run is not a healthy completed check. */}
    }
  }catch(error){if(error.code!=='ENOENT')throw new Error('health_history_unavailable')}
  return projectApiHealth(runs)
}
