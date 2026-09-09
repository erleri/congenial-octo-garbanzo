const EXCEL_EXTENSIONS = ['.xlsx', '.xls', '.xlsm'] as const
export const MAX_EXCEL_UPLOAD_BYTES = 25 * 1024 * 1024

export function validateExcelUpload(file: Pick<File, 'name' | 'size'>): void {
  const normalizedName = file.name.trim().toLowerCase()
  const hasSupportedExtension = EXCEL_EXTENSIONS.some((extension) =>
    normalizedName.endsWith(extension),
  )

  if (!hasSupportedExtension) {
    throw new Error('Excel 파일(.xlsx, .xls, .xlsm)만 업로드할 수 있습니다.')
  }

  if (file.size <= 0) {
    throw new Error('비어 있는 Excel 파일은 업로드할 수 없습니다.')
  }

  if (file.size > MAX_EXCEL_UPLOAD_BYTES) {
    throw new Error('Excel 파일은 25MB 이하여야 합니다.')
  }
}
