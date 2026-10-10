# Asks the TenderAssist key server whether a key is real and still working
# (the installer's key page). Nothing is changed on the server: the app
# activates the key after a Google sign-in on first start.
#
# The key comes in the TA_KEY environment variable, so nothing typed can
# break the command line. Prints one line for the installer and exits:
#   0  the key is fine (or nothing to check against)
#   2  the key is refused: the line says why
#   3  the server could not be reached: the app checks on first start
param([string]$Server)

$ErrorActionPreference = 'Stop'
$key = "$env:TA_KEY".Trim()
if (-not $Server) { Write-Output 'No key server in this build.'; exit 0 }
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $url = $Server + '?action=peek&key=' + [Uri]::EscapeDataString($key)
  $answer = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 25 -UseBasicParsing
} catch {
  Write-Output 'The key server could not be reached.'
  exit 3
}
# Google answers with a web page, not the server's JSON, when the script is not
# approved yet or is down: that is "not reachable", never "key refused".
if (-not ($answer -is [psobject]) -or $null -eq $answer.PSObject.Properties['ok']) {
  Write-Output 'The key server did not answer properly.'
  exit 3
}
if ($answer.ok) { Write-Output "$($answer.customer)"; exit 0 }
Write-Output "$($answer.message)"
exit 2
