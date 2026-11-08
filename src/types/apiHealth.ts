export interface ApiHealthProvider {
  id:string
  name:string
  kind:string
  role:string
  stage:string
  status:'not_checked'|'sample_ok'|'needs_configuration'|'check_failed'
  checkedAt:string|null
  lastSuccessAt:string|null
  outdated:boolean
  errorType:string|null
  authentication:string
  sample:{seriesId:string;observationCount:number;use:string;latestPeriod?:string|null}|null
}
export interface ApiHealthSnapshot {
  version:'local-api-health/1'
  scope:'local_saved_checks'
  providers:ApiHealthProvider[]
  generatedAt:string
  limitation:string
}
