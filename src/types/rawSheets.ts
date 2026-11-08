export interface RawSheetCatalog {
  version:'raw-sheet-catalog/1'
  sourceHash:string
  previewRows:number
  sheets:{name:string;headers:string[];totalRows:number;previewUrl:string}[]
}
