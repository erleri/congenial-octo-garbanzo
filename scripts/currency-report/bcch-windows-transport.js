// Explicit local compatibility mode; never an automatic production fallback.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { bcchPriceUrl } from './clp-official-price.js'
const exec = promisify(execFile)
export function createBcchWindowsTransport(powershell) {
  if (typeof powershell !== 'string' || !/pwsh\.exe$/i.test(powershell)) throw new Error('explicit_pwsh_required')
  const requests = []
  return {requests,mode:'windows_public_compatibility',sizeBound:'post_download_not_streaming',fetchImpl:async (raw,options={}) => {
    const url = bcchPriceUrl(String(raw))
    if (requests.length >= 2) throw new Error('bcch_request_limit')
    const row={url,status:'reserved'};requests.push(row)
    try {
      const {stdout}=await exec(powershell,['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./read-bcch-public.ps1',import.meta.url)),'-Url',url],
        {timeout:20000,maxBuffer:3000000,windowsHide:true,encoding:'utf8',signal:options.signal})
      const r=JSON.parse(stdout.replace(/^\uFEFF/,''))
      if (r.error || !Number.isInteger(r.status) || r.status < 200 || r.status > 599) throw new Error('bcch_windows_read_failed')
      const body=Buffer.from(r.bodyBase64,'base64')
      if (body.length > 2_000_000) throw new Error('oversize')
      row.status='returned';row.bytes=body.length;row.httpStatus=r.status
      return new Response(body,{status:r.status,headers:{'content-type':r.contentType,'content-length':String(body.length)}})
    } catch {row.status='failed';throw new Error('bcch_windows_read_failed')}
  }}
}
