/**
 * dsh-skill-sidebar — client half.
 *
 * Registers a 技能 (Skills) tab into the dsh-better-sidebar right panel via
 * the `betterSidebar` service (ctx.betterSidebar.registerTab). The tab lists
 * every skill readable in this environment with a short description.
 *
 * Data flow:
 *  - instant first paint: a localStorage snapshot written by a previous
 *    session ("下次启动后打开就能列出，无须再次读取");
 *  - authoritative: the live per-session catalog
 *    (connection.api.skills.list — the same source the "/" skill menu uses),
 *    which the host keeps fresh when skills are installed/changed (auto-add);
 *  - fallback: the host half's machine-wide filesystem scan
 *    (GET /skillpanel/skills), which re-reads all skills every Monday;
 *  - while the tab is visible it re-fetches every 30s, so a newly installed
 *    skill appears automatically.
 *
 * Bundle format: the DSH client module table (window.__ModuleLoader__.load),
 * same as dsh-better-sidebar / dsh-client-ui-skill — no build step needed.
 */
window.__ModuleLoader__.load({
  id: 'dsh-skill-sidebar',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var React = require('react')
    var primitives = require('@deepseek-ai/dsh-client-ui-primitives')

    /* ------------------------------------------------------------------ */
    /* styles (plugin-scoped classes; DSW design tokens with fallbacks)    */
    /* ------------------------------------------------------------------ */
    var CSS_ID = 'dsh-skill-sidebar/styles'
    var css = '' +
      '.dss-root{display:flex;flex-direction:column;height:100%;min-width:0;font:13px/1.5 -apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--dsw-alias-label-primary,#d6d6de);background:transparent}' +
      '.dss-header{display:flex;align-items:center;gap:8px;padding:10px 12px 6px;flex:none}' +
      '.dss-header h3{margin:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#e8e8ee);flex:none}' +
      '.dss-count{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a96);flex:none}' +
      '.dss-refresh{margin-left:auto;flex:none;border:1px solid var(--dsw-alias-border-l2,#33333c);background:var(--dsw-alias-bg-base,#1c1c23);color:var(--dsw-alias-label-secondary,#b8b8c4);border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer}' +
      '.dss-refresh:hover{background:var(--dsw-alias-interactive-bg-hover-solid,#2a2a33)}' +
      '.dss-refresh:disabled{opacity:.5;cursor:default}' +
      '.dss-search{padding:0 12px 6px;flex:none}' +
      '.dss-search input{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,#33333c);background:var(--dsw-alias-bg-base,#1c1c23);color:var(--dsw-alias-label-primary,#e8e8ee);border-radius:6px;padding:4px 8px;font-size:12px;outline:none}' +
      '.dss-search input:focus{border-color:var(--dsw-alias-accent-primary,#5b8cff)}' +
      '.dss-list{flex:auto;min-height:0;overflow:auto;padding:2px 8px 8px}' +
      '.dss-row{position:relative;padding:7px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07))}' +
      '.dss-row:last-child{border-bottom:none}' +
      '.dss-row:hover{background:var(--dsw-alias-interactive-bg-hover-solid,rgba(255,255,255,.05))}' +
      '.dss-row-top{display:flex;align-items:baseline;gap:6px;min-width:0}' +
      '.dss-name{font-weight:600;font-size:12.5px;color:var(--dsw-alias-label-primary,#e8e8ee);flex:none}' +
      '.dss-tag{flex:none;font-size:10px;line-height:1;padding:2px 5px;border-radius:4px;background:var(--dsw-alias-bg-strong,rgba(255,255,255,.08));color:var(--dsw-alias-label-tertiary,#9a9aa6);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}' +
      '.dss-copy{margin-left:auto;flex:none;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#8a8a96);font-size:10px;cursor:pointer;padding:1px 5px;border-radius:4px;opacity:0;transition:opacity .1s}' +
      '.dss-row:hover .dss-copy{opacity:1}' +
      '.dss-copy:hover{background:var(--dsw-alias-interactive-bg-hover-solid,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#e8e8ee)}' +
      '.dss-pin{flex:none;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#8a8a96);cursor:pointer;padding:0;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;opacity:.75;transition:opacity .1s}' +
      '.dss-pin:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover-solid,rgba(255,255,255,.08))}' +
      '.dss-pin-on{color:var(--dsw-alias-accent-primary,#5b8cff);opacity:1}' +
      '.dss-badge{flex:none;font-size:10px;line-height:1;padding:2px 5px;border-radius:999px;background:var(--dsw-alias-bg-strong,rgba(255,255,255,.08));color:var(--dsw-alias-label-tertiary,#9a9aa6)}' +
      '.dss-phrases{font-size:12px;color:var(--dsw-alias-label-secondary,#b0b0bc);margin:2px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.dss-more{color:var(--dsw-alias-accent-primary,#5b8cff);font-weight:600}' +
      '.dss-tip-fixed{position:fixed;z-index:2147483000;max-width:300px;background:var(--dsw-alias-bg-strong,#26262e);border:1px solid var(--dsw-alias-border-l2,#3a3a44);border-radius:8px;padding:8px 10px;font-size:11.5px;line-height:1.55;color:var(--dsw-alias-label-secondary,#c0c0cc);white-space:pre-wrap;overflow-wrap:anywhere;box-shadow:0 8px 24px rgba(0,0,0,.4);pointer-events:none}' +
      '.dss-foot{padding:4px 12px 8px;flex:none;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8a8a96);display:flex;gap:10px;align-items:center}' +
      '.dss-diag{margin-left:auto;color:var(--dsw-alias-label-tertiary,#8a8a96)}' +
      '.dss-empty{padding:24px 12px;text-align:center;color:var(--dsw-alias-label-tertiary,#8a8a96);font-size:12px}' +
      '.dss-error{padding:8px 12px;font-size:11px;color:var(--dsw-alias-state-error-primary,#f2a1a1);flex:none}'
    if (typeof document !== 'undefined') {
      var cssTag = document.querySelector('style[data-plugin-css="' + CSS_ID + '"]')
      if (cssTag === null) {
        var tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-skill-sidebar'
        tag.dataset.pluginCss = CSS_ID
        tag.textContent = css
        document.head.appendChild(tag)
      }
    }

    /* ------------------------------------------------------------------ */
    /* persistence helpers                                                 */
    /* ------------------------------------------------------------------ */
    var STORAGE_KEY = 'dsh-skill-sidebar:cache:v1'
    var POLL_MS = 30000

    function pad2(n) { return String(n).padStart(2, '0') }
    function todayStr() {
      var d = new Date()
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
    }
    function isMonday() { return new Date().getDay() === 1 }

    function readLocalCache() {
      try {
        var raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return null
        var data = JSON.parse(raw)
        if (data && Array.isArray(data.skills)) return data
        return null
      } catch (e) { return null }
    }

    function writeLocalCache(skills, fetchedAt) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          skills: skills,
          fetchedAt: fetchedAt || new Date().toISOString(),
          refreshedDate: todayStr(),
        }))
      } catch (e) { /* storage full/blocked — non-fatal */ }
    }

    /* ------------------------------------------------------------------ */
    /* fetchers                                                            */
    /* ------------------------------------------------------------------ */

    /** Live per-session catalog (the "/" skill menu source). Null for subagent scopes. */
    function fetchLiveCatalog(ctx, sessionId) {
      var sessions = ctx.get('sessions')
      var connection = ctx.get('connection')
      if (!connection || !connection.api || !connection.api.skills) return Promise.resolve(null)
      if (sessions && typeof sessions.subagentAddress === 'function' && sessions.subagentAddress(sessionId) !== undefined) {
        return Promise.resolve(null)
      }
      return connection.api.skills.list({ sessionId: sessionId }).then(function (res) {
        if (!res || !res.result || !res.result.ok) {
          var code = res && res.result && res.result.error ? res.result.error.code : 'skill.list'
          var message = res && res.result && res.result.error ? res.result.error.message : 'skill list unavailable'
          throw new Error(code + ': ' + message)
        }
        return res.result.value.skills
      })
    }

    /** Machine-wide filesystem scan served by the host half. */
    function fetchServerCatalog() {
      return fetch('/skillpanel/skills', { headers: { Accept: 'application/json' } })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status)
          return res.json()
        })
        .then(function (json) {
          if (!json || json.ok !== true || !Array.isArray(json.skills)) throw new Error('malformed response')
          return { skills: json.skills, scannedAt: json.scannedAt || null }
        })
    }

    /**
     * Union of two skill lists by name, primary winning for duplicates —
     * the live per-session catalog (canonical descriptions) plus machine-wide
     * entries the session scope hides (e.g. user-only skills) or misses
     * (filesystem scan of every local root). Result sorted by name.
     */
    function mergeLists(primary, secondary) {
      var map = {}
      var order = []
      function put(list) {
        for (var i = 0; i < list.length; i++) {
          var s = list[i]
          if (!s || typeof s.name !== 'string' || s.name === '') continue
          var prev = map[s.name]
          if (prev === undefined) {
            order.push(s.name)
            map[s.name] = s
          } else {
            // The overriding entry wins, but keep the other side's phrases
            // and directory source when the winner carries none — the live
            // per-session catalog has neither `phrases` nor `source`, while
            // the machine-wide scan does.
            map[s.name] = {
              ...prev, ...s,
              phrases: (s.phrases && s.phrases.length) ? s.phrases : (prev.phrases || []),
              source: s.source || prev.source || 'agents',
            }
          }
        }
      }
      put(secondary || [])
      put(primary || [])
      return order.sort().map(function (name) { return map[name] })
    }

    /** Max 4-6 字 phrases shown inline before the trailing "+n" marker. */
    var MAX_INLINE_PHRASES = 4

    /**
     * Split a skill's phrase list into the inline text and the "+n" overflow
     * count: show at most MAX_INLINE_PHRASES joined by 中文顿号, with the
     * remainder surfaced as "+n" (hover shows the full feature text).
     */
    function phraseRow(phrases) {
      var list = phrases && phrases.length ? phrases : []
      var shown = list.slice(0, MAX_INLINE_PHRASES)
      return {
        text: shown.join('，'),
        more: list.length - shown.length,
      }
    }

    /** The full feature text a hover tooltip shows for one skill. */
    function fullTextOf(s) {
      var parts = []
      if (s.description) parts.push(s.description)
      if (s.whenToUse) parts.push('适用：' + s.whenToUse)
      return parts.join('\n')
    }

    /* ------------------------------------------------------------------ */
    /* pinned skills (browser-local preference)                            */
    /* ------------------------------------------------------------------ */

    var PINS_KEY = 'dsh-skill-sidebar:pins:v1'

    /** Read the pinned skill-name list (best effort). */
    function readPins() {
      try {
        var raw = localStorage.getItem(PINS_KEY)
        if (!raw) return []
        var parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.filter(function (n) { return typeof n === 'string' }) : []
      } catch (e) { return [] }
    }

    /** Persist the pinned skill-name list. */
    function writePins(names) {
      try { localStorage.setItem(PINS_KEY, JSON.stringify(names)) } catch (e) { /* non-fatal */ }
    }

    /** Toggle one skill in a pin list. */
    function togglePinIn(names, name) {
      return names.indexOf(name) === -1 ? names.concat([name]) : names.filter(function (n) { return n !== name })
    }

    /** Sort skills: pinned first (both groups alphabetical). */
    function sortPinnedFirst(skills, pinned) {
      var set = {}
      for (var i = 0; i < pinned.length; i++) set[pinned[i]] = true
      var top = []
      var rest = []
      for (var j = 0; j < skills.length; j++) {
        if (set[skills[j].name]) top.push(skills[j])
        else rest.push(skills[j])
      }
      return top.concat(rest)
    }

    /** A push-pin glyph (inline SVG, follows currentColor; `filled` = pinned). */
    function PinIcon(size, filled) {
      return React.createElement('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: filled ? 'currentColor' : 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
        React.createElement('path', { d: 'M12 17v5' }),
        React.createElement('path', { d: 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z' }),
      )
    }

    /* ------------------------------------------------------------------ */
    /* the skills view component                                           */
    /* ------------------------------------------------------------------ */

    function SkillsView(props) {
      var ctx = props.ctx
      var sessionId = props.scope.sessionId
      var visible = props.visible

      // Boot-injected machine-wide list (server tapIndex) — render it instantly
      // with zero network round-trips; fetch refreshes it in the background.
      var bootSkills = null
      try {
        if (typeof window !== 'undefined' && window.__DSH_SKILLS__ && window.__DSH_SKILLS__.length) {
          bootSkills = window.__DSH_SKILLS__
        }
      } catch (e) { /* ignore */ }

      var stateHook = React.useState({
        skills: bootSkills,      // null = not loaded yet
        loading: false,
        error: null,
        source: bootSkills ? 'server' : 'cache',   // cache | live | server | local
        updatedAt: null,
        query: '',
        diagServer: bootSkills ? '本机 ' + bootSkills.length : '',
        diagLive: '',
      })
      var state = stateHook[0]
      var setState = stateHook[1]

      // Hover tooltip: fixed-position popover with the full feature text.
      var tipState = React.useState(null) // { text, left, top, above }
      var tip = tipState[0]
      var setTip = tipState[1]

      // Copy feedback: which skill name was just copied (cleared after a tick).
      var copiedState = React.useState(null)
      var copied = copiedState[0]
      var setCopied = copiedState[1]

      // Pinned skills (browser-local): names kept in order; pinned sort first.
      var pinsState = React.useState(function () { return readPins() })
      var pins = pinsState[0]
      var setPins = pinsState[1]
      function togglePin(name) {
        setPins(function (prev) {
          var next = togglePinIn(prev, name)
          writePins(next)
          return next
        })
      }
      function copySkill(name) {
        var text = '/' + name
        var ok = false
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
            ok = true
          }
        } catch (e) { /* fall through to execCommand */ }
        if (!ok) {
          try {
            var ta = document.createElement('textarea')
            ta.value = text
            ta.style.position = 'fixed'
            ta.style.opacity = '0'
            document.body.appendChild(ta)
            ta.select()
            document.execCommand('copy')
            document.body.removeChild(ta)
            ok = true
          } catch (e) { /* clipboard blocked */ }
        }
        if (ok) {
          setCopied(name)
          setTimeout(function () { setCopied(null) }, 1200)
        }
      }
      function handleRowEnter(e, s) {
        var rect = e.currentTarget.getBoundingClientRect()
        var above = rect.top > 170
        setTip({
          text: fullTextOf(s),
          left: Math.max(8, Math.min(window.innerWidth - 8, rect.left + rect.width / 2)),
          top: above ? rect.top - 6 : rect.bottom + 6,
          above: above,
        })
      }
      function handleRowLeave() {
        setTip(null)
      }

      var refresh = React.useCallback(function (opts) {
        var silent = !!(opts && opts.silent)
        setState(function (prev) { return { ...prev, loading: !silent || prev.skills === null, error: silent ? prev.error : null } })
        // Each source reports { ok, value|error } so one failing source can
        // never blank the list; the union of both is "本机所有技能".
        var serverP = fetchServerCatalog()
          .then(function (v) { return { ok: true, value: v } })
          .catch(function (e) { return { ok: false, error: String((e && e.message) || e) } })
        var liveP = fetchLiveCatalog(ctx, sessionId)
          .then(function (v) { return { ok: true, value: v } })
          .catch(function (e) { return { ok: false, error: String((e && e.message) || e) } })
        return Promise.all([serverP, liveP]).then(function (results) {
          var server = results[0]
          var live = results[1]
          var serverSkills = server.ok && server.value ? server.value.skills : []
          var liveSkills = live.ok && Array.isArray(live.value) ? live.value : []
          var merged = mergeLists(liveSkills, serverSkills)
          if (merged.length === 0) {
            console.error('[dsh-skill-sidebar] empty catalog —',
              'live:', live.ok ? liveSkills.length + ' skills' : live.error,
              '| server:', server.ok ? serverSkills.length + ' skills' : server.error)
          }
          setState(function (prev) {
            var next = { ...prev, loading: false, diagServer: server.ok ? '本机 ' + serverSkills.length : '本机✗', diagLive: live.ok ? '实时 ' + liveSkills.length : '实时✗' }
            if (merged.length > 0) {
              next.skills = merged
              next.error = null
              next.source = liveSkills.length > 0 ? 'live' : 'server'
              next.updatedAt = new Date().toISOString()
              writeLocalCache(merged, new Date().toISOString())
            } else if (prev.skills === null || (Array.isArray(prev.skills) && prev.skills.length === 0)) {
              // Nothing anywhere and nothing to fall back on: say exactly why.
              var details = []
              if (!server.ok) details.push('本机扫描: ' + server.error)
              else if (serverSkills.length === 0) details.push('本机扫描: 0 个技能')
              if (!live.ok) details.push('实时目录: ' + live.error)
              else if (liveSkills.length === 0) details.push('实时目录: 0 个技能')
              next.skills = []
              next.error = '技能目录为空（' + details.join('；') + '）'
            }
            return next
          })
          return merged
        })
      }, [ctx, sessionId])

      // First paint: serve the persisted snapshot instantly, then refresh.
      React.useEffect(function () {
        var cached = readLocalCache()
        if (cached && Array.isArray(cached.skills) && cached.skills.length > 0) {
          setState(function (prev) {
            return { ...prev, skills: cached.skills, source: 'local', updatedAt: cached.fetchedAt || null }
          })
        }
        // Monday: force a full re-read (the host re-scans disk; the live
        // catalog re-collects) even if a cache exists.
        var monday = isMonday()
        var needsMondayRefresh = monday && (!cached || cached.refreshedDate !== todayStr())
        refresh({ silent: !needsMondayRefresh })
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [refresh])

      // Auto-add: while the tab is visible, re-fetch every 30s.
      React.useEffect(function () {
        if (!visible) return undefined
        refresh({ silent: true })
        var timer = setInterval(function () { refresh({ silent: true }) }, POLL_MS)
        return function () { clearInterval(timer) }
      }, [visible, refresh])

      var query = state.query
      var skills = state.skills
      var filtered = React.useMemo(function () {
        if (!skills) return []
        var q = query.trim().toLowerCase()
        var base = q === '' ? skills : skills.filter(function (s) {
          return ((s.name || '').toLowerCase().indexOf(q) !== -1)
            || ((s.description || '').toLowerCase().indexOf(q) !== -1)
        })
        return sortPinnedFirst(base, pins)
      }, [skills, query, pins])

      var icon = primitives && primitives.IconSkillOutline16

      var rows = []
      // forEach (not a `var` loop): each callback gets its own `s`, so the
      // copy/hover closures below capture the right skill instead of the last.
      filtered.forEach(function (s) {
        var row = phraseRow(s.phrases)
        var tag = (s.source && s.source !== 'agents') ? '#' + s.source : null
        var isPinned = pins.indexOf(s.name) !== -1
        // Single 12px pin (the user picked the smallest of the v10 preview sizes).
        var pinButtons = React.createElement('button', {
          key: 'pin',
          className: 'dss-pin' + (isPinned ? ' dss-pin-on' : ''),
          style: { width: 16, height: 16 },
          title: isPinned ? '取消置顶' : '置顶',
          onClick: function () { togglePin(s.name) },
        }, PinIcon(12, isPinned))
        var rowChildren = [
          React.createElement('div', { className: 'dss-row-top', key: 'top' },
            React.createElement('span', { className: 'dss-name', title: s.name }, s.name),
            tag
              ? React.createElement('span', { className: 'dss-tag', key: 'tag' }, tag)
              : null,
            s.modelInvocable === false
              ? React.createElement('span', { className: 'dss-badge', key: 'badge' }, '仅用户')
              : null,
            pinButtons,
            React.createElement('button', {
              key: 'copy',
              className: 'dss-copy',
              title: '复制 /' + s.name + ' 以便调用',
              onClick: function () { copySkill(s.name) },
            }, copied === s.name ? '已复制' : '复制'),
          ),
        ]
        if (row.text !== '' || row.more > 0) {
          rowChildren.push(React.createElement('div', { className: 'dss-phrases', key: 'phrases' },
            row.text,
            row.more > 0 ? React.createElement('span', { className: 'dss-more', key: 'more' }, ' +' + row.more) : null,
          ))
        }
        rows.push(React.createElement('div', {
          className: 'dss-row',
          key: s.name,
          onMouseEnter: function (e) { handleRowEnter(e, s) },
          onMouseLeave: handleRowLeave,
        }, rowChildren))
      })

      var sourceLabel = state.source === 'live' ? '实时目录'
        : state.source === 'server' ? '本机扫描'
        : state.source === 'local' ? '本地缓存'
        : state.source === 'cache' ? '缓存' : state.source

      var headerChildren = [
        React.createElement('h3', { key: 't' }, icon ? React.createElement(icon, { size: 15 }) : null, ' 技能'),
        React.createElement('span', { className: 'dss-count', key: 'c' }, skills ? String(skills.length) + ' 个' : ''),
        React.createElement('button', {
          key: 'r',
          className: 'dss-refresh',
          disabled: state.loading,
          onClick: function () { refresh({ silent: false }) },
        }, state.loading ? '刷新中…' : '刷新'),
      ]

      var body
      if (skills === null) {
        body = React.createElement('div', { className: 'dss-empty' }, state.loading ? '正在读取技能列表…' : '正在加载…')
      } else if (filtered.length === 0) {
        body = React.createElement('div', { className: 'dss-empty' },
          query ? '没有匹配「' + query + '」的技能' : '未找到任何技能')
      } else {
        body = React.createElement('div', { className: 'dss-list' }, rows)
      }

      var footChildren = [
        React.createElement('span', { key: 'src' }, '来源：' + sourceLabel + ' · v11'),
        state.updatedAt
          ? React.createElement('span', { key: 'at' }, '更新于 ' + new Date(state.updatedAt).toLocaleString('zh-CN', { hour12: false }))
          : null,
        state.diagServer || state.diagLive
          ? React.createElement('span', { key: 'diag', className: 'dss-diag' },
            (state.diagServer || '本机 -') + ' · ' + (state.diagLive || '实时 -'))
          : null,
      ]

      var tipEl = null
      if (tip !== null) {
        tipEl = React.createElement('div', {
          className: 'dss-tip-fixed',
          style: {
            left: tip.left,
            top: tip.top,
            transform: tip.above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
          },
        }, tip.text)
      }

      return React.createElement('div', { className: 'dss-root' },
        React.createElement('div', { className: 'dss-header' }, headerChildren),
        React.createElement('div', { className: 'dss-search' },
          React.createElement('input', {
            type: 'text',
            placeholder: '搜索技能名称或描述…',
            value: query,
            onChange: function (e) { setState(function (prev) { return { ...prev, query: e.target.value } }) },
          }),
        ),
        state.error ? React.createElement('div', { className: 'dss-error' }, '技能目录获取失败：' + state.error) : null,
        body,
        React.createElement('div', { className: 'dss-foot' }, footChildren),
        tipEl,
      )
    }

    /* ------------------------------------------------------------------ */
    /* cordis client plugin                                                */
    /* ------------------------------------------------------------------ */

    /** Required services (declared so the runner gates ctx access and waits for them). */
    var inject = ['betterSidebar', 'connection', 'sessions']

    /**
     * Client plugin body: register the 技能 tab into the better-sidebar
     * right panel. The disposer unregisters it on fiber disposal (HMR-safe).
     * @param ctx - the client cordis context.
     */
    function apply(ctx) {
      ctx.effect(function () {
        var service = ctx.get('betterSidebar')
        if (!service || typeof service.registerTab !== 'function') {
          console.warn('[dsh-skill-sidebar] betterSidebar service unavailable — skills tab not registered')
          return undefined
        }
        var disposeTab = service.registerTab({
          id: 'skills',
          title: '技能',
          icon: function (size) {
            if (primitives && primitives.IconSkillOutline16) {
              return React.createElement(primitives.IconSkillOutline16, { size: size })
            }
            return React.createElement('span', { style: { fontSize: size, lineHeight: 1 } }, '技')
          },
          order: 45,
          single: true,
          component: function (tabProps) { return React.createElement(SkillsView, tabProps) },
        })

        // Default-visible: auto-open the tab once per conversation. The
        // sidebar store ignores opens until a session is attached, so this
        // subscribes to the sessions list and opens a moment after the
        // current conversation appears (openTab is idempotent — single:true
        // focuses an existing tab). Closing the tab is respected for the
        // rest of the page load (we only open each session once).
        var sessions = null
        try { sessions = ctx.get('sessions') } catch (e) { /* unavailable */ }
        var opened = {}
        var timers = []
        var tryOpen = function () {
          try { service.openTab({ type: 'skills' }) } catch (e) { /* store not ready yet */ }
        }
        var openOnce = function (sessionId) {
          if (!sessionId || opened[sessionId]) return
          opened[sessionId] = true
          timers.push(setTimeout(tryOpen, 120))
        }
        var unsub = null
        if (sessions && sessions.list && typeof sessions.list.subscribe === 'function') {
          unsub = sessions.list.subscribe(function () {
            try {
              var snap = sessions.list.getSnapshot()
              openOnce(snap && snap.current)
            } catch (e) { /* ignore */ }
          })
        }
        // Safety net: the session may already be current before we subscribed.
        timers.push(setTimeout(function () {
          try {
            var snap = sessions && sessions.list && sessions.list.getSnapshot()
            openOnce(snap && snap.current)
          } catch (e) { /* ignore */ }
        }, 400))

        return function () {
          disposeTab()
          if (unsub) unsub()
          for (var i = 0; i < timers.length; i++) clearTimeout(timers[i])
        }
      }, 'dsh-skill-sidebar: register skills tab')
    }

    exports.inject = inject
    exports.apply = apply
    exports.internals = {
      mergeLists,
      phraseRow,
      fullTextOf,
      readLocalCache,
      writeLocalCache,
      todayStr,
      isMonday,
      POLL_MS,
      MAX_INLINE_PHRASES,
      readPins,
      writePins,
      togglePinIn,
      sortPinnedFirst,
    }
    return module.exports
  },
})
