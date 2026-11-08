param([Parameter(Mandatory=$true)][string]$Url)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  $target = [uri]$Url
  if ($target.Scheme -ne 'https' -or $target.Host -ne 'www.ine.gob.cl' -or -not $target.IsDefaultPort -or $target.UserInfo) { throw 'unregistered_url' }
  # Explicit local Windows compatibility transport. IWR buffers the response;
  # the 2MB check is post-download, not a streaming bound. No credentials/env.
  $reply = Invoke-WebRequest -Uri $target.AbsoluteUri -TimeoutSec 15 -MaximumRedirection 0
  if ($reply.RawContentLength -gt 2000000) { throw 'oversize' }
  $bytes = $reply.RawContentStream.ToArray()
  if ($bytes.Length -gt 2000000) { throw 'oversize' }
  $contentType = [string]($reply.Headers['Content-Type'] -join ';')
  @{status=[int]$reply.StatusCode;contentType=$contentType;bodyBase64=[Convert]::ToBase64String($bytes)} | ConvertTo-Json -Compress
} catch {
  $status = 0
  if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
  @{status=$status;error='windows_public_read_failed'} | ConvertTo-Json -Compress
}
