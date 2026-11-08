import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { admitChileMonthlyEvidence, validateMonthlyExtraction } from './chile-monthly-evidence.js'
const exec = promisify(execFile)
const inside = (root, file) => { const rel = path.relative(root,file); return rel && !rel.startsWith('..') && !path.isAbsolute(rel) }

// Input/output stay inside the existing ignored private tree. No keys, network,
// browser routes, DB clients, env files or report writes in this entry point.
export async function reviewMonthlyLocal({capture, python, review, workspace = process.cwd()}) {
  const root = await fs.realpath(workspace), privateRoot = path.join(root,'.local-reports','private')
  if (await fs.realpath(privateRoot) !== privateRoot) throw new Error('private_review_path_unsafe')
  async function privateFile(file, limit) {
    const resolved = await fs.realpath(path.resolve(root,file))
    if (!inside(privateRoot,resolved) || !(await fs.stat(resolved)).isFile() || (await fs.stat(resolved)).size > limit) throw new Error('private_review_input_unsafe')
    return resolved
  }
  const manifestPath = await privateFile(path.join(capture,'manifest.json'),1000000)
  const manifest = JSON.parse(await fs.readFile(manifestPath,'utf8'))
  if (manifest.version !== 'chile-monthly-originals/1' || !Array.isArray(manifest.results) || manifest.results.length > 2) throw new Error('invalid_monthly_capture')
  const receipts = review ? JSON.parse(await fs.readFile(await privateFile(review,300000),'utf8')) : null
  if (receipts && (!Array.isArray(receipts) || !receipts.length || receipts.length > 4)) throw new Error('invalid_monthly_receipts')
  const snapshots = [], bundles = [], used = new Set()
  for (const result of manifest.results) {
    if (!Array.isArray(result.originals) || result.originals.length > 2) throw new Error('invalid_monthly_originals')
    for (const original of result.originals) {
      if (!original.file || path.basename(original.file) !== original.file || !original.file.endsWith('.pdf')) throw new Error('invalid_monthly_pdf_file')
      const pdf = await privateFile(path.join(path.dirname(manifestPath),original.file),2000000)
      const raw = await fs.readFile(pdf)
      if (createHash('sha256').update(raw).digest('hex') !== original.sha256 || raw.length !== original.bytes) throw new Error('pdf_hash_mismatch')
      const {stdout} = await exec(python,['-X','utf8',fileURLToPath(new URL('./extract-monthly-pdf.py',import.meta.url)),pdf],
        {timeout:20000,maxBuffer:2000000,windowsHide:true,encoding:'utf8'})
      const extraction = JSON.parse(stdout), identity = validateMonthlyExtraction(original,extraction)
      snapshots.push({original,extraction,identity})
      if (receipts) {
        const matches = receipts.filter(r => r.originalBinding === identity.originalBinding)
        if (matches.length > 1) throw new Error('duplicate_monthly_receipt')
        if (matches.length) { used.add(matches[0]); bundles.push(admitChileMonthlyEvidence({original,extraction,receipt:matches[0]})) }
      }
    }
  }
  if (!snapshots.length || receipts && used.size !== receipts.length) throw new Error('monthly_receipt_source_missing')
  const parent = path.join(privateRoot,'official-statistics-review')
  await fs.mkdir(parent,{recursive:true})
  if (await fs.realpath(parent) !== parent || (await fs.lstat(parent)).isSymbolicLink()) throw new Error('private_review_path_unsafe')
  const target = await fs.mkdtemp(path.join(parent,'pdf-'))
  await fs.writeFile(path.join(target,'snapshots.json'),JSON.stringify(snapshots,null,2),{flag:'wx'})
  if (receipts) await fs.writeFile(path.join(target,'receipts.json'),JSON.stringify(receipts,null,2),{flag:'wx'})
  const output = {version:'chile-monthly-review-run/1',mode:receipts?'reviewed_evidence':'extraction_only',
    bundles,documents:snapshots.map(s => ({sha256:s.original.sha256,...s.identity})),
    publicationApproved:false,networkCalls:0,modelCalls:0,costUsd:0}
  await fs.writeFile(path.join(target,'evidence.json'),JSON.stringify(output,null,2),{flag:'wx'})
  return {directory:path.relative(root,target),mode:output.mode,documents:snapshots.length,evidence:bundles.reduce((n,b) => n+b.evidence.length,0),costUsd:0,publicationApproved:false}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), options = {}
  for (let i=0;i<args.length;i+=2) {
    if (!['--capture','--python','--review'].includes(args[i]) || !args[i+1] || args[i+1].startsWith('--') || options[args[i].slice(2)]) throw new Error('invalid_monthly_review_arguments')
    options[args[i].slice(2)] = args[i+1]
  }
  if (!options.capture || !options.python) throw new Error('usage: --capture <private-capture-directory> --python <python-with-pypdf> [--review <private-receipts.json>]')
  console.log(JSON.stringify(await reviewMonthlyLocal(options),null,2))
}
