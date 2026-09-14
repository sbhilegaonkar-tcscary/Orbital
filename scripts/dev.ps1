# One-shot ORBITAL launcher: starts Jupyter, the agent sidecar, and the app
# dev server (each in its own window, only if not already running), waits
# for the app to answer, then opens it in the browser. Replaces running
# scripts/jupyter.ps1, scripts/agent.ps1, and scripts/app.ps1 by hand.
$root = Split-Path -Parent $PSScriptRoot

function Test-HttpUp([string]$Url) {
    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
        return $resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500
    } catch {
        return $false
    }
}

function Test-PortListening([int]$Port) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        if ($null -ne $conn) { return $true }
    } catch {
        # Get-NetTCPConnection may be unavailable; fall through to a raw probe.
    }
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $client.Connect('127.0.0.1', $Port)
        $client.Close()
        return $true
    } catch {
        return $false
    }
}

# Named to avoid shadowing PowerShell's built-in Start-Service cmdlet.
function Start-OrbitalService([string]$Name, [string]$ScriptPath, [scriptblock]$IsUp) {
    if (& $IsUp) {
        Write-Host "$Name`: already running"
    } else {
        # Start-Process joins ArgumentList with spaces into one command line, so
        # a path containing spaces must carry its own quotes.
        $quoted = '"' + $ScriptPath + '"'
        Start-Process powershell -WorkingDirectory $root -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', $quoted
        Write-Host "$Name`: started"
    }
}

Start-OrbitalService 'jupyter' "$root\scripts\jupyter.ps1" { Test-HttpUp 'http://127.0.0.1:8888/api/status?token=orbital-dev' }
Start-OrbitalService 'agent' "$root\scripts\agent.ps1" { Test-PortListening 8787 }
Start-OrbitalService 'app' "$root\scripts\app.ps1" { Test-PortListening 5173 }

$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline -and -not (Test-PortListening 5173)) {
    Start-Sleep -Milliseconds 500
}

Start-Process 'http://localhost:5173'
