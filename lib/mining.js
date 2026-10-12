/**
 * dsh-skill-sidebar — 会话日志回填（技能使用证据）。
 *
 * DSH 的会话日志是 `~/.dsh/sessions/<cwd-slug>/<session-id>/session.v4.jsonl.zstd`：
 * **多帧拼接**的 Zstandard（每批追加一帧），所以不能用一次 zstdDecompress 读完
 * —— 必须按帧边界逐帧解码。帧扫描算法移植自 `@deepseek-ai/dsh-session-persistence-jsonl`
 * 的 `scanZstdFrames`（BSD-3-Clause，逐字保留了它的头部/块头解析规则）。
 *
 * 从这里能挖到两类证据：
 *   1. **真使用**：`tool/call` 事件里 `data.name === 'skill'` 的调用参数 `name`；
 *      以及用户直接 `/技能名` 触发的注入消息（`source.kind === 'skill-invocation'`）。
 *   2. **被加载进目录**：`user/message` 事件里 `source.kind === 'skill-catalog'` 的
 *      `entries` —— 记录每个技能最后一次进入新会话目录的时间。
 */
import { readdir, stat } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = 0xfd2fb528

/**
 * 扫描一段拼接的 Zstandard 字节流，返回每一帧的 [start, end)。
 * 只按帧头/块头结构定位，不做解压；结构非法直接抛出。
 * @param buffer - 完整（或读到一半）的拼接帧字节。
 * @param maxFrames - 最多返回多少帧。
 * @returns { frames: [{start,end}], tornStart? }。
 */
export function scanZstdFrames(buffer, maxFrames = Number.POSITIVE_INFINITY) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`invalid frame magic at byte ${offset}`)
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) throw new Error(`reserved frame-header bit at byte ${offset - 1}`)
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error(`reserved block type at byte ${offset - 3}`)
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
    if (frames.length === maxFrames) return { frames }
  }
  return { frames }
}

/**
 * 读一个会话日志文件并逐帧解出事件数组。
 *
 * 单帧解压失败（半截帧/损坏）会被跳过而不是整体失败——日志是追加写，
 * 正在写入的最后一帧本来就可能是半截的。
 * @param file - `.jsonl.zstd` 路径。
 * @returns 事件对象数组（解析失败的行丢弃）。
 */
export function readSessionEvents(file) {
  const buffer = readFileSync(file)
  const { frames } = scanZstdFrames(buffer)
  const events = []
  let pending = ''
  for (const { start, end } of frames) {
    let text
    try {
      text = zstdDecompressSync(buffer.subarray(start, end)).toString('utf8')
    } catch {
      continue
    }
    pending += text
    const lines = pending.split('\n')
    pending = lines.pop()
    for (const line of lines) {
      if (line.trim() === '') continue
      try { events.push(JSON.parse(line)) } catch { /* torn line */ }
    }
  }
  if (pending.trim() !== '') {
    try { events.push(JSON.parse(pending)) } catch { /* torn tail */ }
  }
  return events
}

/**
 * 从一个事件数组里抽取技能证据。
 * @param events - readSessionEvents() 的结果。
 * @param sessionId - 该日志所属会话 id。
 * @returns { calls: Map<name, {calls,lastUsedAt}>, advertised: Map<name, ms> }。
 */
export function extractEvidence(events, sessionId = null) {
  const calls = new Map()
  const advertised = new Map()
  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    const data = event.data
    if (!data || typeof data !== 'object') continue
    const at = Number(event.time) || 0
    if (event.type === 'tool/call') {
      if (data.name !== 'skill') continue
      let args = data.arguments
      if (typeof args === 'string') {
        try { args = JSON.parse(args) } catch { args = null }
      }
      const name = args && typeof args.name === 'string' ? args.name : null
      if (name === null) continue
      const rec = calls.get(name) || { calls: 0, lastUsedAt: 0, sessionId }
      rec.calls += 1
      if (at > rec.lastUsedAt) rec.lastUsedAt = at
      calls.set(name, rec)
      continue
    }
    const source = data.source
    if (!source || typeof source !== 'object') continue
    if (source.kind === 'skill-invocation' && typeof source.name === 'string') {
      // 用户直接 /技能名 触发（不算模型调用，但同样是「用过」）。
      const rec = calls.get(source.name) || { calls: 0, lastUsedAt: 0, sessionId }
      rec.calls += 1
      if (at > rec.lastUsedAt) rec.lastUsedAt = at
      calls.set(source.name, rec)
      continue
    }
    if (source.kind === 'skill-catalog' && Array.isArray(source.entries)) {
      for (const entry of source.entries) {
        if (!entry || typeof entry.name !== 'string') continue
        const prev = advertised.get(entry.name) || 0
        if (at >= prev) advertised.set(entry.name, at || prev)
      }
    }
  }
  return { calls, advertised }
}

/** 递归找出会话日志文件。 */
export async function findSessionLogs(root) {
  const out = []
  async function walk(dir) {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.name.endsWith('.jsonl.zstd')) out.push(full)
    }
  }
  await walk(root)
  return out
}

/**
 * 回填窗口内的会话日志。
 *
 * 只处理 `mtime` 落在窗口内、或台账里没有/已变化的文件；每处理 `yieldEvery` 个
 * 文件让出一次事件循环，避免卡住宿主启动。
 * @param options - { root, sinceMs, ledger, maxFileBytes, signal, onProgress, yieldEvery }。
 * @returns { calls, advertised, ledger, scanned, skipped, failed, bytes }。
 */
export async function mineSessions(options) {
  const root = options.root
  const sinceMs = Number(options.sinceMs) || 0
  const ledger = options.ledger && typeof options.ledger === 'object' ? options.ledger : {}
  const maxFileBytes = Number(options.maxFileBytes) || 256 * 1024 * 1024
  const yieldEvery = Number(options.yieldEvery) || 8
  const signal = options.signal
  const nextLedger = { ...ledger }
  const calls = new Map()
  const advertised = new Map()
  let scanned = 0
  let skipped = 0
  let failed = 0
  let bytes = 0
  const logs = await findSessionLogs(root)
  for (let i = 0; i < logs.length; i += 1) {
    if (signal && signal.aborted) break
    const file = logs[i]
    let info
    try { info = await stat(file) } catch { continue }
    const known = ledger[file]
    if (known && known.mtimeMs === info.mtimeMs && known.size === info.size) { skipped += 1; continue }
    if (info.mtimeMs < sinceMs) { skipped += 1; continue }
    if (info.size > maxFileBytes) { skipped += 1; continue }
    try {
      const events = readSessionEvents(file)
      const sessionId = file.split(/[\\/]/).slice(-2, -1)[0] || null
      const found = extractEvidence(events, sessionId)
      for (const [name, rec] of found.calls) {
        const prev = calls.get(name) || { calls: 0, lastUsedAt: 0, sessionId: null }
        calls.set(name, {
          calls: prev.calls + rec.calls,
          lastUsedAt: Math.max(prev.lastUsedAt, rec.lastUsedAt),
          sessionId: rec.sessionId || prev.sessionId,
        })
      }
      for (const [name, at] of found.advertised) {
        advertised.set(name, Math.max(advertised.get(name) || 0, at))
      }
      nextLedger[file] = { mtimeMs: info.mtimeMs, size: info.size }
      bytes += info.size
      scanned += 1
    } catch {
      failed += 1
    }
    if (typeof options.onProgress === 'function' && (i + 1) % 20 === 0) {
      options.onProgress({ done: i + 1, total: logs.length, scanned, skipped, failed })
    }
    if ((i + 1) % yieldEvery === 0) await new Promise((resolve) => setImmediate(resolve))
  }
  return { calls, advertised, ledger: nextLedger, scanned, skipped, failed, bytes, total: logs.length }
}

/**
 * 把回填结果并进存储。
 *
 * 计数用 **max** 而不是相加：回填是「日志里的权威计数」，实时记录只是新鲜度补充，
 * 相加会把同一批调用算两遍（实时记一次、事后回填又算一次）。
 * @param store - normalizeStore() 的结果。
 * @param mined - mineSessions() 的结果。
 * @param now - 当前时间戳。
 * @returns 新的 store。
 */
export function mergeMined(store, mined, now = Date.now()) {
  const usage = { ...store.usage }
  for (const [name, rec] of mined.calls) {
    const prev = usage[name] || { calls: 0, sessions: 0, firstUsedAt: 0, lastUsedAt: 0, lastSessionId: null }
    usage[name] = {
      calls: Math.max(Number(prev.calls) || 0, rec.calls),
      sessions: Math.max(Number(prev.sessions) || 0, rec.calls > 0 ? 1 : 0),
      firstUsedAt: prev.firstUsedAt || rec.lastUsedAt || now,
      lastUsedAt: Math.max(Number(prev.lastUsedAt) || 0, rec.lastUsedAt || 0),
      lastSessionId: prev.lastSessionId || rec.sessionId || null,
    }
  }
  const advertised = { ...store.advertised }
  for (const [name, at] of mined.advertised) {
    if ((advertised[name] || 0) < at) advertised[name] = at
  }
  return {
    ...store,
    usage,
    advertised,
    mined: { ...store.mined, ...mined.ledger },
    minedAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  }
}

/** 供诊断用：把 Map 结果压成普通对象。 */
export function evidenceToObject(mined) {
  return {
    calls: Object.fromEntries([...mined.calls.entries()].map(([name, rec]) => [name, rec])),
    advertised: Object.fromEntries(mined.advertised),
  }
}
