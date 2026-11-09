import { Component, type ReactNode } from 'react'

export default class ReportBoundary extends Component<{ children: ReactNode; onBack: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <section className="panel empty" role="alert"><h2>리포트 화면을 표시하지 못했습니다.</h2><p>새로 배포된 화면을 불러오지 못했거나 연결에 문제가 있을 수 있습니다. 화면을 새로고침해 다시 확인해 주세요.</p><button onClick={()=>window.location.reload()}>화면 새로고침</button><button onClick={this.props.onBack}>대시보드로 돌아가기</button></section> : this.props.children
  }
}
