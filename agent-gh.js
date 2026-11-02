#!/usr/bin/env node
// agent-gh: the single git credential helper for https://github.com, plus a gh wrapper.
//   ROOM_AGENT unset -> forward get/store/erase to GCM unchanged (human path).
//   ROOM_AGENT set   -> GitHub App installation token for that agent; never falls back.
//
// Usage:
//   agent-gh credential <get|store|erase>   (called by git)
//   agent-gh whoami
//   agent-gh exec -- gh pr create ...
//   agent-gh exec -- git clone/push ...     (agent mode: OpenSSL + header auth, no helper)
//
// Environment: AGENT_GH_HOME (default ~/.agent-gh), AGENT_GH_GCM (path to git-credential-manager).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const HOME_DIR = process.env.AGENT_GH_HOME || path.join(os.homedir(), '.agent-gh');
const APPS_FILE = path.join(HOME_DIR, 'apps.json');
const GCM = process.env.AGENT_GH_GCM || 'C:\\Program Files\\Git\\mingw64\\bin\\git-credential-manager.exe';
const CACHE_DIR = path.join(os.tmpdir(), 'agent-gh');
const API = 'https://api.github.com';
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

function warn(msg) {
  process.stderr.write(`agent-gh: ${msg}\n`);
}

function loadApp(agent) {
  let apps;
  try {
    apps = JSON.parse(fs.readFileSync(APPS_FILE, 'utf8'));
  } catch (e) {
    throw new Error(`cannot read ${APPS_FILE}: ${e.message}`);
  }
  const app = Object.prototype.hasOwnProperty.call(apps, agent) ? apps[agent] : null;
  if (!app) throw new Error(`unknown agent "${agent}"`);
  const keyPath = path.isAbsolute(app.key) ? app.key : path.join(HOME_DIR, app.key);
  let key;
  try {
    key = fs.readFileSync(keyPath, 'utf8');
  } catch (e) {
    throw new Error(`private key missing for "${agent}": ${keyPath}`);
  }
  return { agent, appId: String(app.appId), slug: app.slug, owner: app.owner, key };
}

function b64url(data) {
  return Buffer.from(data).toString('base64url');
}

function appJwt(app) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: app.appId }));
  let sig;
  try {
    sig = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), app.key);
  } catch (e) {
    throw new Error(`private key for "${app.agent}" is unusable: ${e.message}`);
  }
  return `${header}.${payload}.${b64url(sig)}`;
}

async function api(method, url, auth) {
  const res = await fetch(API + url, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${auth}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'agent-gh',
    },
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> HTTP ${res.status} ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : null;
}

// One installation per App and owner, full installation permissions.
function cachePrefix(agent) {
  return `${agent}-`;
}

function cacheFile(app) {
  return path.join(CACHE_DIR, `${cachePrefix(app.agent)}${app.appId}-${app.owner.toLowerCase()}-full.json`);
}

function readCache(app) {
  try {
    const entry = JSON.parse(fs.readFileSync(cacheFile(app), 'utf8'));
    if (Date.parse(entry.expires_at) - Date.now() > REFRESH_MARGIN_MS) return entry;
  } catch (e) {
    // missing or corrupt cache: fetch a new token
  }
  return null;
}

function writeCache(app, entry) {
  const file = cacheFile(app);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(entry), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (e) {
    warn(`token cache not writable (${e.message}); continuing without cache`);
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

async function getToken(app) {
  const cached = readCache(app);
  if (cached) return cached;
  const jwt = appJwt(app);
  const installs = await api('GET', '/app/installations?per_page=100', jwt);
  const inst = installs.find((i) => i.account && i.account.login.toLowerCase() === app.owner.toLowerCase());
  if (!inst) throw new Error(`${app.slug} is not installed on ${app.owner}`);
  const tok = await api('POST', `/app/installations/${inst.id}/access_tokens`, jwt);
  const entry = { token: tok.token, expires_at: tok.expires_at, installation_id: inst.id };
  writeCache(app, entry);
  return entry;
}

function parseCred(text) {
  const cred = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) cred[line.slice(0, i)] = line.slice(i + 1);
  }
  return cred;
}

function eraseCache(agent, password) {
  let names;
  try {
    names = fs.readdirSync(CACHE_DIR);
  } catch (e) {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(cachePrefix(agent)) || !name.endsWith('.json')) continue;
    const file = path.join(CACHE_DIR, name);
    try {
      const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!password || entry.token === password) fs.unlinkSync(file);
    } catch (e) {
      try { fs.unlinkSync(file); } catch (_) {}
    }
  }
}

function forwardToGcm(action) {
  const r = spawnSync(GCM, [action], { stdio: 'inherit' });
  if (r.error) {
    warn(`cannot run GCM at ${GCM}: ${r.error.message}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = r.status === null ? 1 : r.status;
}

async function credential(action) {
  const agent = process.env.ROOM_AGENT;
  if (!agent) return forwardToGcm(action);

  const cred = parseCred(fs.readFileSync(0, 'utf8'));
  if (action === 'erase') return eraseCache(agent, cred.password);
  if (action !== 'get') return; // agent tokens are never handed to another store

  try {
    if (cred.host !== 'github.com' || (cred.protocol && cred.protocol !== 'https')) {
      throw new Error(`refusing ${cred.protocol}://${cred.host}`);
    }
    const { token } = await getToken(loadApp(agent));
    process.stdout.write(`protocol=https\nhost=github.com\nusername=x-access-token\npassword=${token}\n`);
  } catch (e) {
    warn(`${e.message}; ROOM_AGENT=${agent} will not fall back to another account`);
    process.stdout.write('quit=true\n');
  }
}

function gitVar(name) {
  const r = spawnSync('git', ['var', name], { encoding: 'utf8' });
  if (r.error) return `(git var failed: ${r.error.code || r.error.message})`;
  return ((r.stdout || '') + (r.stderr || '')).trim();
}

// Codex/DSH sandboxes refuse piped spawnSync (EPERM), so prefer the env vars git itself reads.
function ident(role) {
  const name = process.env[`GIT_${role}_NAME`];
  const email = process.env[`GIT_${role}_EMAIL`];
  if (name && email) return `${name} <${email}> (from env)`;
  return gitVar(`GIT_${role}_IDENT`);
}

async function whoami() {
  const agent = process.env.ROOM_AGENT;
  console.log(`agent:      ${agent || '(unset: human path via GCM)'}`);
  console.log(`author:     ${ident('AUTHOR')}`);
  console.log(`committer:  ${ident('COMMITTER')}`);
  if (!agent) return;
  const app = loadApp(agent);
  const entry = await getToken(app);
  console.log(`app:        ${app.slug} (App ID ${app.appId}) on ${app.owner}, installation ${entry.installation_id}`);
  console.log(`credential: installation token, expires ${entry.expires_at}`);
  const repos = await api('GET', '/installation/repositories?per_page=100', entry.token);
  const names = repos.repositories.map((r) => r.full_name);
  console.log(`repos:      ${names.length ? names.join(', ') : '(none)'}`);
}

async function exec(args) {
  if (args[0] === '--') args = args.slice(1);
  if (!args.length) throw new Error('usage: agent-gh exec -- <command> [args...]');
  const env = { ...process.env };
  const agent = process.env.ROOM_AGENT;
  if (agent) {
    const { token } = await getToken(loadApp(agent));
    env.GH_TOKEN = token;
    env.GITHUB_TOKEN = token;
    delete env.GH_ENTERPRISE_TOKEN;
    delete env.GITHUB_ENTERPRISE_TOKEN;
    // Codex/DSH sandboxes break two things git needs: schannel (SEC_E_NO_CREDENTIALS) and
    // sh.exe, which Git for Windows uses to launch every credential helper. So git started
    // from here uses OpenSSL and gets the token as a github.com-scoped header instead of
    // through a helper. Appended to any existing GIT_CONFIG_* entries.
    const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
    const entries = [
      ['http.sslBackend', 'openssl'],
      ['credential.https://github.com.helper', ''],
      ['http.https://github.com/.extraHeader', `Authorization: Basic ${basic}`],
    ];
    let n = Number.parseInt(env.GIT_CONFIG_COUNT || '0', 10) || 0;
    for (const [key, value] of entries) {
      env[`GIT_CONFIG_KEY_${n}`] = key;
      env[`GIT_CONFIG_VALUE_${n}`] = value;
      n += 1;
    }
    env.GIT_CONFIG_COUNT = String(n);
    env.GIT_TERMINAL_PROMPT = '0';
  }
  const r = spawnSync(args[0], args.slice(1), { stdio: 'inherit', env });
  if (r.error) throw new Error(`cannot run ${args[0]}: ${r.error.message}`);
  process.exitCode = r.status === null ? 1 : r.status;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === 'credential') return await credential(rest[0]);
    if (cmd === 'whoami') return await whoami();
    if (cmd === 'exec') return await exec(rest);
    throw new Error('usage: agent-gh <credential get|store|erase | whoami | exec -- cmd...>');
  } catch (e) {
    warn(e.message);
    process.exitCode = 1;
  }
}

main();
