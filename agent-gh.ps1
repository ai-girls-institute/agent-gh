$node = if ($env:AGENT_GH_NODE) { $env:AGENT_GH_NODE } else { 'node' }
& $node "$PSScriptRoot\agent-gh.js" @args
exit $LASTEXITCODE
