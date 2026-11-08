import { useState } from 'react'

export default function ReviewSimulation() {
  const [role, setRole] = useState('active_admin')
  const [decision, setDecision] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [notice, setNotice] = useState('')
  const choose = (value: 'approved' | 'rejected') => {
    if (role !== 'active_admin') { setNotice('관리자 권한이 없어 검토할 수 없습니다.'); return }
    if (decision !== 'pending') { setNotice('이미 처리된 검토입니다. 중복으로 처리하지 않습니다.'); return }
    setDecision(value); setNotice(value === 'approved' ? '모의 승인 완료. 실제 원고·DB·공개 목록은 바뀌지 않습니다.' : '모의 반려 완료. 이전 공개 보고서는 유지합니다.')
  }
  return <section className="generation-status" aria-label="로컬 승인 흐름 모의 시험">
    <h1>승인 흐름 모의 시험</h1><p>Docker·실제 인증과 독립된 동작 시안입니다. 샘플 상태만 바뀌며 실제 관리자 권한이나 게시 승인을 만들지 않습니다.</p>
    <label>시험 역할 <select value={role} onChange={e => { setRole(e.target.value); setDecision('pending'); setNotice('이전 검토 상태를 제거했습니다.') }}>
      <option value="active_admin">활성 관리자 모의</option><option value="reader">일반 사용자 모의</option><option value="revoked">권한 해제·로그아웃 모의</option>
    </select></label>
    {role === 'active_admin' ? <div className="review-simulation-private"><h2>검토용 샘플 상태</h2><p>실제 AI 원고가 아닌 승인 절차 연습 항목입니다. 현재 상태: {decision === 'pending' ? '대기' : decision === 'approved' ? '모의 승인' : '모의 반려'}</p>
      <button onClick={() => choose('approved')}>모의 승인</button> <button onClick={() => choose('rejected')}>모의 반려</button></div> : <p>검토용 영역을 숨겼습니다.</p>}
    <p role="status">{notice}</p><button onClick={() => { setDecision('pending'); setNotice('모의 상태만 초기화했습니다.') }}>모의 시험 초기화</button>
    <p><a href="#dashboard">대시보드로 돌아가기</a></p>
  </section>
}
