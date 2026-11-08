import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
// Fixed private directory; no user-specified output root or original overwrite.
export async function saveChileMonthlyCapture(capture, workspace = process.cwd()) {
  const root = await fs.realpath(workspace)
  let directory = root
  for (const part of ['.local-reports', 'private', 'official-statistics']) {
    const next = path.join(directory, part)
    await fs.mkdir(next).catch(e => { if (e.code !== 'EEXIST') throw e })
    const stat = await fs.lstat(next)
    if (stat.isSymbolicLink() || !stat.isDirectory() || await fs.realpath(next) !== next) throw new Error('private_capture_path_unsafe')
    directory = next
  }
  const target = await fs.mkdtemp(path.join(directory, 'cl-'))
  const manifest = { ...capture, results: [] }
  for (const [i, result] of capture.results.entries()) {
    const { indexRaw, originals = [], ...metadata } = result
    const stored = { ...metadata, originals: [] }
    if (indexRaw !== undefined) {
      if (hash(indexRaw) !== result.indexHash) throw new Error('index_hash_mismatch')
      stored.indexFile = `${i}-index.html`
      await fs.writeFile(path.join(target, stored.indexFile), indexRaw, { flag: 'wx' })
    }
    for (const [j, original] of originals.entries()) {
      const { raw, ...meta } = original
      if (raw !== undefined) {
        if (!Buffer.isBuffer(raw) || hash(raw) !== meta.sha256) throw new Error('pdf_hash_mismatch')
        meta.file = `${i}-${j}-${meta.sha256}.pdf`
        await fs.writeFile(path.join(target, meta.file), raw, { flag: 'wx' })
      }
      stored.originals.push(meta)
    }
    manifest.results.push(stored)
  }
  await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' })
  return { directory: path.relative(root, target), manifest }
}
