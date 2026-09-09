import { describe, expect, it } from 'vitest'
import { MAX_EXCEL_UPLOAD_BYTES, validateExcelUpload } from '../uploadValidation'

describe('Excel upload validation', () => {
  it('accepts supported non-empty files', () => {
    expect(() => validateExcelUpload({ name: 'rates.XLSX', size: 1024 })).not.toThrow()
  })

  it('rejects unsupported, empty and oversized files', () => {
    expect(() => validateExcelUpload({ name: 'rates.csv', size: 100 })).toThrow('Excel 파일')
    expect(() => validateExcelUpload({ name: 'rates.xlsx', size: 0 })).toThrow('비어 있는')
    expect(() => validateExcelUpload({
      name: 'rates.xlsm',
      size: MAX_EXCEL_UPLOAD_BYTES + 1,
    })).toThrow('25MB')
  })
})
