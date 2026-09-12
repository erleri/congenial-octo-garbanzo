import fs from 'node:fs'
import path from 'node:path'

const distPath = path.resolve('dist')
const htmlPath = path.join(distPath, 'index.html')
if (!fs.existsSync(htmlPath)) throw new Error('dist/index.html is missing; run the production build first.')

const html = fs.readFileSync(htmlPath, 'utf8')
const entryMatch = html.match(/<script[^>]+src="([^"]*\/assets\/index-[^"]+\.js)"/)
if (!entryMatch) throw new Error('The production entry chunk could not be identified.')

const entryPath = path.join(distPath, entryMatch[1].replace(/^\//, ''))
const entryBytes = fs.statSync(entryPath).size
const assetNames = fs.readdirSync(path.join(distPath, 'assets'))
const xlsxChunks = assetNames.filter((name) => /^xlsx-[\w-]+\.js$/.test(name))

if (!xlsxChunks.length) throw new Error('xlsx was not emitted as a lazy production chunk.')
if (entryBytes > 850_000) throw new Error(`Initial entry chunk is ${entryBytes} bytes; expected at most 850000 bytes.`)

console.log(`Bundle boundary verified: entry=${entryBytes} bytes, lazy xlsx=${xlsxChunks.join(', ')}`)
