// Check current entry documents; historical documents keep their original text.
import fs from 'node:fs/promises'
import path from 'node:path'
const roots=['README.md','PROJECT_OVERVIEW.md','OPERATIONS_TODO.md','supabase/schema-proposals/README.md',
 'docs/2.0/common-report-rules.md','docs/2.0/editorial-standard.md','docs/2.0/publication-policy.md']
const guides=(await fs.readdir('docs/guide')).filter(f=>f.endsWith('.md')).map(f=>'docs/guide/'+f)
const failures=[];let links=0
for(const file of [...roots,...guides]){
 const text=await fs.readFile(file,'utf8')
 for(const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){
  const link=match[1].replace(/^<|>$/g,'').split('#')[0]
  if(!link||/^[a-z]+:\/\//i.test(link))continue
  links++
  const resolved=path.resolve(path.dirname(file),decodeURIComponent(link))
  try{await fs.access(resolved)}catch{failures.push({file,link})}
 }
}
if(failures.length){console.error(JSON.stringify(failures,null,2));process.exitCode=1}
else console.log(JSON.stringify({documents:roots.length+guides.length,localLinks:links,broken:0,historicalLinks:'not rewritten'}))
