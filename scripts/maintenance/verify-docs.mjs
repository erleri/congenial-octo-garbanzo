// Offline documentation verification; never imports runtime policy modules.
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const roots=['README.md','PROJECT_OVERVIEW.md','OPERATIONS_TODO.md','supabase/schema-proposals/README.md',
 'docs/2.0/common-report-rules.md','docs/2.0/editorial-standard.md','docs/2.0/publication-policy.md']
const slug=s=>s.toLowerCase().replace(/<[^>]*>/g,'').replace(/[^\p{L}\p{N}_\-\s]/gu,'').replace(/\s/g,'-')
export function anchors(text){
 const found=new Set([...text.matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1]));const counts=new Map()
 for(const m of text.replace(/```[\s\S]*?```/g,'').matchAll(/^#{1,6}\s+(.+)$/gm)){
  const id=slug(m[1]),n=counts.get(id)??0;found.add(n?`${id}-${n}`:id);counts.set(id,n+1)
 }
 return found
}
export function localTarget(file,raw){
 const link=raw.replace(/^<|>$/g,'')
 if(/^[a-z][a-z\d+.-]*:/i.test(link)||link.startsWith('//'))return null
 const [location,fragment]=link.split('#');const pathname=location.split('?')[0]
 return {resolved:path.resolve(path.dirname(file),decodeURIComponent(pathname||path.basename(file))),fragment:fragment?decodeURIComponent(fragment):null}
}
export function linksIn(text,html=false){
 return html?[...text.matchAll(/(?:href|src)=["']([^"']+)["']/g)].map(m=>m[1])
 :[...text.replace(/```[\s\S]*?```/g,'').matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)].map(m=>m[1])
}
async function checkFile(file,{checkAnchors=true}={}){
 const text=await fs.readFile(file,'utf8'),failures=[];let checked=0
 for(const raw of linksIn(text,file.endsWith('.html'))){
  let target;try{target=localTarget(file,raw)}catch{failures.push({file,link:raw,reason:'invalid_encoding'});continue}
  if(!target)continue
  checked++
  try{
   await fs.access(target.resolved)
   if(checkAnchors&&target.fragment&&/\.(md|html)$/.test(target.resolved)){
    if(!anchors(await fs.readFile(target.resolved,'utf8')).has(target.fragment))failures.push({file,link:raw,reason:'missing_anchor'})
   }
  }catch{failures.push({file,link:raw,reason:'missing_file'})}
 }
 return {checked,failures}
}
async function main(){
 if(process.argv.includes('--self-test')){
  assert(anchors('# 한글·제목\n## 같은 제목\n## 같은 제목\n<a id="keep"></a>').has('한글제목'))
  assert(anchors('## 같은 제목\n## 같은 제목').has('같은-제목-1'))
  assert(anchors('<a id="keep"></a>').has('keep'))
  assert.equal(localTarget('docs/a.md','https://example.com/x#y'),null)
  assert.equal(localTarget('docs/a.md','mailto:test@example.com'),null)
  assert.equal(localTarget('docs/a.md','#한글').resolved,path.resolve('docs/a.md'))
  assert.equal(localTarget('docs/a.md','b%20c.md#ok').resolved,path.resolve('docs/b c.md'))
  assert.deepEqual(linksIn('![x](a.png) [y](b.md#z)\n```\n[x](ignored)\n```'),['a.png','b.md#z'])
  assert.deepEqual(linksIn('<img src="a.svg"><a href="#x">x</a>',true),['a.svg','#x'])
  console.log(JSON.stringify({selfTest:'passed',cases:9}));return
 }
 const inv=JSON.parse(await fs.readFile('docs/guide/evidence/document-inventory-20261109.json','utf8'))
 const historical=new Set(inv.documents.filter(d=>d.role==='설계·결정·검증의 과거 기록').map(d=>d.path))
 const guides=(await fs.readdir('docs/guide')).filter(f=>f.endsWith('.md')).map(f=>'docs/guide/'+f).filter(f=>!historical.has(f))
 const diagramPages=(await fs.readdir('docs/guide/diagrams')).filter(f=>f.endsWith('.html')).map(f=>'docs/guide/diagrams/'+f)
 const files=[...new Set([...roots,...guides,...diagramPages])]
 const failures=[];let localLinks=0
 for(const file of files){const r=await checkFile(file);localLinks+=r.checked;failures.push(...r.failures)}
 const historicalIssues=[]
 for(const file of [...historical].filter(f=>f.endsWith('.md'))){const r=await checkFile(file,{checkAnchors:false});historicalIssues.push(...r.failures)}
 const arch=await fs.readFile('docs/guide/architecture.md','utf8')
 const blocks=[...arch.matchAll(/```mermaid\s*\n([\s\S]*?)```/g)].map(m=>m[1].trim())
 const diagrams=(await fs.readdir('docs/guide/diagrams')).filter(f=>f.endsWith('.mmd')).sort()
 if(diagrams.length!==6||blocks.length!==6)failures.push({reason:'six_diagrams_required'})
 for(const [i,name] of diagrams.entries()){
  const source=await fs.readFile('docs/guide/diagrams/'+name,'utf8')
  if(source.trim()!==blocks[i])failures.push({file:name,reason:'mermaid_source_drift'})
  try{const svg=await fs.readFile('docs/guide/diagrams/'+name.replace('.mmd','.svg'),'utf8');if(!svg.includes('<svg')||!svg.includes('viewBox='))throw Error()}catch{failures.push({file:name,reason:'render_missing'})}
 }
 const result={documents:files.length,localLinks,failures,mermaidSources:diagrams.length,historicalIssues,externalLinks:'not refetched; no network calls'}
 if(process.argv.includes('--json'))console.log(JSON.stringify(result,null,2))
 else console.log(JSON.stringify({...result,historicalIssues:historicalIssues.length}))
 if(failures.length)process.exitCode=1
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main()
