// Tiny wrapper to run the local PostgreSQL cluster used for development: node scripts/pg.mjs init|start|stop|status
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const env = existsSync(path.join(root, '.env.local')) ? readFileSync(path.join(root, '.env.local'), 'utf8') : ''
const bin = process.env.PG_BIN || (env.match(/^PG_BIN=(.+)$/m)?.[1] ?? '')
const exe = (n) => path.join(bin, process.platform === 'win32' ? `${n}.exe` : n)
const data = path.join(root, '.pgdata')
const port = '54329'
const [cmd] = process.argv.slice(2)

if (cmd === 'init') {
  if (!existsSync(data)) {
    spawnSync(exe('initdb'), ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--locale=C'], { stdio: 'inherit' })
  }
  console.log('Cluster ready at', data)
} else if (cmd === 'start') {
  const log = path.join(data, 'server.log')
  if (process.platform === 'win32') {
    // Start in its own hidden console so a Ctrl-C sent to the launching terminal can't take the database down.
    const args = `'-D','${data}','-p','${port}','-c','listen_addresses=127.0.0.1'`
    spawnSync('powershell.exe', ['-NoProfile', '-Command', `Start-Process -FilePath '${exe('postgres')}' -ArgumentList ${args} -WindowStyle Hidden -RedirectStandardError '${log}' -RedirectStandardOutput '${log}.out'`], { stdio: 'ignore' })
  } else {
    spawn(exe('pg_ctl'), ['-D', data, '-o', `-p ${port} -c listen_addresses=127.0.0.1`, '-l', log, 'start'], { detached: true, stdio: 'ignore' }).unref()
  }
  console.log(`Starting PostgreSQL on 127.0.0.1:${port} (logs: .pgdata/server.log)`)
} else if (cmd === 'stop') {
  spawnSync(exe('pg_ctl'), ['-D', data, 'stop', '-m', 'fast'], { stdio: 'inherit' })
} else if (cmd === 'status') {
  spawnSync(exe('pg_ctl'), ['-D', data, 'status'], { stdio: 'inherit' })
} else if (cmd === 'createdb') {
  for (const db of process.argv.slice(3)) spawnSync(exe('createdb'), ['-h', '127.0.0.1', '-p', port, '-U', 'postgres', db], { stdio: 'inherit' })
} else {
  console.log('usage: node scripts/pg.mjs init|start|stop|status|createdb <name...>')
}
