# TenderAssist setup: make sure the DSC signer can run.
#
# The portal's DSC signer is a .jnlp file, opened by OpenWebStart, which needs
# Java 8 or newer. The installer runs this script after copying the app: it
# looks for both, downloads only what is missing (fixed versions, each file
# checked against its published SHA-256), and installs it silently. Installing
# needs administrator rights, so Windows asks once (UAC) when something is
# missing. Nothing here stops TenderAssist from installing: if a step fails,
# the app still offers the OpenWebStart download before a search.
#
#   -DryRun   detect and download only; install nothing
#   -Install  internal: the elevated half that runs the downloaded installers

param(
  [switch]$DryRun,
  [switch]$Install,
  [string]$JavaMsi = '',
  [string]$OwsExe = '',
  [string]$LogPath = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # The progress bar makes downloads in Windows PowerShell 5 many times slower.

$Java = @{
  Name   = 'Eclipse Temurin 8 (Java)'
  Url    = 'https://github.com/adoptium/temurin8-binaries/releases/download/jdk8u504-b01/OpenJDK8U-jre_x64_windows_hotspot_8u504b01.msi'
  Sha256 = '087a67240cd659a35dd894ee1201ec1f989e244cbe29500f4fc0f00443850d09'
  File   = 'OpenJDK8U-jre_x64_windows_hotspot_8u504b01.msi'
}
$Ows = @{
  Name   = 'OpenWebStart 1.14.0'
  Url    = 'https://github.com/karakun/OpenWebStart/releases/download/v1.14.0/OpenWebStart_windows-x64_1_14_0.exe'
  Sha256 = '1088d635e685cd4161f2d900f1e20d564da33138934b338060ddb8d826eb3c99'
  File   = 'OpenWebStart_windows-x64_1_14_0.exe'
}

function Say([string]$text) {
  # Straight to the console (the installer's details list), never into a function's return value.
  [Console]::Out.WriteLine($text)
  if ($LogPath) { Add-Content -Path $LogPath -Value "$(Get-Date -Format s) $text" -ErrorAction SilentlyContinue }
}

# ---------- Detection ----------

function Get-RegValue([string]$path, [string]$name) {
  try { return (Get-ItemProperty -Path $path -Name $name -ErrorAction Stop).$name } catch { return $null }
}

function Test-OpenWebStart {
  # A .jnlp association that opens javaws, or javaws.exe where OpenWebStart installs it.
  $progIds = @(
    (Get-RegValue 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.jnlp\UserChoice' 'ProgId'),
    (Get-RegValue 'Registry::HKEY_CLASSES_ROOT\.jnlp' '(default)')
  ) | Where-Object { $_ }
  foreach ($progId in $progIds) {
    $command = Get-RegValue "Registry::HKEY_CLASSES_ROOT\$progId\shell\open\command" '(default)'
    if ($command -and $command -match '^\s*"?([^"]+?\.exe)') {
      $exe = [Environment]::ExpandEnvironmentVariables($Matches[1])
      if ((Split-Path $exe -Leaf) -match 'javaws|jp2launcher' -and (Test-Path $exe)) { return $exe }
    }
  }
  $roots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, (Join-Path $env:LOCALAPPDATA 'Programs')) | Where-Object { $_ }
  foreach ($root in $roots) {
    foreach ($folder in 'OpenWebStart', 'Open WebStart') {
      $exe = Join-Path (Join-Path $root $folder) 'javaws.exe'
      if (Test-Path $exe) { return $exe }
    }
  }
  return $null
}

# "1.8.0_504" -> 8, "11.0.2" -> 11, "17" -> 17
function Get-JavaMajor([string]$version) {
  if ($version -match '^1\.(\d+)') { return [int]$Matches[1] }
  if ($version -match '^(\d+)') { return [int]$Matches[1] }
  return 0
}

function Test-Java8OrNewer {
  # Registered Java runtimes and JDKs (Oracle, Temurin and most others register here).
  $keys = 'Java Runtime Environment', 'JRE', 'Java Development Kit', 'JDK'
  foreach ($hive in 'HKLM:\SOFTWARE', 'HKLM:\SOFTWARE\WOW6432Node', 'HKCU:\SOFTWARE') {
    foreach ($key in $keys) {
      $base = "$hive\JavaSoft\$key"
      $current = Get-RegValue $base 'CurrentVersion'
      if ($current -and (Get-JavaMajor $current) -ge 8) {
        $javaHome = Get-RegValue "$base\$current" 'JavaHome'
        if (-not $javaHome -or (Test-Path (Join-Path $javaHome 'bin\java.exe'))) { return "Java $current" }
      }
    }
  }
  # Temurin's own keys.
  foreach ($hive in 'HKLM:\SOFTWARE', 'HKCU:\SOFTWARE') {
    foreach ($vendor in 'Eclipse Adoptium', 'Eclipse Foundation', 'AdoptOpenJDK') {
      $root = "$hive\$vendor"
      if (Test-Path $root) {
        foreach ($kind in Get-ChildItem $root -ErrorAction SilentlyContinue) {
          foreach ($version in Get-ChildItem $kind.PSPath -ErrorAction SilentlyContinue) {
            if ((Get-JavaMajor $version.PSChildName) -ge 8) { return "$vendor $($version.PSChildName)" }
          }
        }
      }
    }
  }
  # java.exe on JAVA_HOME or PATH.
  $candidates = @()
  if ($env:JAVA_HOME) { $candidates += (Join-Path $env:JAVA_HOME 'bin\java.exe') }
  $onPath = Get-Command java.exe -ErrorAction SilentlyContinue
  if ($onPath) { $candidates += $onPath.Source }
  foreach ($exe in $candidates | Where-Object { Test-Path $_ }) {
    try {
      $text = (& $exe -version 2>&1 | Out-String)
      if ($text -match 'version "([^"]+)"' -and (Get-JavaMajor $Matches[1]) -ge 8) { return "Java $($Matches[1])" }
    } catch { }
  }
  return $null
}

# ---------- Download ----------

function Get-Verified($item, [string]$folder) {
  $target = Join-Path $folder $item.File
  if ((Test-Path $target) -and ((Get-FileHash $target -Algorithm SHA256).Hash -eq $item.Sha256)) {
    Say "$($item.Name): already downloaded."
    return $target
  }
  Say "Downloading $($item.Name)..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $attempt = 0
  while ($true) {
    $attempt++
    try {
      Invoke-WebRequest -Uri $item.Url -OutFile $target -UseBasicParsing
      break
    } catch {
      if ($attempt -ge 3) { throw "Could not download $($item.Name): $($_.Exception.Message)" }
      Say "Download interrupted, trying again ($attempt of 3)..."
      Start-Sleep -Seconds 3
    }
  }
  $hash = (Get-FileHash $target -Algorithm SHA256).Hash
  if ($hash -ne $item.Sha256) {
    Remove-Item $target -Force -ErrorAction SilentlyContinue
    throw "$($item.Name) did not match its published checksum, so it was not installed."
  }
  Say "$($item.Name): downloaded and checked."
  return $target
}

# ---------- Elevated install ----------

function Install-Downloaded {
  $failed = 0
  if ($JavaMsi) {
    Say "Installing $($Java.Name)..."
    $msiLog = Join-Path (Split-Path $JavaMsi) 'temurin-install.log'
    $features = 'FeatureMain,FeatureEnvironment,FeatureJarFileRunWith,FeatureJavaHome'
    $process = Start-Process msiexec.exe -Wait -PassThru -ArgumentList "/i `"$JavaMsi`" /qn /norestart ADDLOCAL=$features /l*v `"$msiLog`""
    # 3010 = installed, restart suggested.
    if ($process.ExitCode -eq 0 -or $process.ExitCode -eq 3010) { Say "$($Java.Name) installed." }
    else { Say "$($Java.Name) install failed (code $($process.ExitCode))."; $failed++ }
  }
  if ($OwsExe) {
    Say "Installing $($Ows.Name)..."
    # All users, .jnlp files opened by OpenWebStart, and it finds the Java installed above.
    $varfile = Join-Path (Split-Path $OwsExe) 'openwebstart.varfile'
    @(
      'sys.adminRights$Boolean=true',
      'userMode$Integer=1',
      'sys.fileAssociation.extensions$StringArray="jnlp","jnlpx"',
      'sys.fileAssociation.launchers$StringArray="313","313"',
      'ows.jvm.manager.searchLocalAtStartup=true',
      'ows.checkUpdate=false'
    ) | Set-Content -Path $varfile -Encoding ASCII
    $process = Start-Process $OwsExe -Wait -PassThru -ArgumentList '-q', '-varfile', "`"$varfile`"", '-Dinstall4j.suppressUnattendedReboot=true'
    if ($process.ExitCode -eq 0) { Say "$($Ows.Name) installed." }
    else { Say "$($Ows.Name) install failed (code $($process.ExitCode))."; $failed++ }
  }
  return $failed
}

function Test-Admin {
  $identity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  return $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ---------- Main ----------

if ($Install) { exit (Install-Downloaded) }

$folder = Join-Path $env:TEMP 'TenderAssist-setup'
New-Item -ItemType Directory -Force -Path $folder | Out-Null
if (-not $LogPath) { $LogPath = Join-Path $folder 'prereqs.log' }

Say 'Checking for OpenWebStart and Java 8 or newer (needed for the DSC signer)...'
$owsFound = Test-OpenWebStart
$javaFound = Test-Java8OrNewer
if ($owsFound) { Say "OpenWebStart found: $owsFound" } else { Say 'OpenWebStart not found.' }
if ($javaFound) { Say "Java found: $javaFound" } else { Say 'Java 8 or newer not found.' }
if ($owsFound -and $javaFound) { Say 'Everything the DSC signer needs is installed.'; exit 0 }

try {
  $javaMsiPath = if ($javaFound) { '' } else { Get-Verified $Java $folder }
  $owsExePath = if ($owsFound) { '' } else { Get-Verified $Ows $folder }
} catch {
  Say $_.Exception.Message
  Say 'TenderAssist is installed. Check the internet connection and run setup again, or install OpenWebStart from openwebstart.com.'
  exit 2
}

if ($DryRun) { Say 'Dry run: downloads are ready; nothing was installed.'; exit 0 }

$installArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Install', '-LogPath', "`"$LogPath`"")
if ($javaMsiPath) { $installArgs += @('-JavaMsi', "`"$javaMsiPath`"") }
if ($owsExePath) { $installArgs += @('-OwsExe', "`"$owsExePath`"") }

if (Test-Admin) {
  $JavaMsi = $javaMsiPath; $OwsExe = $owsExePath
  $failed = Install-Downloaded
} else {
  Say 'Windows will ask for permission to install them.'
  try {
    $process = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList $installArgs
    $failed = $process.ExitCode
    # The elevated half wrote its steps to the log; show them here too.
    Get-Content $LogPath -ErrorAction SilentlyContinue | Select-Object -Last 6 | ForEach-Object { [Console]::Out.WriteLine($_) }
  } catch {
    Say 'Permission was not given, so OpenWebStart and Java were not installed. TenderAssist will offer the download before a search.'
    exit 3
  }
}

$owsFound = Test-OpenWebStart
$javaFound = Test-Java8OrNewer
if ($owsFound -and $javaFound) { Say 'OpenWebStart and Java are ready for the DSC signer.'; exit 0 }
Say 'Some parts did not install. TenderAssist will offer the OpenWebStart download before a search.'
exit 4
