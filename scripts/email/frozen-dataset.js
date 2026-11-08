import fs from 'node:fs/promises'
import {loadOperationalFxDataset} from '../load-fx-dataset.js'
import {assertEmailFrame,emailHash} from './delivery-core.js'

export async function loadEmailChartDataset({env=process.env,
  readJson=async file=>JSON.parse(await fs.readFile(file,'utf8')),loadCurrent=loadOperationalFxDataset}={}) {
  if(!['approved','shadow'].includes(env.FX_EMAIL_REPORT_MODE)) return {dataset:await loadCurrent(),frozen:false}
  const frame=assertEmailFrame(await readJson('email-compose-context.json'))
  const dataset=await readJson('email-dataset-snapshot.json')
  if(dataset.baseDate!==frame.dataDate||emailHash(JSON.stringify(dataset))!==frame.datasetHash) throw Error('email_chart_snapshot_changed')
  return {dataset,frozen:true}
}
