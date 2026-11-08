import { useEffect } from 'react'
import { pageTitle } from '../lib/pageContext'
import type { FxNavigation } from '../lib/fxNavigation'
export function usePageContext(navigation:FxNavigation,hash:string) {
  const pageKey=navigation.screen==='reports'?hash.split('?')[0]:`${navigation.screen}:${navigation.screen==='trends'?navigation.view:''}`
  useEffect(()=>{document.title=pageTitle(navigation,hash)},[navigation,hash])
  useEffect(()=>{
    const focus=()=>{const heading=Array.from(document.querySelectorAll<HTMLElement>('main h1,main h2')).find(h=>h.getClientRects().length>0&&!h.closest('.loading-panel,[hidden],[aria-hidden=true]'))
      if(!heading)return false
      heading.tabIndex=-1;heading.focus({preventScroll:true});return document.activeElement===heading}
    const observer=new MutationObserver(()=>{if(focus())observer.disconnect()})
    if(!focus())observer.observe(document.querySelector('main')!,{childList:true,subtree:true,attributes:true,attributeFilter:['style','hidden','aria-hidden']})
    return()=>observer.disconnect()
  },[pageKey])
}
