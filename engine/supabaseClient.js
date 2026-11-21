// engine/supabaseClient.js
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ujxkeexvkejaryjmyqdz.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqeGtlZXh2a2VqYXJ5am15cWR6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5NTIyMTYxMCwiZXhwIjoyMTEwNzk3NjEwfQ.iNS0BLc4GTUEBvSdujEXAWh6xMaKWvkZHFSuy6SB81A';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqeGtlZXh2a2VqYXJ5am15cWR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUyMjE2MTAsImV4cCI6MjExMDc5NzYxMH0.AtRXGpY_OJ8FOZGassUvYcMioWeTdKMXdaW92BxqpXw';

// Use service role key on the server for full DB access
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

module.exports = { supabase, SUPABASE_URL, SUPABASE_ANON_KEY };
