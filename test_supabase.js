const { supabase } = require('./engine/supabaseClient');

(async () => {
  try {
    const { data, error } = await supabase.from('users').select('*').limit(1);
    console.log('users:', error ? error.message : JSON.stringify(data));
  } catch (e) { console.log('users error:', e.message); }

  try {
    const { data, error } = await supabase.from('wallets').select('*').limit(1);
    console.log('wallets:', error ? error.message : JSON.stringify(data));
  } catch (e) { console.log('wallets error:', e.message); }

  try {
    const { data, error } = await supabase.from('transactions').select('*').limit(1);
    console.log('transactions:', error ? error.message : JSON.stringify(data));
  } catch (e) { console.log('transactions error:', e.message); }

  process.exit(0);
})();
