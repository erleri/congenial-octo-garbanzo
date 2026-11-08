# Credentials arrive over stdin, never process arguments or output.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  $inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($inputData.firstDate -notmatch '^\d{4}-\d{2}-\d{2}$' -or $inputData.lastDate -notmatch '^\d{4}-\d{2}-\d{2}$') { throw 'invalid_range' }
  if (-not $inputData.token -or $inputData.token.Length -gt 4096 -or $inputData.token -match '\s') { throw 'invalid_token' }
  $requestUri = 'https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx?token=' + [uri]::EscapeDataString($inputData.token) + '&function=GetSeries&timeseries=F073.TCO.PRE.Z.D&firstdate=' + $inputData.firstDate + '&lastdate=' + $inputData.lastDate
  $reply = Invoke-WebRequest -Uri $requestUri -TimeoutSec 20 -MaximumRedirection 0
  # Explicit Windows compatibility mode: IWR buffers before the size check.
  if ($reply.RawContentLength -gt 2000000) { throw 'oversize' }
  $bytes = $reply.RawContentStream.ToArray()
  if ($bytes.Length -gt 2000000) { throw 'oversize' }
  @{status=[int]$reply.StatusCode;bodyBase64=[Convert]::ToBase64String($bytes)} | ConvertTo-Json -Compress
} catch {
  # Exceptions and HTTP bodies may echo the credential-bearing URL. Never print them.
  $status = 0
  if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
  @{status=$status;error='bcch_api_transport_failed'} | ConvertTo-Json -Compress
}
