// Decode one registered API document, never arbitrary HTML or a second JSON.
// Raw bytes/hashes remain unchanged. Known non-data PHP notice trailers are
// recorded as warnings, not silently presented as clean transport responses.
import {createHash} from 'node:crypto'

export const OFFICIAL_JSON_ENVELOPE_VERSION='official-json-envelope/1'
export function readOfficialJson(text,provider) {
 if(typeof text!=='string'||Buffer.byteLength(text)>2_000_000)throw Error('official_json_size_invalid')
 try{return {body:JSON.parse(text),warnings:[]}}catch{/* A strict registered envelope may be inspected below. */}
 if(provider!=='bcrp')throw Error('official_json_invalid')
 const start=text.search(/\S/)
 if(text[start]!=='{')throw Error('official_json_invalid')
 let depth=0,inString=false,escaped=false,end=-1
 for(let i=start;i<text.length;i++){
  const c=text[i]
  if(inString){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;continue}
  if(c==='"')inString=true
  else if(c==='{'||c==='[')depth++
  else if(c==='}'||c===']'){depth--;if(depth===0){end=i+1;break}}
 }
 if(end<0)throw Error('official_json_invalid')
 const trailer=text.slice(end),bodyText=text.slice(start,end)
 // This is a provider format rule, not a numeric/topic/date exception. Do not
 // salvage generic errors, challenges, scripts, extra data or truncated JSON.
 if(Buffer.byteLength(trailer)>16000||!/^\s*<br\s*\/>\s*<font size=['"]1['"]><table class=['"]xdebug-error xe-notice['"][^>]*>[\s\S]*<\/table><\/font>\s*$/i.test(trailer)
  ||[...trailer.matchAll(/<\/?([a-z][a-z0-9]*)\b/gi)].some(m=>!['br','font','table','tr','th','span','i','td','b'].includes(m[1].toLowerCase()))
  ||[...trailer.matchAll(/<table\b/gi)].length!==1
  ||!trailer.includes('Notice: Undefined offset:')||!trailer.includes('Call Stack')
  ||!trailer.includes('/estadisticas/application/views/scripts/api/index.phtml')
  ||/Fatal error|Warning:|Parse error|"(?:config|periods|series|values)"\s*:/i.test(trailer)
  ||/[{}]/.test(trailer.replaceAll('{main}','')))throw Error('official_json_trailer_unrecognized')
 let body
 try{body=JSON.parse(bodyText)}catch{throw Error('official_json_invalid')}
 if(!body||Object.keys(body).sort().join(',')!=='config,periods')throw Error('official_json_schema_changed')
 return {body,warnings:[{code:'provider_php_notice_trailer',envelopeVersion:OFFICIAL_JSON_ENVELOPE_VERSION,
  bytes:Buffer.byteLength(trailer),sha256:createHash('sha256').update(trailer).digest('hex')}]}
}
