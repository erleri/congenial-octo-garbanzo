// Node-only credential-bearing JSON transport shared by the Mexico adapters.
// Payloads are transient; callers must project fields before any persistence.
export async function readOfficialJson({url,headers={},secrets,fetchImpl=fetch,timeoutMs=20000,maxBytes=1_000_000}) {
  const parsed=new URL(url)
  const allowed=parsed.hostname==='www.banxico.org.mx'&&parsed.pathname.startsWith('/SieAPIRest/service/v1/series/')
    ||parsed.hostname==='www.inegi.org.mx'&&parsed.pathname.startsWith('/app/api/indicadores/desarrolladores/jsonxml/')
  if(!allowed||parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||parsed.hash
    ||!Array.isArray(secrets)||!secrets.length||secrets.some(s=>typeof s!=='string'||!s)
    ||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>20000||!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>32_000_000)
    throw new Error('invalid_official_request')
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs)
  let reader,httpStatus=null
  const fail=status=>({status,httpStatus})
  try {
    const response=await fetchImpl(url,{redirect:'error',signal:controller.signal,headers:{Accept:'application/json',...headers}})
    httpStatus=response.status
    if(response.redirected||response.url&&response.url!==url)return fail('redirect_blocked')
    if(!response.ok)return fail(httpStatus===401?'authentication_failed':httpStatus===403?'access_denied':httpStatus===429?'rate_limited':httpStatus>=500?'provider_unavailable':'http_error')
    if(Number(response.headers.get('content-length'))>maxBytes)return fail('response_too_large')
    reader=response.body?.getReader()
    if(!reader)return fail('empty_body')
    const chunks=[];let size=0
    while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength
      if(size>maxBytes)return fail('response_too_large');chunks.push(Buffer.from(part.value))}
    const text=Buffer.concat(chunks).toString('utf8')
    if(secrets.some(secret=>text.includes(secret)||text.includes(encodeURIComponent(secret))))return fail('credential_echo_blocked')
    try{return {status:'ok',httpStatus,payload:JSON.parse(text.replace(/^\uFEFF/,''))}}
    catch{return fail('invalid_json')}
  }catch{return fail(controller.signal.aborted?'timeout':'connection_failed')}
  finally{clearTimeout(timer);controller.abort();if(reader)await reader.cancel().catch(()=>{})}
}
