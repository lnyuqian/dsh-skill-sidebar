// Verify the client-modules resolution contract for dsh-skill-sidebar exactly
// as @deepseek-ai/dsh-client-modules would at boot (run with cwd = profile dir).
import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

const req = createRequire(process.cwd() + '/')
const pkgPath = req.resolve('dsh-skill-sidebar/package.json')
console.log('pkgPath:', pkgPath)
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
console.log('dsh.bundle.patch:', pkg.dsh?.bundle?.patch)
console.log('dsh.client:', JSON.stringify(pkg.dsh?.client))
const clientExp = pkg.exports?.['./client']
const clientRel = typeof clientExp === 'string' ? clientExp : clientExp?.default
console.log('exports[./client]:', clientRel)
const clientPath = join(dirname(pkgPath), clientRel)
console.log('clientPath exists:', existsSync(clientPath))
const c = readFileSync(clientPath, 'utf8')
const idMatch = /id:\s*['"]([^'"]+)['"]/.exec(c)
console.log('client.js registers __ModuleLoader__:', c.includes('window.__ModuleLoader__.load'))
console.log('client.js id:', idMatch ? idMatch[1] : '(not found)')
console.log('client.js exports apply/inject:', c.includes('exports.apply') && c.includes('exports.inject'))
console.log('client.js inject declares betterSidebar:', c.includes('betterSidebar'))
