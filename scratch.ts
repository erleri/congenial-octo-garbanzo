import fs from 'fs'
import * as xlsx from 'xlsx'

const fileData = fs.readFileSync('C:\\Users\\Koo Imjun\\Documents\\a-0. Daily Exchange Rate 현황  (26.04.20).xlsx')
const workbook = xlsx.read(fileData, { type: 'buffer' })
const sheetName = workbook.SheetNames.find((s) => s.includes('Summary'))
console.log('Summary sheet:', sheetName)
const sheet = workbook.Sheets[sheetName!]
const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })
console.log('Summary rows count:', rows.length)

const brlSheet = workbook.Sheets['BRL']
const brlRows = xlsx.utils.sheet_to_json(brlSheet, { header: 1, raw: true, defval: null })
console.log('BRL rows count:', brlRows.length)
