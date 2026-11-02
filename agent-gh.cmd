@echo off
setlocal
set "NODE_EXE=%AGENT_GH_NODE%"
if not defined AGENT_GH_NODE set "NODE_EXE=node"
"%NODE_EXE%" "%~dp0agent-gh.js" %*
