param(
    [switch]$Stop,
    [switch]$Tunnel,
    [int]$UiPort = 3000
)

$ErrorActionPreference = "Stop"

function Get-EnvFileValue {
    param(
        [string]$Path,
        [string]$Key,
        [string]$DefaultValue = ""
    )

    if (-not (Test-Path $Path)) {
        return $DefaultValue
    }

    foreach ($line in Get-Content -Path $Path) {
        if ($line -match "^\s*$([regex]::Escape($Key))\s*=\s*(.+?)\s*$") {
            $value = $matches[1].Trim()
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            return $value
        }
    }

    return $DefaultValue
}

function Get-YamlScalarValue {
    param(
        [string]$Path,
        [string]$Key,
        [string]$DefaultValue = ""
    )

    if (-not (Test-Path $Path)) {
        return $DefaultValue
    }

    foreach ($line in Get-Content -Path $Path) {
        if ($line -match "^\s*$([regex]::Escape($Key))\s*:\s*(.*?)\s*$") {
            $value = $matches[1].Trim()
            if ($value -eq "") {
                return $DefaultValue
            }
            if ($value.Contains("#")) {
                $value = ($value -split "#", 2)[0].Trim()
            }
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            return $value
        }
    }

    return $DefaultValue
}

function Get-YamlFirstListValue {
    param(
        [string]$Path,
        [string]$Key,
        [string]$DefaultValue = ""
    )

    if (-not (Test-Path $Path)) {
        return $DefaultValue
    }

    $lines = Get-Content -Path $Path
    $insideList = $false

    foreach ($line in $lines) {
        if (-not $insideList) {
            if ($line -match "^\s*$([regex]::Escape($Key))\s*:\s*$") {
                $insideList = $true
            }
            continue
        }

        if ($line -match "^\s*-\s*(.+?)\s*$") {
            $value = $matches[1].Trim()
            if ($value.Contains("#")) {
                $value = ($value -split "#", 2)[0].Trim()
            }
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            return $value
        }

        if ($line -match "^\S") {
            break
        }
    }

    return $DefaultValue
}

function Get-CommandPath {
    param(
        [string[]]$Names
    )

    foreach ($name in $Names) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($null -ne $command) {
            return $command.Source
        }
    }

    return $null
}

function Get-LogTailText {
    param(
        [string]$Path,
        [int]$Lines = 20
    )

    if (-not (Test-Path $Path)) {
        return "(log file not found)"
    }

    $content = Get-Content -Path $Path -Tail $Lines -ErrorAction SilentlyContinue
    if (-not $content) {
        return "(no log output yet)"
    }

    return ($content -join [Environment]::NewLine)
}

function Invoke-TrackedRequest {
    param(
        [string]$Uri,
        [hashtable]$Headers = @{},
        [int]$TimeoutSeconds = 8
    )

    return Invoke-RestMethod -Uri $Uri -Method Get -Headers $Headers -TimeoutSec $TimeoutSeconds
}

function Wait-ForUrl {
    param(
        [string]$Uri,
        [hashtable]$Headers = @{},
        [int]$TimeoutSeconds = 180
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-WebRequest -Uri $Uri -Method Get -Headers $Headers -TimeoutSec 8 -UseBasicParsing | Out-Null
            return $true
        } catch {
            Start-Sleep -Seconds 2
        }
    }

    return $false
}

function Wait-ForPatternInLog {
    param(
        [string]$Path,
        [string]$Pattern,
        [int]$TimeoutSeconds = 60
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Path $Path) {
            $content = Get-Content -Path $Path -Raw -ErrorAction SilentlyContinue
            if ($content -match $Pattern) {
                return $matches[0]
            }
        }
        Start-Sleep -Seconds 1
    }

    return $null
}

function Stop-TrackedProcesses {
    param(
        [string]$PidFilePath
    )

    if (-not (Test-Path $PidFilePath)) {
        return $false
    }

    $state = Get-Content -Path $PidFilePath -Raw | ConvertFrom-Json
    $stoppedAny = $false

    foreach ($propertyName in @("api_pid", "ui_pid", "ui_tunnel_pid", "api_tunnel_pid")) {
        $pidValue = $state.$propertyName
        if (-not $pidValue) {
            continue
        }

        try {
            $process = Get-Process -Id $pidValue -ErrorAction Stop
            Stop-Process -Id $process.Id -Force -ErrorAction Stop
            $stoppedAny = $true
        } catch {
            # Process already exited.
        }
    }

    Remove-Item -Path $PidFilePath -Force -ErrorAction SilentlyContinue
    return $stoppedAny
}

function Get-ListeningProcessIds {
    param(
        [int[]]$Ports
    )

    $normalizedPorts = @($Ports | Where-Object { $_ -gt 0 } | Select-Object -Unique)
    if (-not $normalizedPorts -or $normalizedPorts.Count -eq 0) {
        return @()
    }

    $pids = New-Object System.Collections.Generic.List[int]
    $getNetTcp = Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue
    if ($null -ne $getNetTcp) {
        foreach ($port in $normalizedPorts) {
            try {
                $connections = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop
                foreach ($connection in $connections) {
                    if ($connection.OwningProcess -and $connection.OwningProcess -ne $PID) {
                        [void]$pids.Add([int]$connection.OwningProcess)
                    }
                }
            } catch {
                # Fall back to netstat parsing below.
            }
        }
    }

    if ($pids.Count -eq 0) {
        try {
            $netstatOutput = netstat -ano -p tcp 2>$null
            foreach ($line in $netstatOutput) {
                if ($line -notmatch '^\s*TCP\s+') {
                    continue
                }
                $parts = ($line -split '\s+') | Where-Object { $_ -ne "" }
                if ($parts.Count -lt 5) {
                    continue
                }
                $localAddress = $parts[1]
                $state = $parts[3]
                $owningPid = $parts[4]
                if (-not ($state -eq "LISTENING")) {
                    continue
                }
                $lastColon = $localAddress.LastIndexOf(':')
                if ($lastColon -lt 0) {
                    continue
                }
                $portText = $localAddress.Substring($lastColon + 1)
                $parsedPort = 0
                $parsedPid = 0
                if (-not [int]::TryParse($portText, [ref]$parsedPort)) {
                    continue
                }
                if (-not ($normalizedPorts -contains $parsedPort)) {
                    continue
                }
                if (-not [int]::TryParse($owningPid, [ref]$parsedPid)) {
                    continue
                }
                if ($parsedPid -gt 0 -and $parsedPid -ne $PID) {
                    [void]$pids.Add($parsedPid)
                }
            }
        } catch {
            return @()
        }
    }

    return @($pids | Select-Object -Unique)
}

function Stop-PortListeners {
    param(
        [int[]]$Ports
    )

    $listenerPids = @(Get-ListeningProcessIds -Ports $Ports)
    $stoppedAny = $false
    foreach ($listenerPid in $listenerPids) {
        try {
            Stop-Process -Id $listenerPid -Force -ErrorAction Stop
            $stoppedAny = $true
        } catch {
            # Process may have exited already.
        }
    }

    if ($stoppedAny) {
        Start-Sleep -Milliseconds 750
    }

    return $stoppedAny
}

function Ensure-LocalBootstrapFiles {
    param(
        [string]$ConfigPath,
        [string]$ConfigExamplePath,
        [string]$EnvPath,
        [string]$EnvExamplePath
    )

    $created = New-Object System.Collections.Generic.List[string]
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)

    if (-not (Test-Path $ConfigPath)) {
        if (Test-Path $ConfigExamplePath) {
            $configText = Get-Content -Path $ConfigExamplePath -Raw
        } else {
            $configText = @"
host: "127.0.0.1"
port: 8317

remote-management:
  allow-remote: false
  secret-key: ""

auth-dir: "~/.voltgate"

api-keys:
  - "voltgate-local-key"

routing:
  strategy: "fill-first"
"@
        }

        $configText = [regex]::Replace($configText, '(?m)^host:\s*.*$', 'host: "127.0.0.1"')
        $configText = [regex]::Replace($configText, '(?m)^(\s*allow-remote:\s*).*$', '${1}false')
        $configText = [regex]::Replace($configText, '(?m)^(\s*secret-key:\s*).*$', '${1}""')
        $configText = [regex]::Replace($configText, '(?ms)^api-keys:\s*\r?\n(?:\s*-\s*.*\r?\n)+', "api-keys:`r`n  - `"voltgate-local-key`"`r`n")
        $configText = [regex]::Replace($configText, '(?m)^(\s*strategy:\s*).*$', '${1}"fill-first" # round-robin (default), fill-first')
        [System.IO.File]::WriteAllText($ConfigPath, $configText, $utf8NoBom)
        [void]$created.Add((Split-Path -Leaf $ConfigPath))
    }

    if (-not (Test-Path $EnvPath)) {
        if (Test-Path $EnvExamplePath) {
            $envText = Get-Content -Path $EnvExamplePath -Raw
        } else {
            $envText = "# Local runtime environment for VoltGate.`r`n"
        }
        [System.IO.File]::WriteAllText($EnvPath, $envText, $utf8NoBom)
        [void]$created.Add((Split-Path -Leaf $EnvPath))
    }

    return @($created)
}

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$uiDir = Join-Path $repoRoot "ui"
$envFile = Join-Path $repoRoot ".env"
$envExampleFile = Join-Path $repoRoot ".env.example"
$configFile = Join-Path $repoRoot "config.yaml"
$configExampleFile = Join-Path $repoRoot "config.example.yaml"
$stateDir = Join-Path $repoRoot ".local-stack"
$pidFile = Join-Path $stateDir "processes.json"
$apiOutLog = Join-Path $stateDir "api.out.log"
$apiErrLog = Join-Path $stateDir "api.err.log"
$uiOutLog = Join-Path $stateDir "ui.out.log"
$uiErrLog = Join-Path $stateDir "ui.err.log"
$uiInstallLog = Join-Path $stateDir "ui.install.log"
$uiBuildLog = Join-Path $stateDir "ui.build.log"
$uiTunnelOutLog = Join-Path $stateDir "ui-tunnel.out.log"
$uiTunnelErrLog = Join-Path $stateDir "ui-tunnel.err.log"
$apiTunnelOutLog = Join-Path $stateDir "api-tunnel.out.log"
$apiTunnelErrLog = Join-Path $stateDir "api-tunnel.err.log"

if ($Stop) {
    $stopApiPort = 8317
    if (Test-Path $configFile) {
        $stopApiPort = [int](Get-YamlScalarValue -Path $configFile -Key "port" -DefaultValue "8317")
    }
    $stoppedTracked = Stop-TrackedProcesses -PidFilePath $pidFile
    $stoppedPorts = Stop-PortListeners -Ports @($stopApiPort, $UiPort)
    if ($stoppedTracked -or $stoppedPorts) {
        Write-Host "Voltgate UI + API stopped."
    } else {
        Write-Host "No tracked Voltgate processes were running."
    }
    exit 0
}

if (-not (Test-Path $uiDir)) {
    throw "Custom UI folder not found: $uiDir"
}

$createdBootstrapFiles = @(Ensure-LocalBootstrapFiles -ConfigPath $configFile -ConfigExamplePath $configExampleFile -EnvPath $envFile -EnvExamplePath $envExampleFile)
if ($createdBootstrapFiles.Count -gt 0) {
    Write-Host ("Created local bootstrap files: " + ($createdBootstrapFiles -join ", "))
}

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
Stop-TrackedProcesses -PidFilePath $pidFile | Out-Null

foreach ($logPath in @($apiOutLog, $apiErrLog, $uiOutLog, $uiErrLog, $uiInstallLog, $uiTunnelOutLog, $uiTunnelErrLog, $apiTunnelOutLog, $apiTunnelErrLog)) {
    Remove-Item -Path $logPath -Force -ErrorAction SilentlyContinue
}

$rawHost = Get-YamlScalarValue -Path $configFile -Key "host" -DefaultValue "127.0.0.1"
$apiPort = Get-YamlScalarValue -Path $configFile -Key "port" -DefaultValue "8317"
$apiKey = Get-YamlFirstListValue -Path $configFile -Key "api-keys" -DefaultValue "voltgate-local-key"

$callHost = $rawHost
if ([string]::IsNullOrWhiteSpace($callHost) -or $callHost -eq "0.0.0.0" -or $callHost -eq "::") {
    $callHost = "127.0.0.1"
}

$apiRoot = "http://$callHost`:$apiPort"
$apiBase = "$apiRoot/v1"
$geminiBase = "$apiRoot/v1beta"
$managementBase = "$apiRoot/v0/management"
$uiBase = "http://127.0.0.1:$UiPort"
$chatUiBase = "$uiBase/chat"
$relativeConfigPath = ".\config.yaml"

Stop-PortListeners -Ports @([int]$apiPort, [int]$UiPort) | Out-Null

$goPath = $null
$apiExePath = $null
foreach ($candidate in @((Join-Path $repoRoot "voltgate.exe"), (Join-Path $repoRoot "voltgate.exe"))) {
    if (Test-Path $candidate) {
        $apiExePath = $candidate
        break
    }
}
if ($apiExePath) {
    $apiRunnerType = "exe"
} else {
    $goPath = Get-CommandPath -Names @("go.exe", "go")
    if (-not $goPath) {
        $goPath = @(
            $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles "Go\bin\go.exe" }),
            $(if ($env:ProgramW6432) { Join-Path $env:ProgramW6432 "Go\bin\go.exe" }),
            $(if ($env:USERPROFILE) { Join-Path $env:USERPROFILE "scoop\apps\go\current\bin\go.exe" })
        ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    }
    if (-not $goPath) {
        throw "Go is not installed and no Voltgate executable was found. Install Go 1.26+ or place a built voltgate.exe in the repo root."
    }
    $apiRunnerType = "go"
}

$npmPath = Get-CommandPath -Names @("npm.cmd", "npm")
if (-not $npmPath) {
    throw "npm was not found. Install Node.js first."
}

$cloudflaredPath = $null
if ($Tunnel) {
    $cloudflaredPath = Get-CommandPath -Names @("cloudflared.exe", "cloudflared")
    if (-not $cloudflaredPath) {
        $cloudflaredCandidates = @(
            $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles "cloudflared\cloudflared.exe" }),
            $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} "cloudflared\cloudflared.exe" }),
            $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\cloudflared.exe" }),
            $(if ($env:USERPROFILE) { Join-Path $env:USERPROFILE ".cloudflared\cloudflared.exe" }),
            $(if ($env:USERPROFILE) { Join-Path $env:USERPROFILE "scoop\shims\cloudflared.exe" })
        ) | Where-Object { $_ -and (Test-Path $_) }
        $cloudflaredPath = $cloudflaredCandidates | Select-Object -First 1
    }
    if (-not $cloudflaredPath) {
        throw "cloudflared was not found. Install Cloudflare Tunnel first, or rerun without -Tunnel."
    }
}

$env:LOCAL_PROXY_API_ORIGIN = $apiRoot
$env:VOLTGATE_STATE_FILE = $pidFile
Remove-Item Env:NEXT_PUBLIC_MANAGEMENT_BASE_URL -ErrorAction SilentlyContinue

if (-not (Test-Path (Join-Path $uiDir "node_modules"))) {
    Write-Host "Installing UI dependencies (first run only)..."
    Push-Location $uiDir
    try {
        & $npmPath install --no-fund --no-audit *> $uiInstallLog
        if ($LASTEXITCODE -ne 0) {
            throw "npm install failed. See $uiInstallLog"
        }
    } finally {
        Pop-Location
    }
}

Write-Host "Starting Voltgate backend..."
if ($apiRunnerType -eq "exe") {
    $apiProcess = Start-Process -FilePath $apiExePath `
        -ArgumentList @("-config=./config.yaml") `
        -WorkingDirectory $repoRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $apiOutLog `
        -RedirectStandardError $apiErrLog `
        -PassThru
} else {
    $apiProcess = Start-Process -FilePath $goPath `
        -ArgumentList @("run", "./cmd/server", "-config=./config.yaml") `
        -WorkingDirectory $repoRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $apiOutLog `
        -RedirectStandardError $apiErrLog `
        -PassThru
}

if (-not (Wait-ForUrl -Uri "$apiRoot/")) {
    $apiOutTail = Get-LogTailText -Path $apiOutLog
    $apiErrTail = Get-LogTailText -Path $apiErrLog
    throw "Backend did not start in time. Check $apiOutLog and $apiErrLog`n`nRecent stdout:`n$apiOutTail`n`nRecent stderr:`n$apiErrTail"
}

if (-not (Wait-ForUrl -Uri "$managementBase/auth-files")) {
    $apiOutTail = Get-LogTailText -Path $apiOutLog
    $apiErrTail = Get-LogTailText -Path $apiErrLog
    throw "Management API did not come up correctly. Check $apiOutLog and $apiErrLog`n`nRecent stdout:`n$apiOutTail`n`nRecent stderr:`n$apiErrTail"
}

if (-not (Wait-ForUrl -Uri "$apiBase/models" -Headers @{ Authorization = "Bearer $apiKey" })) {
    $apiOutTail = Get-LogTailText -Path $apiOutLog
    $apiErrTail = Get-LogTailText -Path $apiErrLog
    throw "Main API did not come up correctly. Check $apiOutLog and $apiErrLog`n`nRecent stdout:`n$apiOutTail`n`nRecent stderr:`n$apiErrTail"
}

Write-Host "Building Voltgate UI for production..."
Push-Location $uiDir
try {
    & $npmPath run build *> $uiBuildLog
    if ($LASTEXITCODE -ne 0) {
        throw "npm run build failed. See $uiBuildLog"
    }
} finally {
    Pop-Location
}

Write-Host "Starting Voltgate UI..."
$uiProcess = Start-Process -FilePath $npmPath `
    -ArgumentList @("run", "start", "--", "--hostname", "127.0.0.1", "--port", "$UiPort") `
    -WorkingDirectory $uiDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $uiOutLog `
    -RedirectStandardError $uiErrLog `
    -PassThru

if (-not (Wait-ForUrl -Uri $uiBase)) {
    throw "UI did not start in time. Check $uiOutLog and $uiErrLog"
}

$uiTunnelProcess = $null
$apiTunnelProcess = $null
$uiTunnelUrl = ""
$apiTunnelUrl = ""

if ($Tunnel) {
    Write-Host "Starting Cloudflare quick tunnels for Voltgate..."

    $uiTunnelProcess = Start-Process -FilePath $cloudflaredPath `
        -ArgumentList @("tunnel", "--url", $uiBase, "--no-autoupdate") `
        -WorkingDirectory $repoRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $uiTunnelOutLog `
        -RedirectStandardError $uiTunnelErrLog `
        -PassThru

    $apiTunnelProcess = Start-Process -FilePath $cloudflaredPath `
        -ArgumentList @("tunnel", "--url", $apiRoot, "--no-autoupdate") `
        -WorkingDirectory $repoRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $apiTunnelOutLog `
        -RedirectStandardError $apiTunnelErrLog `
        -PassThru

    $tunnelPattern = "https://[-a-z0-9]+\.trycloudflare\.com"
    $uiTunnelUrl = Wait-ForPatternInLog -Path $uiTunnelOutLog -Pattern $tunnelPattern -TimeoutSeconds 60
    if (-not $uiTunnelUrl) {
        $uiTunnelUrl = Wait-ForPatternInLog -Path $uiTunnelErrLog -Pattern $tunnelPattern -TimeoutSeconds 20
    }
    $apiTunnelUrl = Wait-ForPatternInLog -Path $apiTunnelOutLog -Pattern $tunnelPattern -TimeoutSeconds 60
    if (-not $apiTunnelUrl) {
        $apiTunnelUrl = Wait-ForPatternInLog -Path $apiTunnelErrLog -Pattern $tunnelPattern -TimeoutSeconds 20
    }

    if (-not $uiTunnelUrl) {
        $uiTunnelOutTail = Get-LogTailText -Path $uiTunnelOutLog
        $uiTunnelErrTail = Get-LogTailText -Path $uiTunnelErrLog
        throw "UI quick tunnel did not start correctly. Check $uiTunnelOutLog and $uiTunnelErrLog`n`nRecent stdout:`n$uiTunnelOutTail`n`nRecent stderr:`n$uiTunnelErrTail"
    }
    if (-not $apiTunnelUrl) {
        $apiTunnelOutTail = Get-LogTailText -Path $apiTunnelOutLog
        $apiTunnelErrTail = Get-LogTailText -Path $apiTunnelErrLog
        throw "API quick tunnel did not start correctly. Check $apiTunnelOutLog and $apiTunnelErrLog`n`nRecent stdout:`n$apiTunnelOutTail`n`nRecent stderr:`n$apiTunnelErrTail"
    }
    if (-not (Wait-ForUrl -Uri $uiTunnelUrl -TimeoutSeconds 120)) {
        $uiTunnelOutTail = Get-LogTailText -Path $uiTunnelOutLog
        $uiTunnelErrTail = Get-LogTailText -Path $uiTunnelErrLog
        throw "UI quick tunnel URL did not become reachable: $uiTunnelUrl`n`nRecent stdout:`n$uiTunnelOutTail`n`nRecent stderr:`n$uiTunnelErrTail"
    }
    if (-not (Wait-ForUrl -Uri ($apiTunnelUrl.TrimEnd('/') + "/") -TimeoutSeconds 120)) {
        $apiTunnelOutTail = Get-LogTailText -Path $apiTunnelOutLog
        $apiTunnelErrTail = Get-LogTailText -Path $apiTunnelErrLog
        throw "API quick tunnel URL did not become reachable: $apiTunnelUrl`n`nRecent stdout:`n$apiTunnelOutTail`n`nRecent stderr:`n$apiTunnelErrTail"
    }
}

$modelsResponse = $null
$defaultModel = "MODEL_NAME_HERE"
try {
    $modelsResponse = Invoke-TrackedRequest -Uri "$apiBase/models" -Headers @{ Authorization = "Bearer $apiKey" }
    if ($modelsResponse.data -and $modelsResponse.data.Count -gt 0 -and $modelsResponse.data[0].id) {
        $defaultModel = [string]$modelsResponse.data[0].id
    }
} catch {
    # Keep placeholder model name in the printed examples.
}

$state = [pscustomobject]@{
    started_at      = (Get-Date).ToString("o")
    api_pid         = $apiProcess.Id
    ui_pid          = $uiProcess.Id
    ui_tunnel_pid   = $(if ($uiTunnelProcess) { $uiTunnelProcess.Id } else { $null })
    api_tunnel_pid  = $(if ($apiTunnelProcess) { $apiTunnelProcess.Id } else { $null })
    api_root        = $apiRoot
    api_base        = $apiBase
    gemini_base     = $geminiBase
    management_base = $managementBase
    ui_base         = $uiBase
    ui_tunnel_url   = $uiTunnelUrl
    api_tunnel_url  = $apiTunnelUrl
    api_key         = $apiKey
    api_out_log     = $apiOutLog
    api_err_log     = $apiErrLog
    ui_out_log      = $uiOutLog
    ui_err_log      = $uiErrLog
    ui_tunnel_out_log = $uiTunnelOutLog
    ui_tunnel_err_log = $uiTunnelErrLog
    api_tunnel_out_log = $apiTunnelOutLog
    api_tunnel_err_log = $apiTunnelErrLog
}
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($pidFile, ($state | ConvertTo-Json -Depth 4), $utf8NoBom)

Write-Host ""
Write-Host "===================== VOLTGATE READY ====================="
Write-Host "Voltgate UI          : $uiBase"
Write-Host "Voltgate Chat        : $chatUiBase"
Write-Host "Voltgate API         : $apiBase"
Write-Host "Gemini Protocol      : $geminiBase"
Write-Host "Management API       : $managementBase"
if ($Tunnel) {
    $remoteChat = if ($uiTunnelUrl) { "$($uiTunnelUrl.TrimEnd('/'))/chat" } else { "" }
    $remoteApiBase = if ($apiTunnelUrl) { "$($apiTunnelUrl.TrimEnd('/'))/v1" } else { "" }
    $remoteGeminiBase = if ($apiTunnelUrl) { "$($apiTunnelUrl.TrimEnd('/'))/v1beta" } else { "" }
    Write-Host "Remote Chat          : $remoteChat"
    Write-Host "Remote API Base      : $remoteApiBase"
    Write-Host "Remote Gemini Base   : $remoteGeminiBase"
    Write-Host "Remote management    : Account connect/remove stays local on 127.0.0.1"
}
Write-Host "Sample Voltgate Key  : $apiKey"
Write-Host "Detected Test Model  : $defaultModel"
Write-Host ""
Write-Host "How to check your API is working"
Write-Host "1. Open Voltgate:"
Write-Host "   $uiBase"
Write-Host ""
Write-Host "2. In the accounts page, create or copy a client API key."
Write-Host ""
Write-Host "3. Paste that key into the chat page and click Sync Models."
Write-Host ""
Write-Host "4. Check the model list from PowerShell:"
Write-Host "   Invoke-RestMethod -Uri '$apiBase/models' -Headers @{ Authorization = 'Bearer $apiKey' }"
Write-Host ""
Write-Host "5. Check a chat response:"
Write-Host "   `$body = @{"
Write-Host "     model = '$defaultModel'"
Write-Host "     messages = @(@{ role = 'user'; content = 'Reply with: API is working' })"
Write-Host "   } | ConvertTo-Json -Depth 6"
Write-Host "   Invoke-RestMethod -Uri '$apiBase/chat/completions' -Method Post -Headers @{ Authorization = 'Bearer $apiKey'; 'Content-Type' = 'application/json' } -Body `$body"
Write-Host ""
Write-Host "6. Check the OpenAI Responses API:"
Write-Host "   `$body = @{"
Write-Host "     model = '$defaultModel'"
Write-Host "     input = 'Say hello in one short line.'"
Write-Host "   } | ConvertTo-Json -Depth 6"
Write-Host "   Invoke-RestMethod -Uri '$apiBase/responses' -Method Post -Headers @{ Authorization = 'Bearer $apiKey'; 'Content-Type' = 'application/json' } -Body `$body"
Write-Host ""
Write-Host "How to know responses are correct"
Write-Host "1. /v1/models should return JSON with a data array."
Write-Host "2. /v1/chat/completions should return JSON with choices[0].message.content."
Write-Host "3. /v1/responses should return JSON with output text/content fields."
Write-Host ""
try {
    Start-Process $uiBase | Out-Null
    Write-Host "Opened Voltgate UI   : $uiBase"
} catch {
    # Browser auto-open is best-effort only.
}

Write-Host "Logs"
Write-Host "API stdout           : $apiOutLog"
Write-Host "API stderr           : $apiErrLog"
Write-Host "UI build log         : $uiBuildLog"
Write-Host "UI stdout            : $uiOutLog"
Write-Host "UI stderr            : $uiErrLog"
if ($Tunnel) {
    Write-Host "UI tunnel stdout     : $uiTunnelOutLog"
    Write-Host "UI tunnel stderr     : $uiTunnelErrLog"
    Write-Host "API tunnel stdout    : $apiTunnelOutLog"
    Write-Host "API tunnel stderr    : $apiTunnelErrLog"
}
Write-Host ""
Write-Host "Stop Voltgate later with:"
Write-Host "powershell -ExecutionPolicy Bypass -File .\run-local-stack.ps1 -Stop"
Write-Host "========================================================"
