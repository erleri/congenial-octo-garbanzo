// Read-only inventory of sources. No external calls, deletion or secret loading.
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import ts from 'typescript'

const root=process.cwd(),out=path.join(root,'.local-reports/private/maintenance-20261104')
const files=[]
async function walk(relative){
 for(const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})){
  const name=path.posix.join(relative,entry.name)
  if(entry.isSymbolicLink()||entry.name.startsWith('.env')||entry.name==='node_modules'||entry.name==='.git'||entry.name==='.local-reports'||entry.name.startsWith('dist'))continue
  if(entry.isDirectory())await walk(name)
  else files.push(name)
 }
}
await walk('')
const records=await Promise.all(files.map(async file=>{
 const bytes=await fs.readFile(path.join(root,file)),text=/\.(?:js|mjs|ts|tsx|md|json|yml|html|css)$/.test(file)?bytes.toString('utf8'):null
 return {file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),text}
}))
const known=new Set(files),edges=[]
for(const row of records.filter(r=>/\.(?:js|mjs|ts|tsx)$/.test(r.file))){
 for(const item of ts.preProcessFile(row.text,true,true).importedFiles){
  if(!item.fileName.startsWith('.'))continue
  const base=path.posix.normalize(path.posix.join(path.posix.dirname(row.file),item.fileName))
  const target=[base,...['.ts','.tsx','.js','.mjs','/index.ts','/index.js'].map(ext=>base+ext)].find(f=>known.has(f))
  if(target)edges.push({from:row.file,to:target})
 }
}
const entrypoints=['src/main.tsx','scripts/generate-data.ts','scripts/sync-fx-to-supabase.js','scripts/verify-fx-supabase.js',
 'scripts/compose-email.js','scripts/create-email-chart.js','scripts/send-dashboard-email.mjs','scripts/currency-report/operating-entry.js',
 'scripts/create-fx-report.js','scripts/persist-fx-report.js']
const reachable=new Set(entrypoints.filter(p=>known.has(p)))
let changed=true
while(changed){changed=false;for(const e of edges)if(reachable.has(e.from)&&!reachable.has(e.to)){reachable.add(e.to);changed=true}}
const code=records.filter(r=>/^(scripts|src|\.github)\//.test(r.file)&&r.text)
const docRows=records.filter(r=>r.file.startsWith('docs/')).map(r=>{
 const name=path.posix.basename(r.file)
 const refs=code.filter(c=>c.text.includes(r.file)||c.text.includes(name)).map(c=>c.file)
 const status=r.file.startsWith('docs/guide/')?'current_entry':refs.length?'code_referenced':'topic_or_historical_evidence'
 return {file:r.file,bytes:r.bytes,status,codeReferences:refs}
})
const groups=new Map()
for(const r of records){const key=r.sha256;groups.set(key,[...(groups.get(key)??[]),r.file])}
const result={version:'maintenance-inventory/1',entrypoints,edges,reachable:[...reachable].sort(),
 files:records.map(({text,...r})=>r),documents:docRows,identicalFiles:[...groups.values()].filter(g=>g.length>1),
 limitations:['Static import graph does not resolve every dynamic file read, CLI or external consumer.','No-reference is not authorization to delete.','Identical bytes do not imply identical ownership or lifecycle.'],
 externalCalls:0,deletions:0}
await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'inventory.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify({files:records.length,documents:docRows.length,staticEdges:edges.length,reachable:reachable.size,identicalGroups:result.identicalFiles.length,output:path.relative(root,out)}))
