import { useState } from 'react'
import type { AdminAccess } from '../hooks/useAdminAccess'

export default function AdminAccessPanel({ access }: { access: AdminAccess }) {
  const [email, setEmail] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const signedIn = !!access.email
  return <section className={`panel admin-access-panel ${signedIn?'is-signed-in':''}`} aria-label="공통 관리자 로그인">
    <div><h2>{signedIn?'관리자':'관리자 로그인'}</h2><p className="table-help">한 번 로그인하면 리포트와 계획환율을 함께 관리합니다.</p></div>
    {signedIn ? <div className="inline-controls"><span>{access.email}</span><span className="scope-badge">{access.canManage ? '관리자' : access.phase === 'checking' || access.phase === 'paused' ? '권한 확인 중' : '권한 확인 필요'}</span></div> : null}
    {!signedIn && access.configured ? <form className="inline-controls" onSubmit={async event => {
      event.preventDefault(); setBusy(true); setNotice('')
      try { await access.login(email); setNotice('로그인 링크를 이메일로 보냈습니다. 링크를 열면 두 관리 영역에 함께 로그인됩니다.') }
      catch { setNotice('로그인 링크를 보내지 못했습니다. 이메일과 연결 상태를 확인해 주세요.') }
      finally { setBusy(false) }
    }}><label>이메일 <input type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required disabled={busy}/></label><button className="quiet-button" disabled={busy}>로그인 링크 받기</button></form> : null}
    {signedIn ? <button type="button" className="quiet-button" disabled={busy} onClick={async () => {
      setBusy(true); setNotice('')
      try { await access.logout(); setNotice('로그아웃했습니다. 두 관리 영역의 비공개 자료를 제거했습니다.') }
      catch { setNotice('로그아웃을 확인하지 못했습니다. 관리 자료는 숨겼습니다. 다시 로그인해 주세요.') }
      finally { setBusy(false) }
    }}>로그아웃</button> : null}
    {!access.configured ? <p className="table-help">관리 저장소 연결 설정이 필요합니다.</p> : null}
    {access.phase === 'denied' ? <p role="status">활성 관리자 권한이 없습니다.</p> : null}
    {access.phase === 'unavailable' ? <p role="status">관리자 권한을 확인하지 못해 비공개 자료를 숨겼습니다. <button className="inline-link" onClick={() => void access.recheck()}>다시 확인</button></p> : null}
    {notice ? <p role="status" className="table-help">{notice}</p> : null}
  </section>
}
