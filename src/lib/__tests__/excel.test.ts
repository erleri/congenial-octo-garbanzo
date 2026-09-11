import { afterEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { parseExcelWorkbook } from '../excel'

function upload(bytes: ArrayBuffer, name = 'rates.xlsx'): File {
  vi.stubGlobal('FileReader', class {
    result = bytes
    onload?: () => void
    readAsArrayBuffer() { this.onload?.() }
  })
  return { name, size: bytes.byteLength } as File
}

afterEach(() => vi.unstubAllGlobals())

describe('Excel workbook parsing', () => {
  it('reads a real workbook containing recognized FX rows', async () => {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      ['LOCAL', '2026-07', '2026-08', '2026-09'],
      ['BRL', 5.1, 5.2, 5.3],
    ]), 'Summary')
    const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const parsed = await parseExcelWorkbook(upload(bytes))
    expect(parsed.monthlyRates.map(row => row.value)).toEqual([5.1, 5.2, 5.3])
  })

  it('rejects a damaged archive instead of accepting an empty dataset', async () => {
    const bytes = new Uint8Array([80, 75, 3, 4, 0, 0, 0, 0]).buffer
    await expect(parseExcelWorkbook(upload(bytes))).rejects.toThrow('Excel')
  })

  it('rejects a valid workbook with no recognized rates', async () => {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['unrelated', 123]]), 'Other')
    const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    await expect(parseExcelWorkbook(upload(bytes))).rejects.toThrow('환율 데이터를 찾지 못했습니다')
  })
})
