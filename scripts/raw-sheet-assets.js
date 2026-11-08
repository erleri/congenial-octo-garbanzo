// Build-derived previews; source workbook JSON remains untouched and old URLs survive.
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
export function buildRawSheetAssets(data){
 if(!Array.isArray(data?.rawSheets)||!data.rawSheets.length||new Set(data.rawSheets.map(s=>s.name)).size!==data.rawSheets.length)throw Error('invalid_raw_sheets')
 const compact=JSON.stringify(data),sourceHash=createHash('sha256').update(compact).digest('hex')
 const previews=data.rawSheets.map((s,i)=>{
  if(typeof s.name!=='string'||!Array.isArray(s.headers)||s.headers.some(h=>typeof h!=='string')||!Array.isArray(s.rows))throw Error('invalid_raw_sheet')
  return {url:`/raw-sheet-previews/${sourceHash}/${i}.json`,body:JSON.stringify({name:s.name,headers:s.headers,rows:s.rows.slice(0,50),sourceHash,totalRows:s.rows.length})}
 })
 const catalog={version:'raw-sheet-catalog/1',sourceHash,previewRows:50,sheets:data.rawSheets.map((s,i)=>({name:s.name,headers:s.headers,totalRows:s.rows.length,previewUrl:previews[i].url}))}
 return {compact,catalog,previews}
}
export function rawSheetAssetsPlugin(){
 let config,assets,cachedMtime
 const load=async()=>{
  const source=path.resolve(config.root,'public/raw-sheets.json'),stat=await fs.stat(source)
  if(!assets||stat.mtimeMs!==cachedMtime){assets=buildRawSheetAssets(JSON.parse(await fs.readFile(source,'utf8')));cachedMtime=stat.mtimeMs}
  return assets
 }
 return {name:'raw-sheet-derived-previews',configResolved(c){config=c},
  configureServer(server){server.middlewares.use(async(req,res,next)=>{
   const url=new URL(req.url??'/','http://127.0.0.1')
   if(url.pathname!=='/raw-sheets-index.json'&&!url.pathname.startsWith('/raw-sheet-previews/')){next();return}
   if(req.method!=='GET'&&req.method!=='HEAD'){res.statusCode=405;res.end();return}
   try{const a=await load(),body=url.pathname==='/raw-sheets-index.json'?JSON.stringify(a.catalog):a.previews.find(p=>p.url===url.pathname)?.body
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control',url.pathname==='/raw-sheets-index.json'?'no-store':'public, max-age=31536000, immutable')
    if(body===undefined){res.statusCode=404;res.end('{}');return}
    res.setHeader('Content-Length',Buffer.byteLength(body));res.end(req.method==='HEAD'?undefined:body)
   }catch{res.statusCode=503;res.end('{"error":"raw_preview_unavailable"}')}
  })},
  async generateBundle(){const a=await load();for(const p of a.previews)this.emitFile({type:'asset',fileName:p.url.slice(1),source:p.body});this.emitFile({type:'asset',fileName:'raw-sheets-index.json',source:JSON.stringify(a.catalog)})},
  async writeBundle(){
   const a=await load(),out=path.resolve(config.root,config.build.outDir),file=path.join(out,'raw-sheets.json')
   if(out===config.root||!file.startsWith(out+path.sep))throw Error('invalid_build_output')
   // Preserve the legacy full-download URL; only whitespace is removed in the build copy.
   await fs.writeFile(file,a.compact)
  }}
}
