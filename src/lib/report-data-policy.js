// Local trial defaults. Enforced production cleanup/limits remain disabled.
export const REPORT_DATA_POLICY=Object.freeze({version:'report-data-operations/1',mode:'dry_run',deleteEnabled:false,
 tempDays:7,rejectedOriginalDays:30,detailDays:90,auditMonths:24,warningRatio:.70,pauseRatio:.85,
 statusCheckMs:15*60*1000,publicCacheMs:24*60*60*1000})
