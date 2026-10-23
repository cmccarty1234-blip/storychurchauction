import { config } from 'dotenv'

config({ path: '.env.local' })

// Tests ALWAYS run against the dedicated *_test database and refuse anything else.
const url = process.env.AUCTION_TEST_DATABASE_URL
if (!url || !/_test(\?|$)/.test(url)) {
  throw new Error('AUCTION_TEST_DATABASE_URL must point at a database whose name ends in _test')
}
process.env.AUCTION_DATABASE_URL = url
