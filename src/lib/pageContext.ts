import type { FxNavigation } from './fxNavigation'
export function pageTitle(navigation:FxNavigation,hash:string) {
  const match=/^#report\/(BRL|MXN|CLP|COP|PEN|ARS)(?:\/(history|\d{4}-\d{2}-\d{2}))?/.exec(hash)
  const label=navigation.screen==='reports'?(match?`${match[1]} ${match[2]==='history'?'리포트 목록':match[2]??'최신 리포트'}`:'환율 리포트'):
    navigation.screen==='trends'?`${navigation.view==='monthly'?'월별 이력':navigation.view==='comparison'?'상세 비교':'일별 추이'} · ${navigation.view==='monthly'?navigation.monthlyCurrency:navigation.currency}`:
    navigation.screen==='admin'?'관리자':navigation.screen==='plan'?'계획환율 관리':'환율 대시보드'
  return `${label} · LATAM FX`
}
export function recentMonthRange(latest:string,months:number,earliest:string) {
  const date=new Date(latest+'-01T00:00:00Z')
  date.setUTCMonth(date.getUTCMonth()-months+1)
  return {from:date.toISOString().slice(0,7)<earliest?earliest:date.toISOString().slice(0,7),to:latest}
}
