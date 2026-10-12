/**
 * 契约测试：用**真实**的 @deepseek-ai/dsh-skill 注册表验证「影子注册」能不能
 * 把不在加载清单里的技能从模型目录里摘掉。
 *
 * 依据（源码）：`runtimeCandidate()` 的 rank = RUNTIME_RANK = 250；
 * 文件系统 provider 的 rank 是 100/200/300/400/500/600；同层去重按
 * `rank → provider 顺序 → provider 内顺序` 排序后**先到先得**。
 * 所以 rank 250 的 runtime 影子能压过 user-dsh(400)/user-agents(500)/bundled(600)，
 * 但压不过项目内的 project-dsh(100)/project-agents(200)。
 *
 * 找不到本机 DSH 安装时**整体跳过**（退出码 0），这样这个文件在别的机器上也能跑。
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** 找出本机 @deepseek-ai/dsh-skill 的真实路径。 */
function findDshSkill() {
  const candidates = []
  const npmGlobal = process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-skill') : null
  if (npmGlobal) candidates.push(npmGlobal)
  if (process.env.DSH_HOME) candidates.push(join(process.env.DSH_HOME, 'node_modules', '@deepseek-ai', 'dsh-skill'))
  for (const base of [join(homedir(), '.dsh', 'profiles'), join(homedir(), '.dsh')]) {
    try {
      for (const profile of readdirSync(base)) {
        candidates.push(join(base, profile, 'node_modules', '@deepseek-ai', 'dsh-skill'))
      }
    } catch { /* profile dir missing */ }
  }
  candidates.push(join(homedir(), 'AppData', 'Local', 'Programs', 'DeepSeek Harness', 'resources', 'app.asar.unpacked', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-skill'))
  return candidates.find((p) => existsSync(join(p, 'lib', 'index.js'))) || null
}

function findCordis() {
  const npmDsh = process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules') : null
  const candidates = []
  if (npmDsh) candidates.push(join(npmDsh, '@deepseek-ai', 'cordis'))
  if (process.env.DSH_HOME) candidates.push(join(process.env.DSH_HOME, 'node_modules', '@deepseek-ai', 'cordis'))
  candidates.push(join(homedir(), 'AppData', 'Local', 'Programs', 'DeepSeek Harness', 'resources', 'app.asar.unpacked', 'dsh', 'node_modules', '@deepseek-ai', 'cordis'))
  return candidates.find((p) => existsSync(join(p, 'package.json'))) || null
}

let passed = 0
let failed = 0
function check(label, ok, extra = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${label}${extra ? ' — ' + extra : ''}`) }
  else { failed += 1; console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

const skillDir = findDshSkill()
const cordisDir = findCordis()
if (skillDir === null || cordisDir === null) {
  console.log('SKIP: 本机找不到 @deepseek-ai/dsh-skill / cordis，跳过真实注册表契约测试')
  process.exit(0)
}
console.log(`注册表: ${skillDir}`)

const { SkillRegistry } = await import(`file:///${skillDir.replaceAll('\\', '/')}/lib/index.js`)
const cordisEntry = JSON.parse((await import('node:fs')).readFileSync(join(cordisDir, 'package.json'), 'utf8'))
const cordisMain = cordisEntry.module || cordisEntry.main || 'lib/index.js'
const cordis = await import(`file:///${join(cordisDir, cordisMain).replaceAll('\\', '/')}`)
const Context = cordis.Context || cordis.default?.Context
check('cordis Context 可用', typeof Context === 'function')
if (typeof Context !== 'function') process.exit(1)

const ctx = new Context()
ctx.logger = { warn() {}, info() {}, debug() {}, error() {} }
const registry = new SkillRegistry(ctx)
check('SkillRegistry 实例化', registry !== undefined)

// 一个 rank 500（等价 ~/.agents/skills = user-agents）的假 provider。
const filesystemSkills = ['used-skill', 'unused-skill', 'project-like-skill']
ctx.skills = registry
registry.registerProvider(() => ({
  name: 'fake-filesystem',
  list: () => filesystemSkills.map((name) => ({
    name,
    description: `filesystem ${name}`,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'user-agents',
    provider: 'fake-filesystem',
    rank: 500,
    locator: { name },
    path: `C:/fake/${name}/SKILL.md`,
  })),
  get: (candidate) => ({
    name: candidate.name,
    description: `filesystem ${candidate.name}`,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'user-agents',
    provider: 'fake-filesystem',
    content: `BODY-OF-${candidate.name}`,
  }),
}))

const before = await registry.list({})
check('影子前，3 个技能全部 model-invocable', before.filter((s) => s.invocation.modelInvocable).length === 3, JSON.stringify(before.map((s) => s.name)))

// 影子注册：把 unused-skill 从模型目录摘掉（等同「不在新会话加载清单」）。
const dispose = registry.register({
  name: 'unused-skill',
  description: 'indexed only (hidden from the model catalog)',
  content: 'BODY-OF-unused-skill',
  source: 'custom',
  provider: 'dsh-skill-sidebar',
  invocation: { modelInvocable: false, userInvocable: true },
})

const after = await registry.list({})
const byName = Object.fromEntries(after.map((s) => [s.name, s]))
check('影子后仍在目录里（用户可调用）', Object.hasOwn(byName, 'unused-skill'))
check('影子条目的 modelInvocable = false', byName['unused-skill']?.invocation.modelInvocable === false)
check('影子条目的 userInvocable = true', byName['unused-skill']?.invocation.userInvocable === true)
check('影子条目的 provider 是我们自己的标签', byName['unused-skill']?.provider === 'dsh-skill-sidebar', String(byName['unused-skill']?.provider))
check('未影子技能不受影响', byName['used-skill']?.invocation.modelInvocable === true && byName['used-skill']?.provider === 'fake-filesystem')

// 模型目录侧的真实过滤（dsh-tool-skill 用的就是 isModelInvocable）。
const modelCatalog = after.filter((s) => s.invocation.modelInvocable).map((s) => s.name).sort()
check('模型目录只剩 2 个（unused-skill 已摘除）', JSON.stringify(modelCatalog) === JSON.stringify(['project-like-skill', 'used-skill']), JSON.stringify(modelCatalog))

// 用户可调用面（/技能名）仍能拿到正文。
const userCatalog = after.filter((s) => s.invocation.userInvocable).map((s) => s.name).sort()
check('用户目录仍有 3 个', userCatalog.length === 3, JSON.stringify(userCatalog))
const loaded = await registry.get('unused-skill', {})
check('用户/按需加载仍能取到正文', loaded?.content === 'BODY-OF-unused-skill', String(loaded?.content))

// 释放影子后恢复原状。
dispose()
const restored = await registry.list({})
check('释放影子后恢复 filesystem 定义', restored.find((s) => s.name === 'unused-skill')?.provider === 'fake-filesystem')

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
