import {it,expect} from 'vitest'
import {readOfficialJson} from './official-json-envelope.js'
import {parseRegisteredStatistic} from './registered-material-adapters.js'

const body={config:{series:[{name:'Tarjeta de Crédito'},{name:'Hasta 360 días'},{name:'Más 360 días'}]},periods:[{name:'Oct.2026',values:['65.03','66.79','18.48']}]}
const notice=`<br />\n<font size='1'><table class='xdebug-error xe-notice' dir='ltr'><tr><th>Notice: Undefined offset: 1 in /var/www/html/estadisticas/application/views/scripts/api/index.phtml on line <i>900</i></th></tr><tr><td>Call Stack {main}</td></tr></table></font>\n`
it('recovers a complete registered JSON document only with a recognized non-data notice, retaining audit warning without diagnostic prose',()=>{
 const plain=JSON.stringify(body),text=plain+notice
 expect(readOfficialJson(plain,null)).toEqual({body,warnings:[]})
 const parsed=readOfficialJson(text,'bcrp')
 expect(parsed.body).toEqual(body)
 expect(parsed.warnings).toEqual([{code:'provider_php_notice_trailer',envelopeVersion:'official-json-envelope/1',bytes:Buffer.byteLength(notice),sha256:expect.stringMatching(/^[a-f0-9]{64}$/)}])
 expect(JSON.stringify(parsed)).not.toContain('/var/www')
 const result=parseRegisteredStatistic({kind:'bcrp_credit_json'},text,'2026-11-08')
 expect(result.observations.map(o=>o.value)).toEqual([65.03,66.79,18.48])
 expect(result.transportWarnings).toEqual(parsed.warnings)
})
it('rejects unsupported providers, arbitrary HTML, second payloads, scripts, fatal errors and truncated documents',()=>{
 const plain=JSON.stringify(body)
 for(const trailer of ['<html>error</html>',notice+'{}',notice.replace('Call Stack','<script>alert(1)</script>Call Stack'),notice.replace('Notice: Undefined offset:','Fatal error:'),notice.replace('Call Stack','Call Stack {"periods":[]}')]){
  expect(()=>readOfficialJson(plain+trailer,'bcrp')).toThrow()
 }
 expect(()=>readOfficialJson(plain+notice,null)).toThrow('official_json_invalid')
 expect(()=>readOfficialJson(plain.slice(0,-1)+notice,'bcrp')).toThrow('official_json_invalid')
 expect(()=>readOfficialJson('{"periods":[]}'+notice,'bcrp')).toThrow('official_json_schema_changed')
})
it('keeps definition and numeric validation after transport recovery rather than accepting a plausible prefix as an admission',()=>{
 const changed=structuredClone(body);changed.config.series[0].name='Other interest rate'
 expect(()=>parseRegisteredStatistic({kind:'bcrp_credit_json'},JSON.stringify(changed)+notice,'2026-11-08')).toThrow('bcrp_series_schema_changed')
 const future=structuredClone(body);future.periods[0].name='Dic.2026'
 expect(parseRegisteredStatistic({kind:'bcrp_credit_json'},JSON.stringify(future)+notice,'2026-11-08').observations).toEqual([])
})
