const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://ujxkeexvkejaryjmyqdz.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqeGtlZXh2a2VqYXJ5am15cWR6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5NTIyMTYxMCwiZXhwIjoyMTEwNzk3NjEwfQ.iNS0BLc4GTUEBvSdujEXAWh6xMaKWvkZHFSuy6SB81A'
);

async function main() {
  const { data, error } = await supabase.from('deposits').select('id').limit(1);
  if (error) {
    console.log('deposits table does NOT exist or error:', error.message);
    console.log('\nPlease create it in Supabase SQL Editor:');
    console.log('https://supabase.com/dashboard/project/ujxkeexvkejaryjmyqdz/sql/new\n');
    console.log(`CREATE TABLE IF NOT EXISTS deposits (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'telebirr',
  transaction_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  admin_note TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_deposits_user_id ON deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status);
CREATE INDEX IF NOT EXISTS idx_deposits_transaction_id ON deposits(transaction_id);`);
  } else {
    console.log('deposits table exists! Rows:', data.length);
  }
  process.exit(0);
}
main();
