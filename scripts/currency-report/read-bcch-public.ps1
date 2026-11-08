param([Parameter(Mandatory=$true)][string]$Url)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  $target = [uri]$Url
  if ($target.Scheme -ne 'https' -or $target.Host -ne 'si3.bcentral.cl' -or -not $target.IsDefaultPort -or $target.UserInfo -or $target.Fragment) { throw 'unregistered_url' }
  $daily = $target.AbsoluteUri -ceq 'https://si3.bcentral.cl/Indicadoressiete/secure/Indicadoresdiarios.aspx'
  $query = $target.Query.TrimStart('?').Split('&')
  $series = $target.AbsolutePath -ceq '/Indicadoressiete/secure/Serie.aspx' -and $query.Count -eq 2 -and $query[0] -ceq 'gcode=PRE_TCO' -and $query[1] -cmatch '^param=[A-Za-z0-9%+/=]{20,2000}$'
  if (-not ($daily -or $series)) { throw 'unregistered_url' }
  # Explicit compatibility mode only. IWR buffers before this size check.
  $reply = Invoke-WebRequest -Uri $target.AbsoluteUri -TimeoutSec 15 -MaximumRedirection 0
  if ($reply.RawContentLength -gt 2000000) { throw 'oversize' }
  $bytes = $reply.RawContentStream.ToArray()
  if ($bytes.Length -gt 2000000) { throw 'oversize' }
  @{status=[int]$reply.StatusCode;contentType=[string]($reply.Headers['Content-Type'] -join ';');bodyBase64=[Convert]::ToBase64String($bytes)} | ConvertTo-Json -Compress
} catch {
  @{error='bcch_windows_public_read_failed'} | ConvertTo-Json -Compress
}
