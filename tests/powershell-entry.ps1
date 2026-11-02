# Offline checks. Run with Windows PowerShell 5.1 from any directory.
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$testDir = Join-Path $PSScriptRoot (([guid]::NewGuid().ToString('N')) + '.tmp')
$probe = Join-Path $testDir 'probe.js'
$stdinProbe = Join-Path $testDir 'stdin-probe.js'
$stderrProbe = Join-Path $testDir 'stderr-probe.js'
$cmdDriver = Join-Path $testDir 'cmd-check.cmd'
$savedEnvironment = @{}
foreach ($name in @('PATH', 'ROOM_AGENT', 'GH_TOKEN', 'GITHUB_TOKEN',
                    'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'AGENT_GH_NODE')) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

function Assert-Arguments([string]$ActualText, [string[]]$Expected) {
    $received = ConvertFrom-Json -InputObject $ActualText
    if ($received.Count -ne $Expected.Count) {
        throw "Argument count mismatch: $ActualText"
    }
    for ($index = 0; $index -lt $Expected.Count; $index++) {
        if ($received[$index] -cne $Expected[$index]) {
            throw "Argument $index mismatch: $ActualText"
        }
    }
}

function Invoke-StderrProbe {
    # Model a normal caller redirecting native stderr, without promoting it to an exception.
    $ErrorActionPreference = 'Continue'
    $output = agent-gh exec -- node $stderrProbe 2>&1
    [pscustomobject]@{ Code = $LASTEXITCODE; Text = ($output | Out-String) }
}

try {
    $nodeExe = (Get-Command node -CommandType Application).Source
    $env:PATH = $repoRoot + [IO.Path]::PathSeparator + $env:PATH
    foreach ($name in @('ROOM_AGENT', 'GH_TOKEN', 'GITHUB_TOKEN',
                        'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN')) {
        [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
    $env:AGENT_GH_NODE = $nodeExe
    New-Item -ItemType Directory -Path $testDir | Out-Null
    [IO.File]::WriteAllText($probe, 'console.log(JSON.stringify(process.argv.slice(2)));')
    [IO.File]::WriteAllText($stdinProbe, 'console.log(JSON.stringify(require("fs").readFileSync(0, "utf8")));')
    [IO.File]::WriteAllText($stderrProbe, 'console.log("stdout-marker"); console.error("stderr-marker");')

    $resolved = (Get-Command agent-gh).Source
    if ($resolved -ne (Join-Path $repoRoot 'agent-gh.ps1')) {
        throw "Expected repository PowerShell entry, got: $resolved"
    }
    Write-Output 'PASS 1: PATH selects agent-gh.ps1'

    $expected = @('runs?a=1&per_page=5', 'x y&z', 'a|b', 'c^d',
                  '%OS%', 'x %OS%', '-X', 'GET', '--jq', '.x[] | {id: .id}')
    $actual = agent-gh exec -- node $probe @expected
    if ($LASTEXITCODE -ne 0) { throw 'Argument probe failed' }
    Assert-Arguments ($actual -join "`n") $expected
    Write-Output 'PASS 2: special arguments remain literal and separate'

    agent-gh exec -- node -e 'process.exit(3)'
    if ($LASTEXITCODE -ne 3) { throw 'Child exit code was not preserved' }
    Write-Output 'PASS 3: child exit code 3 is preserved'

    $actual = agent-gh exec -- node $probe git log -- file
    if ($LASTEXITCODE -ne 0) { throw 'Separator probe failed' }
    Assert-Arguments ($actual -join "`n") @('git', 'log', '--', 'file')
    Write-Output 'PASS 4: target command keeps its -- separator'

    $driver = "@echo off`r`n" +
        ('call "{0}" exec -- "{1}" "{2}" "cmd smoke"' -f
            (Join-Path $repoRoot 'agent-gh.cmd'), $nodeExe, $probe) +
        "`r`nexit /b %errorlevel%`r`n"
    [IO.File]::WriteAllText($cmdDriver, $driver)
    $actual = & $cmdDriver
    if ($LASTEXITCODE -ne 0) { throw 'cmd entry smoke check failed' }
    Assert-Arguments ($actual -join "`n") @('cmd smoke')
    Write-Output 'PASS 5: existing cmd entry still runs through cmd.exe'

    $payload = "protocol=https`nhost=example.invalid"
    $direct = $payload | & $nodeExe $stdinProbe
    if ($LASTEXITCODE -ne 0) { throw 'Direct stdin probe failed' }
    $actual = $payload | agent-gh exec -- node $stdinProbe
    if ($LASTEXITCODE -ne 0) { throw 'Wrapped stdin probe failed' }
    if (($actual -join "`n") -cne ($direct -join "`n") -or
        [string]::IsNullOrEmpty((ConvertFrom-Json -InputObject ($actual -join "`n")))) {
        throw 'Pipeline input was not preserved'
    }
    Write-Output 'PASS 6: pipeline input matches direct Node input'

    $env:AGENT_GH_NODE = Join-Path $testDir 'missing-node.exe'
    $global:LASTEXITCODE = 0
    agent-gh exec -- node $probe
    if ($LASTEXITCODE -ne 1) { throw 'Missing Node did not produce exit code 1' }
    $env:AGENT_GH_NODE = $nodeExe
    Write-Output 'PASS 7: missing Node returns 1 instead of a stale success code'

    $stderrResult = Invoke-StderrProbe
    if ($stderrResult.Code -ne 0 -or $stderrResult.Text -notmatch 'stdout-marker' -or
        $stderrResult.Text -notmatch 'stderr-marker') {
        throw 'Redirected native stderr was mistaken for a launch failure'
    }
    Write-Output 'PASS 8: redirected stderr preserves output and exit code 0'
} finally {
    foreach ($name in $savedEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
    }
    # Delete only these known test files, then remove the empty test directory.
    Remove-Item -LiteralPath $probe, $stdinProbe, $stderrProbe, $cmdDriver -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $testDir -Force -ErrorAction SilentlyContinue
}
exit 0
