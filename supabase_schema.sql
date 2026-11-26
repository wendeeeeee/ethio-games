-- Run this SQL in the Supabase Dashboard SQL Editor:
-- https://supabase.com/dashboard/project/ujxkeexvkejaryjmyqdz/sql/new

-- 1. Users table (stores all registered players)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Player',
  phone TEXT DEFAULT '',
  password_hash TEXT DEFAULT '',
  balance INTEGER NOT NULL DEFAULT 20,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Transaction history (deposits, withdrawals, game wins, refunds)
CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  room_id TEXT DEFAULT NULL,
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

-- 4. Enable Row Level Security (RLS) but allow service role full access
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Allow service role (server-side) to do everything
CREATE POLICY "Service role full access on users" ON users
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on transactions" ON transactions
  FOR ALL USING (true) WITH CHECK (true);

-- 5. Deposits table (stores Telebirr/CBE deposit requests & approvals)
CREATE TABLE IF NOT EXISTS deposits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_name TEXT DEFAULT '',
  user_phone TEXT DEFAULT '',
  amount INTEGER NOT NULL DEFAULT 0,
  method TEXT DEFAULT 'telebirr',
  transaction_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  admin_note TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status);
CREATE INDEX IF NOT EXISTS idx_deposits_txn ON deposits(transaction_id);

ALTER TABLE deposits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on deposits" ON deposits
  FOR ALL USING (true) WITH CHECK (true);
