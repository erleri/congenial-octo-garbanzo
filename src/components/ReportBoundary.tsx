import { Component, type ReactNode } from 'react'

export default class ReportBoundary extends Component<{ children: ReactNode; onBack: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <section className="panel empty" role="alert"><h2>리포트 화면을 표시하지 못했습니다.</h2><p>환율 조회는 계속 사용할 수 있습니다.</p><button onClick={this.props.onBack}>대시보드로 돌아가기</button></section> : this.props.children
  }
}
