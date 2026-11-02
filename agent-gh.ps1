$node = if ($env:AGENT_GH_NODE) { $env:AGENT_GH_NODE } else { 'node' }
try {
    if ($MyInvocation.ExpectingInput) {
        $input | & $node "$PSScriptRoot\agent-gh.js" @args
    } else {
        & $node "$PSScriptRoot\agent-gh.js" @args
    }
} catch {
    [Console]::Error.WriteLine("agent-gh: $($_.Exception.Message)")
    exit 1
}
exit $LASTEXITCODE
