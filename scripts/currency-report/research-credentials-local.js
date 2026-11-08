// Server-only local setup. No provider calls, env fallback, token output or writes.
import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {parse} from 'dotenv'

const FIELDS=['BANXICO_SIE_TOKEN','INEGI_INDICATORS_TOKEN']
export function parseResearchTokenFile(raw) {
  if(typeof raw!=='string'||Buffer.byteLength(raw)>10_000)throw new Error('invalid_research_settings')
  const settings=parse(raw)
  if(Object.keys(settings).some(key=>!FIELDS.includes(key)))throw new Error('unexpected_research_setting')
  for(const name of FIELDS) {
    const assignments=[...raw.matchAll(/^\s*(?:export\s+)?([A-Za-z_][\w]*)\s*=/gm)].filter(match=>match[1]===name)
    if(assignments.length>1)throw new Error('duplicate_research_setting')
  }
  // These values are private in-memory credentials, never a printable result.
  return Object.fromEntries(FIELDS.map(name=>[name,settings[name]?.trim()??'']))
}

export function researchCredentialStatus(settings) {
  const state=(name,pattern)=>!settings[name]?'missing':pattern.test(settings[name])?'configured':'format_check_required'
  return {version:'research-credential-status/1',
    file:'.env.research.local',
    banxico:{state:state('BANXICO_SIE_TOKEN',/^[A-Za-z0-9]{64}$/),authentication:'not_tested'},
    inegi:{state:state('INEGI_INDICATORS_TOKEN',/^[A-Za-z0-9-]{20,128}$/),authentication:'not_tested'},
    networkCalls:0,modelCalls:0,newPaidCostUsd:0,productionChanged:false,
    limitation:'설정 여부와 기본 형식 확인이며 기관의 인증 성공이나 지표 연결 완료가 아닙니다.'}
}

export async function readLocalResearchTokens(workspace=process.cwd()) {
  const root=await fs.realpath(workspace),file=path.join(root,'.env.research.local')
  try {
    const stat=await fs.lstat(file)
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>10_000||await fs.realpath(file)!==file)throw new Error('unsafe_research_settings')
    return {exists:true,settings:parseResearchTokenFile(await fs.readFile(file,'utf8'))}
  }catch(error) {
    if(error.code==='ENOENT')return {exists:false,settings:parseResearchTokenFile('')}
    throw new Error('research_settings_unreadable_or_invalid')
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const {exists,settings}=await readLocalResearchTokens()
    const status=researchCredentialStatus(settings)
    console.log(JSON.stringify({...status,fileExists:exists},null,2))
  }catch {
    console.error('research_settings_check_failed: check the dedicated local file format; credential values are not displayed')
    process.exitCode=1
  }
}
