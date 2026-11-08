import type {Plugin} from 'vite'
import type {RawSheetsDataset} from '../src/types/exchangeRate'
import type {RawSheetCatalog} from '../src/types/rawSheets'
export function buildRawSheetAssets(data:RawSheetsDataset):{compact:string;catalog:RawSheetCatalog;previews:{url:string;body:string}[]}
export function rawSheetAssetsPlugin():Plugin
