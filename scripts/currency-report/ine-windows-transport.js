// Explicit local transport for hosts where Node TLS fails. Never an automatic
// production fallback. Windows IWR checks size after buffering (recorded below).
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { CHILE_MONTHLY_SOURCES, monthlyPdfUrl } from './chile-monthly-originals.js'
const exec = promisify(execFile)

export function createIneWindowsTransport(powershell) {
  if (typeof powershell !== 'string' || !/pwsh\.exe$/i.test(powershell)) throw new Error('explicit_pwsh_required')
  const requests = []
  const fetchImpl = async (raw, options = {}) => {
    const url = String(raw)
    if (!CHILE_MONTHLY_SOURCES.some(s => s.url === url)) {
      if (!CHILE_MONTHLY_SOURCES.some(s => { try { return monthlyPdfUrl(url,s.id) === url } catch { return false } }))
        throw new Error('unregistered_ine_request')
    }
    if (requests.length >= 6) throw new Error('ine_request_limit')
    const row = {url,status:'reserved'}; requests.push(row)
    try {
      const {stdout} = await exec(powershell,['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./read-ine-public.ps1',import.meta.url)),'-Url',url],
        {timeout:20000,maxBuffer:3000000,windowsHide:true,encoding:'utf8',signal:options.signal})
      const response = JSON.parse(stdout.replace(/^\uFEFF/,''))
      row.status = response.error ? 'failed' : 'returned'; row.httpStatus = response.status
      if (response.error || !Number.isInteger(response.status) || response.status < 200 || response.status > 599)
        throw new Error('windows_public_read_failed')
      const body = Buffer.from(response.bodyBase64,'base64')
      if (body.length > 2_000_000) throw new Error('oversize')
      row.bytes = body.length
      return new Response(body,{status:response.status,headers:{'content-type':response.contentType,'content-length':String(body.length)}})
    } catch { row.status = 'failed'; throw new Error('ine_windows_transport_failed') }
  }
  return {fetchImpl,requests,mode:'windows_public_compatibility',sizeBound:'post_download_not_streaming'}
}
