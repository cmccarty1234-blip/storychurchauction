// Orchestrates the simulation: fresh *_sim database → demo seed → production server on :3100 → simulate.ts → stop server.
//   npm run sim            (uses an existing production build; run `npm run build` first)
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const envFile = existsSync(path.join(root, '.env.local')) ? readFileSync(path.join(root, '.env.local'), 'utf8') : ''
const get = (k) => process.env[k] ?? envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]
const base = get('AUCTION_DATABASE_URL')
if (!base) throw new Error('AUCTION_DATABASE_URL missing')
const simUrl = base.replace(/\/[^/?]+(\?.*)?$/, '/storychurch_sim$1')
if (!/_sim(\?|$)/.test(simUrl)) throw new Error('refusing: sim URL does not end in _sim')
if (!existsSync(path.join(root, '.next', 'BUILD_ID'))) throw new Error('No production build found. Run `npm run build` first.')

const env = { ...process.env, AUCTION_DATABASE_URL: simUrl, NEXT_PUBLIC_APP_URL: 'http://localhost:3100', UPLOAD_DIR: path.join(root, 'uploads-sim') }
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: root, env, stdio: 'inherit', shell: true, ...opts })

console.log('› resetting', simUrl)
const pg = (await import('pg')).default
const c = new pg.Client({ connectionString: simUrl })
await c.connect()
await c.query('drop schema public cascade; create schema public;')
await c.end()
if (run('npx', ['tsx', 'scripts/migrate.ts', simUrl]).status) process.exit(1)
if (run('npx', ['tsx', 'scripts/seed.ts', '--reset']).status) process.exit(1)

console.log('› starting production server on :3100 (NODE_ENV=production)')
const server = spawn('npx', ['next', 'start', '-p', '3100'], { cwd: root, env: { ...env, NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'], shell: true })
server.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`))
server.stderr.on('data', (d) => process.stdout.write(`[server] ${d}`))

const up = async () => { for (let i = 0; i < 60; i++) { try { if ((await fetch('http://localhost:3100/')).status === 200) return true } catch {} await new Promise((r) => setTimeout(r, 1000)) } return false }
if (!(await up())) { server.kill(); console.error('server did not start'); process.exit(1) }

const sim = run('npx', ['tsx', 'scripts/simulate.ts'], { env: { ...env, SIM_BASE_URL: 'http://localhost:3100' } })
spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { shell: true, stdio: 'ignore' })
process.exit(sim.status ?? 1)
