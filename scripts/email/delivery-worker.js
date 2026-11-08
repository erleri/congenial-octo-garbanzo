import {randomUUID} from 'node:crypto'
import {assertEmailFrame,buildApprovedEmailPayload,emailMessageId,emailRecipientKey,normalizeEmailRecipients,emailHash} from './delivery-core.js'

const terminal=new Set(['accepted','rejected','failed_before_send','unknown'])
function outcome(value) {
  if(!value||!terminal.has(value.status)||value.code!==null&&(!Number.isInteger(value.code)||value.code<100||value.code>599)
    ||!['smtp_accepted','recipient_rejected','message_rejected','pre_data_failure','transport_result_unknown'].includes(value.reason)) {
    return {status:'unknown',code:null,reason:'transport_result_unknown'}
  }
  if(value.status==='accepted'&&(value.reason!=='smtp_accepted'||value.code!==250)
    ||value.status==='rejected'&&(!['recipient_rejected','message_rejected'].includes(value.reason)||value.code<400)
    ||value.status==='failed_before_send'&&value.reason!=='pre_data_failure'
    ||value.status==='unknown'&&(value.reason!=='transport_result_unknown'||value.code!==null)) return {status:'unknown',code:null,reason:'transport_result_unknown'}
  return {status:value.status,code:value.code,reason:value.reason}
}
export async function deliverDashboardEmail({frame,chartBase64,chartSnapshot,recipients,store,transport,owner=randomUUID()}) {
  assertEmailFrame(frame)
  const addresses=normalizeEmailRecipients(recipients),rows=[]
  if(!addresses.length) return {status:'no_recipients',rows,transportCalls:0}
  if(chartSnapshot?.datasetHash!==frame.datasetHash||chartSnapshot?.baseDate!==frame.dataDate
    ||chartSnapshot?.chartHash!==emailHash(Buffer.from(chartBase64??'','base64'))) return {status:'chart_snapshot_mismatch',rows,transportCalls:0}
  let staged
  try { staged=await store.stage(frame,chartBase64) }
  catch {return {status:'ledger_unavailable',rows,transportCalls:0}}
  const frozenFrame=assertEmailFrame(JSON.parse(staged.frameJson))
  let transportCalls=0
  for(const recipient of addresses) {
    const recipientKey=emailRecipientKey(recipient)
    let delivery,started=false
    try {
      delivery=await store.claim({editionDate:frozenFrame.editionDate,recipientKey,owner})
      if(!delivery.claimed) {rows.push({recipientKey,status:delivery.state==='accepted'?'already_accepted':delivery.state});continue}
      let payloadJson=delivery.payloadJson,payloadHash=delivery.payloadHash
      if(!payloadJson) {
        let payload
        try {payload=buildApprovedEmailPayload(frozenFrame,await store.candidates({key:delivery.key,owner}))}
        catch {payload=buildApprovedEmailPayload(frozenFrame,null,{lookupStatus:'unavailable'})}
        const frozen=await store.freeze({key:delivery.key,owner,payloadJson:JSON.stringify(payload)})
        payloadJson=frozen.payloadJson;payloadHash=frozen.payloadHash
      }
      let begin=await store.begin({key:delivery.key,owner,payloadHash})
      if(!begin.started&&begin.reason==='public_state_changed') {
        // No SMTP dispatch has occurred. Retain the old frozen payload in the
        // ledger and use the same daily delivery identity for an FX-only copy.
        const fallback=buildApprovedEmailPayload(frozenFrame,null,{lookupStatus:'changed_before_send'})
        const fresh=await store.freeze({key:delivery.key,owner,payloadJson:JSON.stringify(fallback),replaceUnsent:true})
        payloadJson=fresh.payloadJson;payloadHash=fresh.payloadHash
        begin=await store.begin({key:delivery.key,owner,payloadHash})
      }
      if(!begin.started) {rows.push({recipientKey,status:begin.reason??'held'});continue}
      started=true
      const payload=JSON.parse(payloadJson)
      let result
      transportCalls++
      try {result=outcome(await transport({recipient,messageId:emailMessageId(delivery.key),deliveryKey:delivery.key,
        payload,chartBase64:staged.chartBase64}))}
      catch {result={status:'unknown',code:null,reason:'transport_result_unknown'}}
      await store.finish({key:delivery.key,owner,payloadHash,...result})
      rows.push({recipientKey,status:result.status,code:result.code,reportCount:payload.refs.filter(r=>r.kind==='report').length,
        noticeCount:payload.refs.filter(r=>r.kind==='notice').length,lookupStatus:payload.lookupStatus})
    } catch {
      // A missing persistence acknowledgement after dispatch must never become
      // a retry. The durable sending record blocks the next runner as well.
      rows.push({recipientKey,status:started?'receipt_unconfirmed':'ledger_unavailable'})
      return {status:'attention_required',rows,transportCalls}
    }
  }
  const attention=rows.some(r=>['unknown','receipt_unconfirmed','ledger_unavailable','sending','busy','suppressed','rejected','failed_before_send'].includes(r.status))
  return {status:attention?'attention_required':'completed',rows,transportCalls}
}

export async function planDashboardEmail({frame,recipients,store}) {
  assertEmailFrame(frame)
  const rows=[]
  for(const recipient of normalizeEmailRecipients(recipients)) {
    const recipientKey=emailRecipientKey(recipient)
    let payload
    try {payload=buildApprovedEmailPayload(frame,await store.preview({recipientKey,cutoff:frame.cutoff,dataDate:frame.dataDate}))}
    catch {payload=buildApprovedEmailPayload(frame,null,{lookupStatus:'unavailable'})}
    rows.push({recipientKey,payload,reportCount:payload.refs.filter(r=>r.kind==='report').length,lookupStatus:payload.lookupStatus})
  }
  return {status:'plan_only',rows,transportCalls:0,ledgerWrites:0}
}
