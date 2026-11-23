const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ujxkeexvkejaryjmyqdz.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqeGtlZXh2a2VqYXJ5am15cWR6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5NTIyMTYxMCwiZXhwIjoyMTEwNzk3NjEwfQ.iNS0BLc4GTUEBvSdujEXAWh6xMaKWvkZHFSuy6SB81A';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  db: { schema: 'public' }
});

const statements = [
  // Create users table
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Player',
    phone TEXT DEFAULT '',
    balance INTEGER NOT NULL DEFAULT 1000,
    locked INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  // Create transactions table
  `CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    room_id TEXT DEFAULT NULL,
    description TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  // Create deposits table (tracks deposit requests with transaction IDs)
  `CREATE TABLE IF NOT EXISTS deposits (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    method TEXT NOT NULL DEFAULT 'telebirr',
    transaction_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    admin_note TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ DEFAULT NULL
  )`,
  // Indexes
  `CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone)`,
  `CREATE INDEX IF NOT EXISTS idx_deposits_user_id ON deposits(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status)`,
  `CREATE INDEX IF NOT EXISTS idx_deposits_transaction_id ON deposits(transaction_id)`
];

(async () => {
  for (const sql of statements) {
    const { data, error } = await supabase.rpc('exec_raw_sql', { sql_query: sql });
    if (error) {
      console.log('RPC failed, trying direct approach...');
      break;
    }
    console.log('OK:', sql.substring(0, 60));
  }

  // If RPC doesn't exist, we need to create tables via the Supabase Dashboard SQL editor.
  // As a workaround, let's just try inserting a test user to see if the table exists or not.
  const { data: testData, error: testErr } = await supabase.from('users').select('count').limit(1);
  if (testErr && testErr.message.includes('Could not find')) {
    console.log('\n=====================================================');
    console.log('Tables do NOT exist yet. Please create them in Supabase Dashboard:');
    console.log('Go to: https://supabase.com/dashboard/project/ujxkeexvkejaryjmyqdz/sql/new');
    console.log('=====================================================\n');
    console.log('Paste this SQL:\n');
    console.log(statements.join(';\n\n') + ';');
  } else {
    console.log('Tables exist! Test result:', testData);
  }

  process.exit(0);
})();
