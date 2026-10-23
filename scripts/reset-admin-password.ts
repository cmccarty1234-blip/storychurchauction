/**
 * Sets a new password for an existing staff account (use when someone forgot theirs). Also re-activates the account
 * and signs it out everywhere. Runs against the database named by AUCTION_DATABASE_URL.
 *   npm run admin:reset-password -- --email you@church.org --password "a-new-long-password"
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
import { one, pool, query, dbUrl } from '../src/lib/db'
import { hashPassword } from '../src/lib/auth-core'
import { audit } from '../src/lib/audit'

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const email = arg('email')?.trim().toLowerCase()
  const password = arg('password')
  if (!email || !password) throw new Error('Required: --email and --password')
  if (password.length < 8) throw new Error('The password must be at least 8 characters.')

  const u = new URL(dbUrl())
  console.log(`Database host : ${u.hostname}\nDatabase user : ${decodeURIComponent(u.username)}   (on Supabase, the part after the dot is the project ID)`)

  const row = await one<{ id: string; name: string; role: string }>(
    'update admin_users set password_hash = $2, active = true where lower(email) = $1 returning id, name, role',
    [email, await hashPassword(password)],
  )
  if (!row) {
    const all = await query<{ email: string; role: string; active: boolean }>('select email, role, active from admin_users order by created_at')
    console.log('\nNo staff account has that email. Existing accounts:')
    for (const a of all) console.log(`  ${a.email}  (${a.role}${a.active ? '' : ', deactivated'})`)
    throw new Error('Nothing changed.')
  }
  await query('delete from admin_sessions where admin_id = $1', [row.id])
  await audit({ actorType: 'system', action: 'admin.password_reset', entityType: 'admin_user', entityId: row.id, details: { via: 'script' } })
  console.log(`\nPassword reset for ${row.name} (${row.role}) <${email}>. They can sign in now.`)
}

main()
  .then(() => pool().end())
  .catch((e) => {
    console.error(e.message ?? e)
    process.exit(1)
  })
