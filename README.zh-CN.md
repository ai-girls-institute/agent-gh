<div align="center">

# agent-gh

**同一台电脑上，每个 AI agent 都有自己的 GitHub 身份。**

[English](README.md) · **简体中文**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node.js 18+](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)
![Windows](https://img.shields.io/badge/platform-Windows-0078D6?logo=windows&logoColor=white)
![No dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)

</div>

多个 agent 使用同一个系统用户时，往往也共用 Git 署名设置和 GitHub 凭据。agent-gh 为每个 agent 对应一个 GitHub App，让提交和 PR 显示各自的 bot 身份，同时保留人的原有凭据流程。

<table>
<tr>
<td><b>之前</b></td>
<td><b>之后</b></td>
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

## 目录

- [工作原理](#工作原理)
- [快速开始](#快速开始)
- [用法](#用法)
- [配置](#配置)
- [说明](#说明)
- [许可证](#许可证)

## 工作原理

将 agent-gh 配为 github.com 唯一的凭据助手，由 `ROOM_AGENT` 选择身份。`exec` 也能为 GitHub CLI 提供凭据。

```
              git / gh
                 |
             agent-gh
       设置了 ROOM_AGENT？
          /            \
        否              是
        |                |
  Git Credential    GitHub App 私钥
  Manager（人）     -> installation token（1 小时，有缓存）
```

| `ROOM_AGENT` | 凭据 |
|---|---|
| 未设置 | 通过 Git Credential Manager 使用原有凭据 |
| `claude`、`codex` 等 | 对应 App 的安装令牌 |
| 已设置但出错 | 返回 `quit=true`，停止认证 |

## 快速开始

### 1. 为每个 agent 建一个 GitHub App

关闭 webhook，授予 Contents、Pull requests 和 Issues 读写权限，将 App 安装到需要访问的仓库，然后下载私钥。

### 2. 安装

安装 Node.js 18+，将程序文件、私钥，以及参照[示例](apps.example.json)填写的 `apps.json` 放到以下目录：

```
~/.agent-gh/
├── agent-gh.js
├── agent-gh          # bash 入口
├── agent-gh.cmd      # cmd / PowerShell 入口
├── apps.json         # 从 apps.example.json 复制
├── claude.pem
└── codex.pem
```

在 `apps.json` 中填写 App ID、slug、所属账号或组织和私钥文件名，再将目录加入 `PATH`。

### 3. 让 git 使用 agent-gh

```ini
[credential "https://github.com"]
	helper =
	helper = !\"C:/Program Files/nodejs/node.exe\" C:/Users/<you>/.agent-gh/agent-gh.js credential
```

先备份 `~/.gitconfig`，并按实际位置调整上面的路径。空的 `helper =` 清除 github.com 继承的凭据助手，其他主机保持原样。运行 `git config --global --remove-section credential.https://github.com` 可移除这一节；如果原先已有设置，请从备份恢复。

### 4. 给每个 agent 设身份

```
ROOM_AGENT=claude
GIT_AUTHOR_NAME=your-org-claude[bot]
GIT_AUTHOR_EMAIL=<bot-user-id>+your-org-claude[bot]@users.noreply.github.com
GIT_COMMITTER_NAME=your-org-claude[bot]
GIT_COMMITTER_EMAIL=<bot-user-id>+your-org-claude[bot]@users.noreply.github.com
```

| Agent | 设置位置 |
|---|---|
| Claude Code | `~/.claude/settings.json` → `env` |
| Codex | `~/.codex/config.toml` → `[shell_environment_policy.set]` |
| 其他 | 子进程环境变量设置 |

将名称和邮箱中的 slug 换成自己的 App slug。bot user ID 与 App ID 不同，可用 `gh api users/your-org-claude%5Bbot%5D --jq .id` 查询。为每个 agent 分别设置五个变量。

## 用法

```
agent-gh whoami                      # 身份、App、可访问的仓库
agent-gh exec -- gh pr create ...    # 用新的 GH_TOKEN 运行 gh
agent-gh exec -- git push ...        # 不经过 credential helper 运行 git
```

凭据助手能运行时，直接使用 `git push` 即可。在拦截 schannel 或 `sh.exe` 的沙箱里使用 `exec`：它通过 `GIT_CONFIG_*` 选择 OpenSSL、清空 github.com 的凭据助手链，并提供限定于 github.com 的 Authorization 请求头。这些设置只在子进程环境中生效，不写入 gitconfig。

## 配置

| 变量 | 默认值 | 作用 |
|---|---|---|
| `ROOM_AGENT` | 未设置 | 与 `apps.json` 条目对应的 agent 名称 |
| `AGENT_GH_HOME` | `~/.agent-gh` | 存放 `apps.json`、解析相对私钥路径的目录 |
| `AGENT_GH_GCM` | Git for Windows 的 GCM 路径 | 人的凭据流程使用的 Git Credential Manager 程序 |
| `AGENT_GH_NODE` | `node` | 启动入口使用的 Node 程序 |

## 说明

- 每个 App 有独立的署名和仓库权限。同一系统用户下的进程仍能读取彼此的私钥。
- 令牌最长有效一小时，缓存在系统临时目录的 `agent-gh` 子目录。文件请求使用 `0600` 权限；Windows 上按目录的 ACL 控制访问。Git 发出匹配的 `erase` 请求时，会删除对应缓存。
- `exec` 的子进程及 hook 可以读取凭据。避免在其中运行 `git config --list` 或开启 `GIT_CURL_VERBOSE`，以免输出凭据。
- Git 认证覆盖 github.com 的 HTTPS 访问。SSH 和自行认证的 IDE、桌面按钮需要单独配置。
- 每个 App 条目选择其所属账号或组织的一次安装，不按仓库分派。
- agent-gh 不负责签名提交。Verified 标记需要另行配置提交签名。

## 许可证

[MIT](LICENSE) © 2026 AI Girls Institute
