<div align="center">

# agent-gh

**One GitHub identity for each AI agent on a shared machine.**

**English** · [简体中文](README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node.js 18+](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)
![Windows](https://img.shields.io/badge/platform-Windows-0078D6?logo=windows&logoColor=white)
![No dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)

</div>

Agents under one OS user often share Git author settings and GitHub credentials. agent-gh pairs each agent with a GitHub App so commits and PRs carry its bot identity, while the human keeps using existing credentials.

<table>
<tr>
<td><b>Before</b></td>
<td><b>After</b></td>
</tr>
<tr>
<td>

```
alice  committed  3 minutes ago
alice  committed  5 minutes ago
alice  opened PR #12
```

</td>
<td>

```
claude[bot]  committed  3 minutes ago
codex[bot]   committed  5 minutes ago
claude[bot]  opened PR #12
```

</td>
</tr>
</table>

## Contents

- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Usage](#usage)
- [Configuration](#configuration)
- [Notes](#notes)
- [License](#license)

## How it works

Configure agent-gh as the sole credential helper for github.com. It selects credentials using `ROOM_AGENT`; `exec` also supplies credentials to GitHub CLI.

```
              git / gh
                 |
             agent-gh
         ROOM_AGENT set?
          /            \
        no              yes
        |                |
  Git Credential    GitHub App private key
  Manager (human)   -> installation token (1 h, cached)
```

| `ROOM_AGENT` | Credential |
|---|---|
| unset | Existing credentials through Git Credential Manager |
| `claude`, `codex`, ... | The matching App installation token |
| set, but something fails | Returns `quit=true` and stops authentication |

## Quick start

### 1. Create a GitHub App per agent

Disable webhooks, grant Contents, Pull requests and Issues read/write access, and install the App on the repositories it needs. Download its private key.

### 2. Install

Install Node.js 18+, then place the program files, keys and an `apps.json` based on [the example](apps.example.json) in this directory:

```
~/.agent-gh/
├── agent-gh.js
├── agent-gh          # bash entry
├── agent-gh.ps1      # PowerShell entry
├── agent-gh.cmd      # cmd entry
├── apps.json         # copy from apps.example.json
├── claude.pem
└── codex.pem
```

Fill in the App IDs, slugs, owners and key filenames in `apps.json`, then add the directory to `PATH`.

### 3. Point git at agent-gh

```ini
[credential "https://github.com"]
	helper =
	helper = !\"C:/Program Files/nodejs/node.exe\" C:/Users/<you>/.agent-gh/agent-gh.js credential
```

Back up `~/.gitconfig` and adjust the paths above. The empty `helper =` entry clears inherited helpers for github.com; other hosts retain their settings. Remove this section with `git config --global --remove-section credential.https://github.com`, or restore your backup if it contained earlier settings.

### 4. Give each agent its identity

```
ROOM_AGENT=claude
GIT_AUTHOR_NAME=your-org-claude[bot]
GIT_AUTHOR_EMAIL=<bot-user-id>+your-org-claude[bot]@users.noreply.github.com
GIT_COMMITTER_NAME=your-org-claude[bot]
GIT_COMMITTER_EMAIL=<bot-user-id>+your-org-claude[bot]@users.noreply.github.com
```

| Agent | Where to set it |
|---|---|
| Claude Code | `~/.claude/settings.json` → `env` |
| Codex | `~/.codex/config.toml` → `[shell_environment_policy.set]` |
| Others | Child-process environment settings |

Use your App slug in the name and email fields. The bot user ID differs from the App ID: query it with `gh api users/your-org-claude%5Bbot%5D --jq .id`. Set the five variables separately for each agent.

## Usage

```
agent-gh whoami                      # identity, App, accessible repos
agent-gh exec -- gh pr create ...    # gh with a fresh GH_TOKEN
agent-gh exec -- git push ...        # git without a credential helper
```

Use ordinary `git push` when the helper can run. In sandboxes that block schannel or `sh.exe`, use `exec`: it selects OpenSSL, clears the github.com helper chain and supplies a github.com-scoped Authorization header through `GIT_CONFIG_*`. These settings stay in the child environment and are not written to gitconfig.

### Windows arguments

PowerShell selects `agent-gh.ps1` ahead of `agent-gh.cmd` in the same directory. The PowerShell entry avoids cmd's extra interpretation of arguments. Always put `--` immediately after `exec`: PowerShell consumes the first `--` when calling a script, so `agent-gh exec -- git log -- file` preserves the target command's `--`.

In cmd.exe, the `.cmd` entry still interprets unquoted `& | ^`; `%VAR%` expands even inside double quotes. For arguments containing these characters, use PowerShell or Git Bash; you can also bypass the entry by calling Node directly from PowerShell:

```powershell
node "$env:USERPROFILE\.agent-gh\agent-gh.js" exec -- gh api 'repos/example/project/actions/runs?branch=main&per_page=5'
```

PowerShell 5.1 still has limitations passing embedded double quotes to native programs; the new entry does not fix those.

With execution policy `Restricted`, PowerShell rejects the `.ps1` entry instead of falling back to `.cmd`. Either omit/remove only `agent-gh.ps1` and use the direct Node invocation above for special arguments, or, if your machine's policy permits scripts, choose `RemoteSigned` for `CurrentUser` with `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`. Organization policies can take precedence. The offline entry checks run with `powershell.exe -NoProfile -File tests/powershell-entry.ps1`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ROOM_AGENT` | unset | Agent name matching an `apps.json` entry |
| `AGENT_GH_HOME` | `~/.agent-gh` | Directory for `apps.json` and relative key paths |
| `AGENT_GH_GCM` | Git for Windows GCM path | Git Credential Manager executable for the human path |
| `AGENT_GH_NODE` | `node` | Node executable used by the launchers |

## Notes

- Each App has its own attribution and repository permissions. Processes under the same OS user can read one another's keys.
- Tokens last up to one hour and are cached in the system temporary directory under `agent-gh/`. Files request mode `0600`; Windows access follows the directory ACLs. A matching Git `erase` request removes the cached token.
- Under `exec`, child processes and hooks can read credentials. Avoid `git config --list` and `GIT_CURL_VERBOSE` there, as they can expose credentials.
- Git authentication covers HTTPS to github.com. SSH and IDE or desktop buttons with their own authentication need separate setup.
- Each App entry selects one installation for its owner, without per-repository routing.
- agent-gh does not sign commits. Verified requires separate commit signing.

## License

[MIT](LICENSE) © 2026 AI Girls Institute
