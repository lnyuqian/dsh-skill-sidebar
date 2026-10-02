/**
 * 把 lib/skills-zh.json 内联进 lib/client.js 的 @zh-inline 标记之间。
 *
 * 为什么需要内联：桌面版客户端 bundle 走 client-hmr（每 500ms 轮询文件 mtime/size）
 * 即时重载，而宿主半侧（lib/index.js）只有重启应用才会重新 import。把中文表放进
 * 客户端后，列表第二行与悬停中文说明在**不重启**的情况下也能生效；等宿主重启后
 * 服务端数据自带 `zh`，客户端合并逻辑是幂等的（同一份来源，不产生分歧）。
 *
 * 用法：node scripts/sync-zh.mjs   （改动 lib/skills-zh.json 后运行）
 */
import { readFileSync, writeFileSync } from 'node:fs'

const CLIENT = new URL('../lib/client.js', import.meta.url)
const TABLE = new URL('../lib/skills-zh.json', import.meta.url)
const START = '    /* @zh-inline-start'
const END = '    /* @zh-inline-end */'

const table = JSON.parse(readFileSync(TABLE, 'utf8'))
const names = Object.keys(table).filter((k) => k !== '_meta').sort()
const entries = names.map((name) => `      ${JSON.stringify(name)}: ${JSON.stringify(table[name])},`)

const block = [
  `${START} (generated from lib/skills-zh.json by scripts/sync-zh.mjs — do not edit by hand) */`,
  '    var ZH_INLINE = {',
  ...entries,
  '    }',
  END,
].join('\n')

const src = readFileSync(CLIENT, 'utf8')
const startIdx = src.indexOf(START)
const endIdx = src.indexOf(END)
if (startIdx === -1 || endIdx === -1) throw new Error('lib/client.js 缺少 @zh-inline 标记')
if (endIdx < startIdx) throw new Error('lib/client.js 的 @zh-inline 标记顺序异常')

writeFileSync(CLIENT, src.slice(0, startIdx) + block + src.slice(endIdx + END.length), 'utf8')
console.log(`synced ${names.length} entries from lib/skills-zh.json into lib/client.js`)
