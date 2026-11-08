// Missing publication time remains missing. A registered numeric snapshot may
// support background only when its actual availability is separately bound.
export function isOfficialSnapshotBackground(e,asOf) {
 const s=e?.officialStatistic,a=s?.availability
 return e?.publishedAt===null&&s?.version==='official-statistic-admission/1'&&s.definitionVersion==='official-country-statistics/1'
  &&a?.version==='official-snapshot-availability/1'&&a.basis==='captured_series_only'&&a.publicationDateKnown===false
  &&a.availableBy===e.collectedAt&&typeof a.availableBy==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(a.availableBy)
  &&Number.isFinite(Date.parse(a.availableBy))&&Date.parse(a.availableBy)<=Date.parse(asOf)
  &&/^\d{4}-(0[1-9]|1[0-2])$/.test(e.period??'')&&`${e.period}-01`<=asOf.slice(0,10)
  &&e.sharedNotes?.claims?.length>0&&e.sharedNotes.claims.every(n=>['consumer_background','policy_background'].includes(n.role))
}
