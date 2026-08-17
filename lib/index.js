/**
 * dsh-skill-sidebar — host half.
 *
 * Scans the local skill roots (~/.agents/skills by default, plus any
 * directory in $DSH_SKILL_DIRS) for directory-bundle skills (SKILL.md) and
 * flat Markdown skills, extracting `name` / `description` / `whenToUse` from
 * the YAML frontmatter (a tiny hand-rolled parser — no dependencies). The
 * result is persisted to ~/.dsh/storages/dsh-skill-sidebar/skills.json so a
 * later boot can serve it WITHOUT re-reading every skill file ("下次启动后打开就能
 * 列出，无须再次读取").
 *
 * Refresh policy:
 *  - on boot: reuse the persisted cache unless it is stale (> 7 days) or
 *    today is Monday and the cache was not produced today — then re-scan;
 *  - continuous: a recursive fs.watch on the skill root re-scans (debounced)
 *    whenever a skill is installed/changed/removed ("自动添加到技能列表"), with a
 *    5-minute poll as a belt-and-suspenders fallback;
 *  - every Monday: a 6-hourly timer forces a full re-read of all skills
 *    ("每周一重新读取本机所有技能进行更新").
 *
 * Routes (same browser-trust fence as the /api gateway — loopback Host or the
 * connection row's trustedHosts):
 *   GET /skillpanel/skills          -> cached machine-wide skill list
 *   GET /skillpanel/skills/refresh  -> force a re-scan, then return the list
 *
 * The client half prefers the live per-session catalog
 * (connection.api.skills.list) and uses these routes as the instant/offline
 * fallback.
 */
import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises'
import { watch, readFileSync, appendFileSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

/** Stable Cordis plugin name (matches the loader row id in cordis.patch.yml). */
export const name = 'skill-sidebar'
/** Services required before mounting: the webserver routes + the loader's connection row (for the fence). */
export const inject = ['webServer', 'loader']

/** File-based request log for /skillpanel/skills (diagnostics; survives the cordis logger being unattached). */
const REQUEST_LOG = 'E:\\dsh-web\\插件技能安装\\route-hit.log'

/** The weekday number for Monday (Date#getDay). */
const MONDAY = 1
/** A cache older than this is considered stale and triggers a re-scan on boot. */
const STALE_MS = 7 * 24 * 60 * 60 * 1000
/** Debounce window for filesystem watcher events. */
const WATCH_DEBOUNCE_MS = 500
/** Fallback poll interval (watcher unsupported / missed events). */
const POLL_MS = 5 * 60 * 1000
/** Monday-policy timer: every 6 hours, re-scan if today is Monday and the cache predates today. */
const MONDAY_CHECK_MS = 6 * 60 * 60 * 1000

/* ------------------------------------------------------------------ */
/* skill roots & cache paths                                           */
/* ------------------------------------------------------------------ */

/** The agents home (defaults to ~/.agents, honoring $DSH_AGENTS_HOME like dsh-skill-filesystem). */
function agentsHome() {
  return process.env.DSH_AGENTS_HOME || join(homedir(), '.agents')
}

/** The primary skill root: <agentsHome>/skills. */
function skillsRoot() {
  return join(agentsHome(), 'skills')
}

/** Extra skill roots from $DSH_SKILL_DIRS (path.delimiter separated). */
function extraRoots() {
  const raw = process.env.DSH_SKILL_DIRS
  if (!raw) return []
  return raw.split(';').map((s) => s.trim()).filter((s) => s.length > 0)
}

/**
 * All skill roots scanned by this plugin, each with a source label.
 * Order matters: `.agents` (the shared/public directory) is scanned first,
 * so later roots whose entries alias the same skill (e.g. `.claude/skills`
 * junctions) are deduplicated in its favor — the public copy keeps the
 * unlabelled `agents` source.
 */
function allRoots() {
  return [
    { source: 'agents', path: skillsRoot() },
    { source: 'codex', path: process.env.DSH_CODEX_SKILL_DIR || join(homedir(), '.codex', 'skills') },
    { source: 'claude', path: process.env.DSH_CLAUDE_SKILL_DIR || join(homedir(), '.claude', 'skills') },
    { source: 'opencode', path: process.env.DSH_OPENCODE_SKILL_DIR || join(homedir(), '.opencode', 'skills') },
    ...extraRoots().map((path) => ({ source: 'extra', path })),
  ]
}

/** A stable signature of the current root set — a change invalidates the cache. */
function rootsSignature() {
  return allRoots().map((r) => `${r.source}:${r.path}`).join('|')
}

/** Cache directory: $DSH_SKILL_CACHE_DIR, else $DSH_HOME/storages/dsh-skill-sidebar. */
function cacheDir() {
  if (process.env.DSH_SKILL_CACHE_DIR) return process.env.DSH_SKILL_CACHE_DIR
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'storages', 'dsh-skill-sidebar')
}

/** Cache file path. */
function cacheFile() {
  return join(cacheDir(), 'skills.json')
}

/* ------------------------------------------------------------------ */
/* tiny YAML frontmatter parser (no dependencies)                      */
/* ------------------------------------------------------------------ */

/**
 * Decode a SKILL.md byte buffer: UTF-8 by default, falling back to GBK when
 * the UTF-8 decode produced replacement characters (some local skill files
 * are saved in the legacy GBK codepage). A leading UTF-8 BOM is stripped.
 */
function decodeSkillText(buf) {
  let text = buf.toString('utf8')
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  if (text.includes('\uFFFD')) {
    try {
      const gbk = new TextDecoder('gbk').decode(buf)
      if (!gbk.includes('\uFFFD')) text = gbk
    } catch { /* keep the UTF-8 attempt */ }
  }
  return text
}

/**
 * Parse the `---`-delimited YAML frontmatter of a SKILL.md. Extracts scalar
 * single-line keys (name, description, whenToUse, ...) plus folded/literal
 * block scalars (`key: >` / `key: |` with indented continuation lines);
 * nested maps and unknown keys are ignored. Values may be bare or quoted with
 * ' or ". Returns an object of string values.
 */
function parseFrontmatter(text) {
  // Some skill files carry a UTF-8 BOM; strip it so `---` lands at index 0.
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  const out = {}
  const first = text.indexOf('---')
  if (first !== 0) return out
  const rest = text.slice(3)
  const second = rest.indexOf('\n---')
  if (second === -1) return out
  const block = rest.slice(0, second)
  const lines = block.split(/\r?\n/)
  let pendingKey = null
  let pendingStyle = null
  let pendingParts = []
  for (const rawLine of lines) {
    if (pendingKey !== null) {
      if (/^\s/.test(rawLine) && rawLine.trim() !== '') {
        pendingParts.push(rawLine.trim())
        continue
      }
      // Block ended (next key / blank / comment): finalize the pending scalar.
      if (pendingParts.length > 0) {
        out[pendingKey] = pendingStyle === '|' ? pendingParts.join('\n') : pendingParts.join(' ')
      }
      pendingKey = null
      pendingStyle = null
      pendingParts = []
    }
    const line = rawLine.trimEnd()
    if (line.trim() === '' || line.startsWith('#') || /^\s/.test(rawLine)) continue
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim()
    let value = line.slice(colon + 1).trim()
    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      pendingKey = key
      pendingStyle = value[0]
      pendingParts = []
      continue
    }
    if (value === '') continue
    out[key] = unquote(value)
  }
  if (pendingKey !== null && pendingParts.length > 0) {
    out[pendingKey] = pendingStyle === '|' ? pendingParts.join('\n') : pendingParts.join(' ')
  }
  return out
}

/** Strip one level of '...' or "..." quoting with basic unescaping. */
function unquote(value) {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if (first === '"' && last === '"') {
      return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    }
    if (first === "'" && last === "'") {
      return value.slice(1, -1).replace(/''/g, "'")
    }
  }
  return value
}

/** Fallback description: first non-empty body paragraph, minus heading markers. */
function fallbackDescription(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  const body = text.replace(/^---[\s\S]*?^---\s*/m, '')
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed === '---' || /^#+\s/.test(trimmed)) continue
    return trimmed.replace(/^#+\s*/, '')
  }
  return ''
}

/* ------------------------------------------------------------------ */
/* 4-6 字功能短语                                                       */
/* ------------------------------------------------------------------ */

/** Hand-written short-phrase list per skill (name -> string[]), shipped with the plugin. */
const PHRASES_OVERRIDES = loadPhrasesOverrides()

/** Max phrase count generated by the rule-based fallback. */
const FALLBACK_MAX_PHRASES = 6
/** Max characters of one fallback phrase (Chinese 4-6 字; mixed scripts get a little room). */
const FALLBACK_MAX_CHARS = 8

/** Load lib/phrases.json (missing/corrupt -> {}). */
function loadPhrasesOverrides() {
  try {
    const raw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'phrases.json'), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Rule-based short-phrase generation for skills without hand-written phrases
 * (newly installed skills): split the description on Chinese/ASCII
 * punctuation, take the leading ~6 字 of each segment, dedupe, cap the count.
 */
function phraseFallback(description) {
  if (!description) return []
  const seen = new Set()
  const out = []
  for (const part of description.split(/[，。；、：,!;:]+/)) {
    const t = part.trim().replace(/^[-*>#\s]+/, '')
    if (t === '') continue
    const p = t.length <= FALLBACK_MAX_CHARS ? t : t.slice(0, FALLBACK_MAX_CHARS)
    if (seen.has(p)) continue
    seen.add(p)
    out.push(p)
    if (out.length >= FALLBACK_MAX_PHRASES) break
  }
  return out
}

/** Resolve a skill's short-phrase list: hand-written override, else the rule fallback. */
function phrasesOf(name, description) {
  const override = PHRASES_OVERRIDES[name]
  if (Array.isArray(override) && override.length > 0) return override
  return phraseFallback(description)
}

/** One scanned skill entry: name + description + 4-6 字 phrases (+ whenToUse + source). */
function skillEntry(meta, fallbackName, text, source) {
  const name = meta.name || fallbackName
  const description = meta.description || fallbackDescription(text)
  return {
    name,
    description,
    phrases: phrasesOf(name, description),
    source: source || 'agents',
    ...(meta.whenToUse ? { whenToUse: meta.whenToUse } : {}),
  }
}

/* ------------------------------------------------------------------ */
/* scanning                                                            */
/* ------------------------------------------------------------------ */

/**
 * Scan every skill root and return the merged list of
 * { name, description, phrases, source, whenToUse? } entries, sorted by name.
 * Unreadable entries are skipped silently (a missing root yields []). The
 * first root to claim a skill name wins, so the public `.agents` copy
 * deduplicates aliases in later roots (`.claude` junctions, etc.).
 */
async function scanSkills() {
  const skills = []
  const seen = new Set()
  for (const root of allRoots()) {
    let entries = []
    try {
      entries = await readdir(root.path, { withFileTypes: true })
    } catch {
      continue // root missing or unreadable
    }
    for (const entry of entries) {
      const full = join(root.path, entry.name)
      try {
        if (entry.isDirectory()) {
          const mdPath = join(full, 'SKILL.md')
          const info = await stat(mdPath)
          if (!info.isFile()) continue
          const text = decodeSkillText(await readFile(mdPath))
          const meta = parseFrontmatter(text)
          const name = meta.name || entry.name
          if (seen.has(name)) continue
          seen.add(name)
          skills.push(skillEntry(meta, entry.name, text, root.source))
        } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md' && entry.name.toLowerCase() !== 'readme.md') {
          const text = decodeSkillText(await readFile(full))
          const meta = parseFrontmatter(text)
          const name = meta.name || entry.name.slice(0, -3)
          if (seen.has(name)) continue
          seen.add(name)
          skills.push(skillEntry(meta, entry.name.slice(0, -3), text, root.source))
        }
      } catch {
        // unreadable entry — skip
      }
    }
  }
  skills.sort((a, b) => a.name.localeCompare(b.name))
  return skills
}

/* ------------------------------------------------------------------ */
/* persistence                                                         */
/* ------------------------------------------------------------------ */

/** Read the persisted cache (null when absent/malformed). */
async function loadCache() {
  try {
    const parsed = JSON.parse(await readFile(cacheFile(), 'utf8'))
    if (parsed && Array.isArray(parsed.skills)) return parsed
    return null
  } catch {
    return null
  }
}

/** Persist a scan result with its timestamp and root signature. */
async function saveCache(skills) {
  await mkdir(cacheDir(), { recursive: true })
  await writeFile(cacheFile(), JSON.stringify({
    skills,
    scannedAt: new Date().toISOString(),
    roots: rootsSignature(),
  }, null, 2), 'utf8')
}

/** Local date string (YYYY-MM-DD) of a Date or ISO string. */
function dateStr(value) {
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Whether `now` is Monday. */
function isMondayNow() {
  return new Date().getDay() === MONDAY
}

/** Whether the cached scan must be refreshed: stale, Monday with a pre-today cache, or the root set changed. */
function cacheNeedsRefresh(cached) {
  const scannedAt = cached?.scannedAt ? new Date(cached.scannedAt).getTime() : 0
  const stale = Number.isNaN(scannedAt) || Date.now() - scannedAt > STALE_MS
  if (stale) return true
  if (isMondayNow() && dateStr(cached.scannedAt) !== dateStr(new Date())) return true
  // A new skill directory was added (or an old one removed): the cached set
  // no longer matches the current roots — re-scan.
  return cached.roots !== rootsSignature()
}

/* ------------------------------------------------------------------ */
/* browser-trust fence (same contract as the /api gateway; copied from  */
/* dsh-client-connection's fence, BSD-3-Clause, as dsh-better-sidebar   */
/* does — the package does not export these helpers)                    */
/* ------------------------------------------------------------------ */

function header(headers, name) {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

function parseAuthority(authority) {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function canonicalAuthority(entry, entryUrl) {
  const port = entryUrl.port !== '' ? entryUrl.port : new URL(`https://${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

function isTrustedAuthority(hostUrl, trustedHosts) {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

/** Whether one request may reach the plugin routes (loopback Host or trusted authority, same-origin browser markers). */
function isTrustedApiRequest(request, trustedHosts) {
  const host = header(request.headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  if (header(request.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(request.headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** The connection row's resolved trustedHosts (live read; the /api fence's own list). */
function trustedHostsOf(ctx) {
  for (const entry of ctx.loader.entries()) {
    if (entry.options.name === 'connection') return entry.options.config?.trustedHosts ?? []
  }
  return []
}

/* ------------------------------------------------------------------ */
/* plugin body                                                         */
/* ------------------------------------------------------------------ */

/**
 * Plugin body: owns the scan/cache lifecycle and the two fenced routes.
 * @param ctx - plugin context carrying webServer and loader.
 */
export function apply(ctx) {
  /** Current machine-wide list ({ skills, scannedAt }) or null before the first scan settles. */
  let current = null
  /** Guards every async continuation after disposal. */
  let alive = true
  /** Resources created by boot() and released by the disposer (filled in as boot progresses). */
  const resources = { timers: [], watchers: [] }

  const log = (level, message) => {
    try {
      ctx.logger?.[level]?.(`[dsh-skill-sidebar] ${message}`)
    } catch {
      // logger unavailable — nothing to report with
    }
  }

  /** Re-scan every root, persist, and swap `current`. */
  async function rescan(reason) {
    if (!alive) return
    try {
      const skills = await scanSkills()
      await saveCache(skills)
      current = { skills, scannedAt: new Date().toISOString() }
      log('info', `rescanned ${skills.length} skills (${reason})`)
    } catch (error) {
      log('warn', `rescan failed (${reason}): ${String(error)}`)
    }
    armWatchers()
  }

  /** Debounced watcher callback (skill installed/changed/removed). */
  let watchTimer = null
  function scheduleWatchRescan() {
    if (watchTimer !== null) return
    watchTimer = setTimeout(() => {
      watchTimer = null
      void rescan('watcher')
    }, WATCH_DEBOUNCE_MS)
  }

  /** Drop every watcher (re-arming replaces them). */
  function clearWatchers() {
    for (const w of resources.watchers) try { w.close() } catch { /* already closed */ }
    resources.watchers.length = 0
  }

  /**
   * Watch the skill roots (recursively) AND their parent directories
   * (non-recursively), so a skill root that does not exist yet is picked up
   * the moment it is created — a newly installed skill root then triggers a
   * rescan, which re-arms the watchers. Called after every scan, so watcher
   * coverage always matches the current root set.
   */
  function armWatchers() {
    if (!alive) return
    clearWatchers()
    const seen = new Set()
    const targets = []
    for (const root of allRoots()) {
      targets.push({ path: root.path, recursive: true })
      const parent = dirname(root.path)
      if (parent !== root.path) targets.push({ path: parent, recursive: false })
    }
    for (const t of targets) {
      if (seen.has(t.path)) continue
      seen.add(t.path)
      try {
        const w = watch(t.path, { recursive: t.recursive }, () => scheduleWatchRescan())
        resources.watchers.push(w)
      } catch {
        // watcher unsupported / path missing — the poll below covers it
      }
    }
  }

  /** Boot lifecycle: seed `current`, arm the watcher and the timers. */
  async function boot() {
    if (!alive) return
    const cached = await loadCache()
    if (alive && cached && !cacheNeedsRefresh(cached)) {
      current = cached
      log('info', `loaded ${cached.skills.length} skills from cache (${dateStr(cached.scannedAt)})`)
    } else {
      await rescan(cached ? 'monday-or-stale' : 'first-scan')
    }
    if (!alive) return

    // Watch for new/changed/removed skills (roots + their parents, so a root
    // created later is caught); re-armed after every rescan.
    armWatchers()

    // Poll fallback: catches watcher gaps (network drives, dropped events).
    resources.timers.push(setInterval(() => void rescan('poll'), POLL_MS))
    // Monday policy: every 6h, force a full re-read when it is Monday and the
    // cache predates today.
    resources.timers.push(setInterval(() => {
      if (!alive) return
      if (isMondayNow() && current !== null && dateStr(current.scannedAt) !== dateStr(new Date())) {
        void rescan('monday')
      }
    }, MONDAY_CHECK_MS))
  }

  /** Disposer installed by the effect below; releases everything boot() armed. */
  function dispose() {
    alive = false
    if (watchTimer !== null) clearTimeout(watchTimer)
    for (const t of resources.timers) clearInterval(t)
    for (const w of resources.watchers) try { w.close() } catch { /* already closed */ }
    resources.timers.length = 0
    resources.watchers.length = 0
  }

  /** Fenced route handlers. */
  const fence = (req) => isTrustedApiRequest(req, trustedHostsOf(ctx))

  function handleSkills(req, res) {
    // File-based hit log (works even when the cordis logger is not attached
    // to a visible stream) — proves whether browser requests actually arrive.
    try {
      appendFileSync(REQUEST_LOG, `${new Date().toISOString()} HIT fence=${fence(req)} ua=${(req.headers['user-agent'] || '').slice(0, 60)}\n`)
    } catch { /* diagnostics only */ }
    if (!fence(req)) {
      log('warn', 'skills route DENIED by fence')
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    log('info', `skills route hit (${current?.skills.length ?? 0} skills)`)
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-cache',
    })
    res.end(JSON.stringify({
      ok: true,
      skills: current?.skills ?? [],
      scannedAt: current?.scannedAt ?? null,
      source: 'filesystem',
      policy: { mondayRefresh: true, autoAdd: true },
    }))
  }

  function handleRefresh(req, res) {
    if (!fence(req)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    void rescan('manual').then(() => {
      if (res.writableEnded) return
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-cache',
      })
      res.end(JSON.stringify({
        ok: true,
        skills: current?.skills ?? [],
        scannedAt: current?.scannedAt ?? null,
        source: 'filesystem',
        policy: { mondayRefresh: true, autoAdd: true },
      }))
    })
  }

  // Mount the routes (disposers run on fiber disposal) and start the scan.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/skillpanel/skills',
    handler: handleSkills,
  }), 'dsh-skill-sidebar: skills route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/skillpanel/skills/refresh',
    handler: handleRefresh,
  }), 'dsh-skill-sidebar: skills refresh route')
  // Bootstrap injection: embed the current machine-wide skill list into the
  // index.html so the client can render instantly WITHOUT any fetch round-trip
  // (belt-and-suspenders when a browser extension or the client runtime
  // interferes with fetch). Runs on every index.html render, so it always
  // carries the latest scan.
  ctx.effect(() => ctx.webServer.tapIndex((html) => {
    const json = JSON.stringify(current?.skills ?? []).replaceAll('<', '\\u003c')
    const script = `<script>window.__DSH_SKILLS__=${json}</script>`
    const head = html.indexOf('<head>')
    return head !== -1 ? html.slice(0, head + 6) + script + html.slice(head + 6) : script + html
  }), 'dsh-skill-sidebar: skills boot injection')
  ctx.effect(() => {
    void boot()
    return dispose
  }, 'dsh-skill-sidebar: scan lifecycle')
}

/** Test hook: exports the pure helpers so the harness can verify them without a live ctx. */
export const internals = {
  parseFrontmatter,
  unquote,
  fallbackDescription,
  phraseFallback,
  phrasesOf,
  scanSkills,
  cacheNeedsRefresh,
  dateStr,
  isMondayNow,
  skillsRoot,
  allRoots,
  rootsSignature,
  cacheFile,
}
