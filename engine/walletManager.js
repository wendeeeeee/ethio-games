// engine/walletManager.js
// Supabase-backed wallet manager — persists users & balances to the database

const { supabase } = require('./supabaseClient');

class WalletManager {
  constructor() {
    // In-memory cache for fast access during gameplay
    this.wallets = new Map();
    // Escrow pots by roomId: { roomId: { amount, players: [] } }
    this.escrows = new Map();
  }

  // Get or create a user wallet (checks Supabase first, then cache)
  async getWalletAsync(userId, name = 'Player', phone = '') {
    // If phone is provided, check if a registered user with this phone exists in Supabase
    if (phone) {
      const { data: userByPhone } = await supabase
        .from('users')
        .select('*')
        .eq('phone', phone)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (userByPhone) {
        const wallet = {
          id: userByPhone.id,
          name: (name && name.toLowerCase() !== 'player') ? name : userByPhone.name,
          phone: userByPhone.phone,
          balance: userByPhone.balance,
          locked: userByPhone.locked,
          transactions: []
        };
        this.wallets.set(wallet.id, wallet);
        if (userId && userId !== wallet.id) {
          this.wallets.set(userId, wallet);
        }
        if (name && name.toLowerCase() !== 'player' && name !== userByPhone.name) {
          await supabase.from('users').update({ name, updated_at: new Date().toISOString() }).eq('id', wallet.id);
        }
        return wallet;
      }
    }

    // Check in-memory cache first
    if (this.wallets.has(userId)) {
      const cached = this.wallets.get(userId);
      if (name && name.toLowerCase() !== 'player') cached.name = name;
      if (phone) cached.phone = phone;
      return cached;
    }

    // Try to load from Supabase
    const { data: existing } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (existing) {
      const wallet = {
        id: existing.id,
        name: (name && name.toLowerCase() !== 'player') ? name : existing.name,
        phone: phone || existing.phone,
        balance: existing.balance,
        locked: existing.locked,
        transactions: []
      };
      this.wallets.set(userId, wallet);

      // Update name/phone if changed
      if ((name && name.toLowerCase() !== 'player' && name !== existing.name) || (phone && phone !== existing.phone)) {
        await supabase.from('users').update({
          name: wallet.name,
          phone: wallet.phone,
          updated_at: new Date().toISOString()
        }).eq('id', userId);
      }

      return wallet;
    }

    // Create new user in Supabase
    const resolvedName = (name && name.toLowerCase() !== 'player') ? name : (phone ? `User_${phone.slice(-4)}` : 'ተጫዋች');
    const newWallet = {
      id: userId,
      name: resolvedName,
      phone: phone || '',
      balance: 1000,
      locked: 0,
      transactions: []
    };

    await supabase.from('users').insert({
      id: userId,
      name: newWallet.name,
      phone: newWallet.phone,
      balance: 1000,
      locked: 0
    });

    // Log the welcome bonus
    await supabase.from('transactions').insert({
      user_id: userId,
      type: 'WELCOME_BONUS',
      amount: 1000,
      description: 'የአዲስ ተጫዋች ቦነስ (Welcome bonus)'
    });

    this.wallets.set(userId, newWallet);
    return newWallet;
  }

  // Synchronous fallback (uses cache; for compatibility with existing code)
  getWallet(userId, name = '', phone = '') {
    if (!this.wallets.has(userId)) {
      const resolvedName = (name && name.toLowerCase() !== 'player') ? name : (phone ? `User_${phone.slice(-4)}` : 'ተጫዋች');
      this.wallets.set(userId, {
        id: userId,
        name: resolvedName,
        phone: phone || '',
        balance: 1000,
        locked: 0,
        transactions: []
      });
      // Fire-and-forget: sync to Supabase
      this._syncUserToDb(userId, resolvedName, phone);
    } else {
      const wallet = this.wallets.get(userId);
      if (name && name.toLowerCase() !== 'player') wallet.name = name;
      if (phone) wallet.phone = phone;
    }
    return this.wallets.get(userId);
  }

  async _syncUserToDb(userId, name, phone) {
    try {
      const { data: existing } = await supabase
        .from('users')
        .select('id, balance, locked, name, phone')
        .eq('id', userId)
        .single();

      if (existing) {
        // Load from DB into cache
        const cached = this.wallets.get(userId);
        if (cached) {
          cached.balance = existing.balance;
          cached.locked = existing.locked;
          if (existing.name && existing.name !== 'Player') cached.name = existing.name;
          if (existing.phone) cached.phone = existing.phone;
        }
        // Update name/phone if provided
        if ((name && name !== 'Player' && name !== existing.name) || (phone && phone !== existing.phone)) {
          await supabase.from('users').update({
            name: (name && name !== 'Player') ? name : existing.name,
            phone: phone || existing.phone,
            updated_at: new Date().toISOString()
          }).eq('id', userId);
        }
      } else {
        // Create new user
        await supabase.from('users').insert({
          id: userId,
          name: name || 'Player',
          phone: phone || '',
          balance: 1000,
          locked: 0
        });
        await supabase.from('transactions').insert({
          user_id: userId,
          type: 'WELCOME_BONUS',
          amount: 1000,
          description: 'የአዲስ ተጫዋች ቦነስ (Welcome bonus)'
        });
      }
    } catch (err) {
      console.error('[WalletManager] Supabase sync error:', err.message);
    }
  }

  async _saveBalanceToDb(userId) {
    const wallet = this.wallets.get(userId);
    if (!wallet) return;
    try {
      await supabase.from('users').update({
        balance: wallet.balance,
        locked: wallet.locked,
        updated_at: new Date().toISOString()
      }).eq('id', userId);
    } catch (err) {
      console.error('[WalletManager] Save balance error:', err.message);
    }
  }

  async updateProfileAsync(userId, { name, phone }) {
    const wallet = await this.getWalletAsync(userId, name, phone);
    if (name) wallet.name = name;
    if (phone) wallet.phone = phone;

    await supabase.from('users').update({
      name: wallet.name,
      phone: wallet.phone,
      updated_at: new Date().toISOString()
    }).eq('id', wallet.id);

    return wallet;
  }

  updateProfile(userId, { name, phone }) {
    const wallet = this.getWallet(userId, name, phone);
    if (name) wallet.name = name;
    if (phone) wallet.phone = phone;
    // Fire-and-forget save
    supabase.from('users').update({
      name: wallet.name,
      phone: wallet.phone,
      updated_at: new Date().toISOString()
    }).eq('id', userId).then(() => {}).catch(() => {});
    return wallet;
  }

  deposit(userId, amount) {
    const wallet = this.getWallet(userId);
    wallet.balance += amount;
    wallet.transactions.push({
      type: 'DEPOSIT',
      amount,
      date: new Date().toISOString()
    });
    // Persist
    this._saveBalanceToDb(userId);
    supabase.from('transactions').insert({
      user_id: userId,
      type: 'DEPOSIT',
      amount,
      description: `Deposit ${amount} ETB`
    }).then(() => {}).catch(() => {});
    return wallet;
  }

  withdraw(userId, amount) {
    const wallet = this.getWallet(userId);
    if (wallet.balance < amount) return { success: false, message: 'Insufficient balance' };
    wallet.balance -= amount;
    wallet.transactions.push({
      type: 'WITHDRAW',
      amount,
      date: new Date().toISOString()
    });
    this._saveBalanceToDb(userId);
    supabase.from('transactions').insert({
      user_id: userId,
      type: 'WITHDRAW',
      amount: -amount,
      description: `Withdraw ${amount} ETB`
    }).then(() => {}).catch(() => {});
    return { success: true, wallet };
  }

  lockEscrow(roomId, player1Id, player2Id, stakeAmount) {
    let playerIds = [];
    let stake = stakeAmount;
    if (Array.isArray(player1Id)) {
      playerIds = player1Id;
      stake = player2Id;
    } else if (Array.isArray(player2Id)) {
      playerIds = [player1Id, ...player2Id];
    } else {
      playerIds = [player1Id, player2Id];
    }

    const wallets = playerIds.map(id => this.getWallet(id));
    for (const w of wallets) {
      if (w.balance < stake) {
        return { success: false, message: `${w.name} has insufficient balance for ${stake} ETB stake` };
      }
    }

    for (const w of wallets) {
      w.balance -= stake;
      w.locked += stake;
    }

    const pot = stake * playerIds.length;
    this.escrows.set(roomId, {
      roomId,
      stakeAmount: stake,
      pot,
      playerIds,
      player1Id: playerIds[0],
      player2Id: playerIds[1]
    });

    // Persist balances
    for (const pid of playerIds) {
      this._saveBalanceToDb(pid);
      supabase.from('transactions').insert({
        user_id: pid,
        type: 'ESCROW_LOCK',
        amount: -stake,
        room_id: roomId,
        description: `Escrow lock ${stake} ETB for game ${roomId}`
      }).then(() => {}).catch(() => {});
    }

    return { success: true, pot };
  }

  payoutWinner(roomId, winnerId) {
    const escrow = this.escrows.get(roomId);
    if (!escrow) return null;

    const winnerWallet = this.getWallet(winnerId);
    const playerIds = escrow.playerIds || [escrow.player1Id, escrow.player2Id].filter(Boolean);

    // Release locked stakes
    for (const pid of playerIds) {
      const pWallet = this.getWallet(pid);
      pWallet.locked = Math.max(0, pWallet.locked - escrow.stakeAmount);
      this._saveBalanceToDb(pid);
    }

    // Credit full pot to winner (5% platform fee)
    const platformRake = Math.floor(escrow.pot * 0.05);
    const netWin = escrow.pot - platformRake;

    winnerWallet.balance += netWin;
    winnerWallet.transactions.push({
      type: 'GAME_WIN',
      amount: netWin,
      pot: escrow.pot,
      rake: platformRake,
      roomId,
      date: new Date().toISOString()
    });

    // Persist
    this._saveBalanceToDb(winnerId);
    supabase.from('transactions').insert({
      user_id: winnerId,
      type: 'GAME_WIN',
      amount: netWin,
      room_id: roomId,
      description: `Won ${netWin} ETB (pot: ${escrow.pot}, rake: ${platformRake})`
    }).then(() => {}).catch(() => {});

    this.escrows.delete(roomId);
    return { winnerWallet, netWin, rake: platformRake };
  }

  refundEscrow(roomId) {
    const escrow = this.escrows.get(roomId);
    if (!escrow) return;

    const playerIds = escrow.playerIds || [escrow.player1Id, escrow.player2Id].filter(Boolean);
    for (const pid of playerIds) {
      const pWallet = this.getWallet(pid);
      pWallet.balance += escrow.stakeAmount;
      pWallet.locked = Math.max(0, pWallet.locked - escrow.stakeAmount);
      this._saveBalanceToDb(pid);
      supabase.from('transactions').insert({
        user_id: pid,
        type: 'ESCROW_REFUND',
        amount: escrow.stakeAmount,
        room_id: roomId,
        description: `Refund ${escrow.stakeAmount} ETB from game ${roomId}`
      }).then(() => {}).catch(() => {});
    }

    this.escrows.delete(roomId);
  }
}

module.exports = new WalletManager();
