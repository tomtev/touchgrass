$ErrorActionPreference = "Stop"

$Repo = "tomtev/touchgrass"
$DefaultInstallDir = Join-Path $HOME ".touchgrass\bin"
$InstallDir = if ($env:TG_INSTALL_DIR) { $env:TG_INSTALL_DIR } else { $DefaultInstallDir }
$BinaryName = "tg.exe"

function Write-Info([string]$Message) {
  Write-Host "  $Message" -ForegroundColor DarkGray
}

function Write-Success([string]$Message) {
  Write-Host "  $Message" -ForegroundColor Green
}

function Fail([string]$Message) {
  throw $Message
}

Write-Host ""
Write-Host "  touchgrass.sh" -ForegroundColor White
Write-Host "  Manage Claude Code, Codex, and more from your phone." -ForegroundColor DarkGray
Write-Host ""

$arch = $null
try {
  $arch = [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString().ToLowerInvariant()
} catch {}
if (-not $arch) {
  # Fallback for Windows PowerShell 5.1 (.NET Framework)
  $arch = $env:PROCESSOR_ARCHITECTURE
  if ($arch -eq "AMD64") { $arch = "x64" }
  elseif ($arch -eq "ARM64") { $arch = "arm64" }
  else { $arch = $arch.ToLowerInvariant() }
}
if ($arch -ne "x64") {
  Fail "Unsupported Windows architecture: $arch (supported: x64)"
}

$target = "windows-x64.exe"
Write-Info "Platform: $target"

Write-Info "Fetching latest release..."
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ "User-Agent" = "touchgrass-installer" }
$latest = $release.tag_name
if (-not $latest) {
  Fail "Could not determine latest release. Check https://github.com/$Repo/releases"
}
Write-Info "Version: $latest"

$downloadUrl = "https://github.com/$Repo/releases/download/$latest/tg-$target"
$tmpFile = Join-Path ([System.IO.Path]::GetTempPath()) ("tg-install-" + [guid]::NewGuid().ToString() + ".exe")

try {
  Write-Info "Downloading..."
  Invoke-WebRequest -Uri $downloadUrl -OutFile $tmpFile -UseBasicParsing
  if (-not (Test-Path $tmpFile) -or ((Get-Item $tmpFile).Length -eq 0)) {
    Fail "Failed to download binary for $target."
  }

  $existingInstall = (Test-Path (Join-Path $InstallDir $BinaryName)) -or (Get-Command tg -ErrorAction SilentlyContinue)

  New-Item -Path $InstallDir -ItemType Directory -Force | Out-Null
  Move-Item -Path $tmpFile -Destination (Join-Path $InstallDir $BinaryName) -Force

  # Try restarting daemon if a pid file exists (best effort).
  $daemonPidFile = Join-Path $HOME ".touchgrass\daemon.pid"
  if (Test-Path $daemonPidFile) {
    try {
      $pidRaw = (Get-Content $daemonPidFile -ErrorAction Stop | Select-Object -First 1).Trim()
      if ($pidRaw) {
        $pid = [int]$pidRaw
        Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
      }
      Remove-Item $daemonPidFile -Force -ErrorAction SilentlyContinue
      Start-Process -FilePath (Join-Path $InstallDir $BinaryName) -ArgumentList "ls" -WindowStyle Hidden | Out-Null
      Write-Info "Daemon restarted"
    } catch {
      # Ignore daemon restart failures
    }
  }

  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $pathParts = @()
  if ($userPath) {
    $pathParts = $userPath -split ";"
  }
  $installDirInPath = $false
  foreach ($part in $pathParts) {
    if ($part.Trim().ToLowerInvariant() -eq $InstallDir.Trim().ToLowerInvariant()) {
      $installDirInPath = $true
      break
    }
  }

  if (-not $installDirInPath) {
    $newPath = if ($userPath -and $userPath.Trim()) { "$InstallDir;$userPath" } else { $InstallDir }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    $env:Path = "$InstallDir;$env:Path"
  }

  Write-Host ""
  if ($existingInstall) {
    Write-Success "Updated touchgrass.sh to $latest"
  } else {
    Write-Success "Installed tg to $(Join-Path $InstallDir $BinaryName)"
    if (-not $installDirInPath) {
      Write-Host ""
      Write-Info "PATH updated for your user account."
      Write-Info "Open a new terminal to pick up changes."
    }
    Write-Host ""
    Write-Success "Run 'tg init' to get started."
  }
  Write-Host ""
}
finally {
  if (Test-Path $tmpFile) {
    Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
  }
}
