# agent-gh

Give each AI coding agent on a shared machine its own GitHub identity.

When several agents (Claude Code, Codex, other CLI agents) run under one OS user, they share one
`~/.gitconfig` and one `gh` login, so every commit and PR looks like it came from the human. agent-gh
gives each agent its own **GitHub App**: commits are authored by `your-app[bot]`, pushes and PRs use
that App's installation token, and the human's own git keeps working exactly as before.

- One file, Node.js 18+ (uses built-in `fetch` and `crypto`), no dependencies.
- Built and tested on Windows with Git for Windows and Git Credential Manager (GCM).

## How it works

Each agent process carries an environment variable `ROOM_AGENT=<name>` plus the standard
`GIT_AUTHOR_*` / `GIT_COMMITTER_*` variables. agent-gh is the only git credential helper for
`https://github.com`:

| `ROOM_AGENT` | What happens |
|---|---|
| unset (the human) | `get` / `store` / `erase` are forwarded to GCM unchanged |
| set | signs a JWT with that agent's App private key, exchanges it for an installation token (cached until 5 minutes before expiry), returns it to git |

If `ROOM_AGENT` is set and anything goes wrong (unknown agent, missing or broken key, API error,
non-github.com host), the helper answers `quit=true`. **It never falls back to the human's credentials.**

## Setup

1. **Create one GitHub App per agent** (in your org or account): disable the webhook; grant
   Contents, Pull requests and Issues read/write (Metadata read-only is implied); install it on the
   repositories the agent may touch. Download a private key.
2. **Put files in `~/.agent-gh/`** (or set `AGENT_GH_HOME`): `agent-gh.js`, `agent-gh`,
   `agent-gh.cmd`, the `.pem` keys, and an `apps.json` based on [`apps.example.json`](apps.example.json).
   Add the directory to `PATH`.
3. **Make agent-gh the only helper for github.com** in `~/.gitconfig` (the empty line clears helpers
   inherited from the system config, such as GCM):

   ```ini
   [credential "https://github.com"]
   	helper =
   	helper = !\"C:/Program Files/nodejs/node.exe\" C:/Users/<you>/.agent-gh/agent-gh.js credential
   ```

   Other hosts keep their existing helpers. Back up `~/.gitconfig` first; to roll back, run
   `git config --global --remove-section credential.https://github.com`.
4. **Set five variables in each agent's own config**, so they apply wherever that agent is launched:

   ```
   ROOM_AGENT=claude
   GIT_AUTHOR_NAME=your-org-claude[bot]
   GIT_AUTHOR_EMAIL=<bot-user-id>+your-org-claude[bot]@users.noreply.github.com
   GIT_COMMITTER_NAME=your-org-claude[bot]
   GIT_COMMITTER_EMAIL=<bot-user-id>+your-org-claude[bot]@users.noreply.github.com
   ```

   The bot user id is not the App ID: `gh api users/your-org-claude%5Bbot%5D --jq .id`.
   Where to put them: Claude Code `~/.claude/settings.json` (`env`), Codex `~/.codex/config.toml`
   (`[shell_environment_policy.set]`), other tools wherever they define child-process environment.

## Usage

```
agent-gh whoami                          # who am I, which App, which repos
agent-gh exec -- gh pr create ...        # run gh with a fresh token in GH_TOKEN
agent-gh exec -- git push ...            # run git without a credential helper (see below)
```

Plain `git push` works through the helper. Use `exec` when git runs inside a restrictive sandbox:
some agent sandboxes on Windows cannot use schannel (`SEC_E_NO_CREDENTIALS`) or start `sh.exe`
(Git for Windows launches every credential helper through it). In agent mode, `exec` gives the child
git `http.sslBackend=openssl`, an empty helper list, and the token as a github.com-scoped
`Authorization` header, all through `GIT_CONFIG_*` variables. Nothing is written to disk.

Environment overrides: `AGENT_GH_HOME` (config directory), `AGENT_GH_GCM` (path to
`git-credential-manager`), `AGENT_GH_NODE` (node executable used by the wrappers).

## Limitations

- **Attribution, not isolation.** All agents run as the same OS user and can read each other's keys.
  This makes authorship clear and lets you scope repositories per App; it does not stop one agent from
  acting as another.
- Under `exec`, the token is visible in the environment of git and its children (hooks). Do not run
  `git config --list` or enable `GIT_CURL_VERBOSE` under `exec`.
- Only HTTPS to github.com goes through agent-gh. SSH remotes, other hosts, and IDE or desktop-app
  git buttons that use their own credentials are not covered.
- One installation per App and owner; the helper does not route per repository.
- Commits pushed with git are not signed, so they do not show "Verified".

## License

[MIT](LICENSE)
