import {renderToStaticMarkup} from 'react-dom/server'
import {expect,it} from 'vitest'
import ReportReviewCard, {type ReviewRun} from './ReportReviewCard'

const run:ReviewRun={id:'preview',status:'pending_review',created_at:'2026-11-02',attempt:1,
  validation:{structureValid:true,contentReview:'passed',criticalErrors:0,qualityAverage:4,evidenceScore:4},
  candidate:{id:'preview',schemaVersion:'currency-report/1',currency:'CLP',baseDate:'2026-11-02',observedDate:'2026-10-30',publishedAt:null,generationMode:'editorial_fixture',status:'pending_review',
    content:{title:'검토 화면 시험',summary:'표시 검증',change:{title:'변화',text:'저장 사실',kind:'fact',factIds:[],evidenceIds:[]},drivers:[],implications:[],watch:[],limitations:[]},facts:[],evidence:[],series:[],limitations:[]}}
const defaults={run,busy:false,reason:'',revision:'',focused:false,targetUnavailable:false,onRevision:()=>{},onReview:()=>{}}
it('keeps approval gates when the shared review card is rendered',()=>{
  const scenarios=[{}, {busy:true},{targetUnavailable:true},{run:{...run,validation:{...run.validation,contentReview:'unverified'}}},{run:{...run,expectedPublicId:'old'}},{run:{...run,expectedPublicId:'old'},revision:'correction'},{run:{...run,validation:{...run.validation,storageRequired:true,storageComplete:false}}}]
  for(const [index,patch] of scenarios.entries()){
    const html=renderToStaticMarkup(<ReportReviewCard {...defaults} {...patch}/>),approve=html.match(/<button[^>]*>승인<\/button>/)?.[0]
    expect(approve).toBeDefined()
    expect(approve!.includes('disabled')).toBe(![0,5].includes(index))
  }
})
it('keeps withdrawal disabled without a reason, and exposes evidence through a disclosure',()=>{
  for(const reason of ['', '정정 검토']){
    const html=renderToStaticMarkup(<ReportReviewCard {...defaults} run={{...run,status:'published'}} reason={reason} focused/> )
    expect(html.match(/<button[^>]*>철회<\/button>/)?.[0].includes('disabled')).toBe(!reason)
    expect(html).toContain('<details class="review-body" open="">')
    expect(html).toContain('본문·근거·검증 결과')
    expect(html).not.toContain('>승인</button>')
  }
})

it('shows a rejected approval beside that manuscript without scrolling to the header',()=>{
 const html=renderToStaticMarkup(<ReportReviewCard {...defaults} actionNotice="공개용 숫자·날짜 형식 검사에서 거부됐습니다."/> )
 expect(html).toContain('role="status"')
 expect(html.indexOf('공개용 숫자')).toBeGreaterThan(html.indexOf('review-card-actions'))
})
it('keeps cause-score failures blocked and explains the unmet threshold',()=>{
 const html=renderToStaticMarkup(<ReportReviewCard {...defaults} run={{...run,validation:{...run.validation,contentReview:'unverified',review:{scores:{cause:3}}}}}/> )
 expect(html).toContain('원인 설명 3점');expect(html).toContain('필수 4~5점')
 expect(html).toContain('class="review-primary" disabled=""')
})
