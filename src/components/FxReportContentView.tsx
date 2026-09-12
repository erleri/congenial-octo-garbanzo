import type { FxReportContent, FxReportEvidence } from '../types/fxReport'

const CONFIDENCE_LABELS = { high: '높음', medium: '보통', low: '낮음' } as const

interface Props {
  content: FxReportContent
  evidence: FxReportEvidence
  compact?: boolean
}

function FactChips({ ids, evidence }: { ids: string[]; evidence: FxReportEvidence }) {
  const facts = ids.map((id) => evidence.facts.find((fact) => fact.id === id)).filter(Boolean)
  return facts.length ? (
    <div className="report-fact-row">
      {facts.map((fact) => <span className="report-fact" key={fact!.id}>{fact!.label}</span>)}
    </div>
  ) : null
}

function EvidenceLinks({ ids, evidence }: { ids: string[]; evidence: FxReportEvidence }) {
  const rows = ids.map((id) => evidence.news.find((item) => item.id === id)).filter(Boolean)
  return rows.length ? (
    <div className="report-evidence-links">
      {rows.map((item) => (
        <a key={item!.id} href={item!.url} target="_blank" rel="noreferrer">
          {item!.source}: {item!.title}
        </a>
      ))}
    </div>
  ) : null
}

export default function FxReportContentView({ content, evidence, compact = false }: Props) {
  return (
    <div className={`fx-report-content ${compact ? 'compact' : ''}`}>
      <div className="report-lead">
        <h3>{content.headline}</h3>
        <span className={`report-confidence ${content.confidence}`}>신뢰도 {CONFIDENCE_LABELS[content.confidence]}</span>
      </div>
      <ul className="report-summary-list">
        {content.executiveSummary.map((text) => <li key={text}>{text}</li>)}
      </ul>
      {!compact ? (
        <>
          <section className="report-section">
            <h4>주요 환율 움직임</h4>
            {content.keyMoves.map((item, index) => (
              <article className="report-statement" key={`${item.currency}-${index}`}>
                <p>{item.text}</p>
                <FactChips ids={item.factIds} evidence={evidence} />
                <EvidenceLinks ids={item.evidenceIds} evidence={evidence} />
              </article>
            ))}
          </section>
          <section className="report-section">
            <h4>계획환율 대비 관찰 사항</h4>
            {content.planObservations.map((item, index) => (
              <article className="report-statement" key={`${item.currency}-${index}`}>
                <p>{item.text}</p>
                <FactChips ids={item.factIds} evidence={evidence} />
              </article>
            ))}
          </section>
          <section className="report-section">
            <h4>다음 관찰 항목</h4>
            <ul>{content.scenarios.map((text) => <li key={text}>{text}</li>)}</ul>
          </section>
          <details className="report-limitations">
            <summary>분석 기준과 한계</summary>
            <ul>{content.limitations.map((text) => <li key={text}>{text}</li>)}</ul>
          </details>
        </>
      ) : null}
    </div>
  )
}
