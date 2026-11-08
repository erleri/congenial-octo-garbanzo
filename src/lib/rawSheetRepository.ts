import type {RawSheet,RawSheetsDataset} from '../types/exchangeRate'
import type {RawSheetCatalog} from '../types/rawSheets'
import {fetchRawSheetsDataset} from './staticDataset'
function validCatalog(data:unknown):data is RawSheetCatalog{
 const c=data as RawSheetCatalog
 return c?.version==='raw-sheet-catalog/1'&&/^[a-f0-9]{64}$/.test(c.sourceHash)&&c.previewRows===50&&Array.isArray(c.sheets)&&c.sheets.length<=64
  &&new Set(c.sheets.map(s=>s.name)).size===c.sheets.length&&c.sheets.every((s,i)=>typeof s.name==='string'&&Array.isArray(s.headers)
   &&s.headers.every(h=>typeof h==='string')&&Number.isInteger(s.totalRows)&&s.totalRows>=0&&s.previewUrl===`/raw-sheet-previews/${c.sourceHash}/${i}.json`)
}
export async function loadRawSheetCatalog(signal?:AbortSignal):Promise<{catalog:RawSheetCatalog|null;legacy:RawSheetsDataset|null}>{
 const r=await fetch('/raw-sheets-index.json',{signal,cache:'no-store'})
 // A previous deployment may have no catalog; keep its full-data contract usable.
 if(r.status===404||r.status===410||r.ok&&(r.headers.get('content-type')??'').includes('text/html')){
  const legacy=await fetchRawSheetsDataset();if(!legacy)throw Error('원본 자료를 불러오지 못했습니다.')
  return {catalog:null,legacy}
 }
 if(!r.ok)throw Error('원본 목록을 불러오지 못했습니다.')
 const catalog:unknown=await r.json();if(!validCatalog(catalog))throw Error('원본 목록 형식을 확인하지 못했습니다.')
 return {catalog,legacy:null}
}
export async function loadRawSheetPreview(catalog:RawSheetCatalog,name:string,signal?:AbortSignal):Promise<RawSheet>{
 if(!validCatalog(catalog))throw Error('invalid_raw_catalog')
 const entry=catalog.sheets.find(s=>s.name===name);if(!entry)throw Error('unknown_raw_sheet')
 const r=await fetch(entry.previewUrl,{signal,cache:'force-cache'});if(!r.ok)throw Error('원본 미리보기를 불러오지 못했습니다.')
 const p=await r.json()
 if(p.sourceHash!==catalog.sourceHash||p.name!==name||p.totalRows!==entry.totalRows||JSON.stringify(p.headers)!==JSON.stringify(entry.headers)
  ||!Array.isArray(p.rows)||p.rows.length!==Math.min(catalog.previewRows,entry.totalRows))throw Error('원본 자료의 버전이 달라 다시 열어야 합니다.')
 return {name,headers:p.headers,rows:p.rows}
}
export async function loadRawSheetExport(catalog:RawSheetCatalog,name:string):Promise<RawSheet>{
 if(!validCatalog(catalog))throw Error('invalid_raw_catalog')
 const data=await fetchRawSheetsDataset();if(!data)throw Error('CSV 원본 자료를 불러오지 못했습니다.')
 const bytes=new TextEncoder().encode(JSON.stringify(data)),hash=await crypto.subtle.digest('SHA-256',bytes)
 const actual=[...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join('')
 if(actual!==catalog.sourceHash)throw Error('원본 자료가 갱신되었습니다. 목록을 다시 열어 주세요.')
 const sheet=data.rawSheets.find(s=>s.name===name);if(!sheet)throw Error('unknown_raw_sheet')
 return sheet
}
