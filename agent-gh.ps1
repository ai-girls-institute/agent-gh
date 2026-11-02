$node = if ($env:AGENT_GH_NODE) { $env:AGENT_GH_NODE } else { 'node' }
# PowerShell parses comma expressions as arrays; keep each list as one argument.
$passArgs = @(foreach ($argument in $args) {
    if ($argument -is [array]) { $argument -join ',' } else { $argument }
})
try {
    if ($MyInvocation.ExpectingInput) {
        $input | & $node "$PSScriptRoot\agent-gh.js" @passArgs
    } else {
        & $node "$PSScriptRoot\agent-gh.js" @passArgs
    }
} catch {
    [Console]::Error.WriteLine("agent-gh: $($_.Exception.Message)")
    exit 1
}
exit $LASTEXITCODE
