import { useEffect, useRef, type ReactNode } from 'react'

/** Native disclosure: Escape returns focus; clicking elsewhere closes without stealing it. */
export default function Disclosure({summary,children,className='',label,desktopOpen=false}:{summary:ReactNode;children:ReactNode;className?:string;label?:string;desktopOpen?:boolean}) {
  const ref=useRef<HTMLDetailsElement>(null)
  useEffect(()=>{
    const desktop=window.matchMedia('(min-width:761px)')
    const sync=()=>{if(desktopOpen&&ref.current)ref.current.open=desktop.matches}
    sync()
    const close=(event:PointerEvent)=>{const el=ref.current;if(!(desktopOpen&&desktop.matches)&&el?.open&&event.target instanceof Node&&!el.contains(event.target))el.open=false}
    desktop.addEventListener('change',sync)
    document.addEventListener('pointerdown',close)
    return()=>{document.removeEventListener('pointerdown',close);desktop.removeEventListener('change',sync)}
  },[desktopOpen])
  return <details ref={ref} className={className} onKeyDown={event=>{if(event.key==='Escape'&&ref.current?.open&&!(desktopOpen&&window.matchMedia('(min-width:761px)').matches)){ref.current.open=false;ref.current.querySelector('summary')?.focus();event.stopPropagation()}}}>
    <summary aria-label={label}>{summary}</summary>{children}
  </details>
}
