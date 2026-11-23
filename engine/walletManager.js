// engine/walletManager.js
// Supabase-backed wallet manager — persists users & balances to the database with local fallback

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { supabase } = require('./supabaseClient');

const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');

function hashPassword(password) {
  if (!password) return '';
  return crypto.createHash('sha256').update(password + '_conquer_salt_2024').digest('hex');
}

class WalletManager {
  constructor() {
    // In-memory cache for fast access during gameplay
    this.wallets = new Map();
    // Escrow pots by roomId: { roomId: { amount, players: [] } }
    this.escrows = new Map();
    this.usersList = [];
    this._loadUsersFromFile();
  }

  _loadUsersFromFile() {
    try {
      if (fs.existsSync(USERS_FILE)) {
        const raw = fs.readFileSync(USERS_FILE, 'utf8');
        this.usersList = JSON.parse(raw);
        // Pre-populate wallets cache
        this.usersList.forEach(u => {
          this.wallets.set(u.id, {
            id: u.id,
            name: u.name,
            phone: u.phone,
            balance: u.balance !== undefined ? u.balance : 1000,
            locked: u.locked || 0,
            transactions: []
          });
        });
      }
    } catch (e) {
      this.usersList = [];
    }
  }

  _saveUsersToFile() {
    try {
      fs.writeFileSync(USERS_FILE, JSON.stringify(this.usersList, null, 2), 'utf8');
    } catch (e) {
      console.error('[WalletManager] Error saving users:', e.message);
    }
  }

  _normPhone(phone) {
    if (!phone) return '';
    const digits = String(phone).replace(/[^0-9]/g, '');
    return digits.length >= 9 ? digits.slice(-9) : digits;
  }

  async registerUser({ name, phone, password, userId }) {
    const cleanPhone = (phone || '').trim();
    const cleanName = (name || '').trim();
    if (!cleanPhone) throw new Error('ስልክ ቁጥር ያስፈልጋል');
    if (!cleanName || this._isGenericName(cleanName)) throw new Error('እባክዎ ትክክለኛ ስም ያስገቡ (Player ወይም ተጫዋች መጠቀም አይቻልም)');
    if (!password || password.length < 4) throw new Error('የይለፍ ቃል ቢያንስ 4 ፊደል ወይም ቁጥር መሆን አለበት');

    const norm = this._normPhone(cleanPhone);

    // Check local file
    const existingLocal = this.usersList.find(u => u.phone === cleanPhone || (norm && this._normPhone(u.phone) === norm));
    if (existingLocal) {
      throw new Error('ይህ ስልክ ቁጥር ቀድሞ ተመዝግቧል! እባክዎ ይግቡ (Login)');
    }

    // Check in Supabase
    try {
      if (norm) {
        const { data: existingRows } = await supabase
          .from('users')
          .select('id, name, phone')
          .ilike('phone', `%${norm}%`)
          .limit(1);
        if (existingRows && existingRows.length > 0) {
          throw new Error('ይህ ስልክ ቁጥር ቀድሞ ተመዝግቧል! እባክዎ ይግቡ (Login)');
        }
      }
    } catch (e) {
      if (e.message && e.message.includes('ቀድሞ ተመዝግቧል')) throw e;
    }

    const newId = userId || ('user_' + Date.now() + '_' + Math.floor(100 + Math.random() * 900));
    const passHash = hashPassword(password);
    const userRecord = {
      id: newId,
      name: cleanName,
      phone: cleanPhone,
      passwordHash: passHash,
      balance: 1000,
      locked: 0,
      createdAt: new Date().toISOString()
    };

    this.usersList.unshift(userRecord);
    this._saveUsersToFile();

    const wallet = {
      id: newId,
      name: cleanName,
      phone: cleanPhone,
      balance: 1000,
      locked: 0,
      transactions: []
    };
    this.wallets.set(newId, wallet);

    // Save to Supabase
    supabase.from('users').insert({
      id: newId,
      name: cleanName,
      phone: cleanPhone,
      balance: 1000,
      locked: 0
    }).then(() => { }).catch(() => { });

    // Welcome bonus log
    supabase.from('transactions').insert({
      user_id: newId,
      type: 'WELCOME_BONUS',
      amount: 1000,
      description: 'የአዲስ ተጫዋች ቦነስ (Welcome bonus)'
    }).then(() => { }).catch(() => { });

    return wallet;
  }

  async loginUser({ phone, password }) {
    const cleanPhone = (phone || '').trim();
    if (!cleanPhone) throw new Error('እባክዎ ስልክ ቁጥር ያስገቡ');
    if (!password) throw new Error('እባክዎ የይለፍ ቃል ያስገቡ');

    const passHash = hashPassword(password);
    const norm = this._normPhone(cleanPhone);

    // 1. Check local file (exact match first, then normalized last 9 digits)
    let user = this.usersList.find(u => u.phone === cleanPhone) ||
      this.usersList.find(u => u.phone && norm && this._normPhone(u.phone) === norm);

    // 2. Check Supabase if not found locally
    if (!user) {
      try {
        let remote = null;
        if (norm) {
          const { data: remoteRows } = await supabase
            .from('users')
            .select('*')
            .ilike('phone', `%${norm}%`)
            .order('created_at', { ascending: false })
            .limit(1);
          if (remoteRows && remoteRows.length > 0) {
            remote = remoteRows[0];
          }
        }
        if (!remote) {
          const { data: directRows } = await supabase
            .from('users')
            .select('*')
            .eq('phone', cleanPhone)
            .order('created_at', { ascending: false })
            .limit(1);
          if (directRows && directRows.length > 0) {
            remote = directRows[0];
          }
        }
        if (remote) {
          user = {
            id: remote.id,
            name: remote.name,
            phone: remote.phone,
            passwordHash: remote.password_hash || passHash, // Set initial password if not set
            balance: remote.balance !== undefined ? remote.balance : 1000,
            locked: remote.locked || 0,
            createdAt: remote.created_at
          };
          this.usersList.unshift(user);
          this._saveUsersToFile();
        }
      } catch (e) {
        console.error('[WalletManager] Supabase login error:', e.message);
      }
    }

    if (!user) {
      throw new Error('በዚህ ስልክ ቁጥር የተመዘገበ አካውንት የለም! እባክዎ ይመዝገቡ (Sign Up)');
    }

    // Verify password or set it if first-time login for an existing user
    if (!user.passwordHash) {
      user.passwordHash = passHash;
      this._saveUsersToFile();
    } else if (user.passwordHash !== passHash) {
      throw new Error('የተሳሳተ የይለፍ ቃል (Incorrect password)! እባክዎ እንደገና ይሞክሩ');
    }

    // Cache wallet
    const wallet = {
      id: user.id,
      name: user.name,
      phone: user.phone,
      balance: user.balance !== undefined ? user.balance : 1000,
      locked: user.locked || 0,
      transactions: []
    };
    this.wallets.set(user.id, wallet);

    // Provide self-references so either destructuring or direct access works everywhere
    wallet.wallet = wallet;
    wallet.user = user;

    return wallet;
  }

  _isBot(userId) {
    if (!userId || typeof userId !== 'string') return false;
    return userId.startsWith('bot_') || userId.startsWith('seka_bot');
  }

  _isGenericName(name) {
    if (!name) return true;
    const l = name.trim().toLowerCase();
    return l === 'player' || l.startsWith('player ') || l === 'player1' || l === 'player 1' ||
      l === 'ተጫዋች' || l.startsWith('ተጫዋች') || l.startsWith('user_');
  }

  // Get or create a user wallet (checks Supabase first, then cache)
  async getWalletAsync(userId, name = '', phone = '') {
    // Never persist bots to the database
    if (this._isBot(userId)) {
      if (!this.wallets.has(userId)) {
        this.wallets.set(userId, {
          id: userId,
          name: name || 'Seka Bot (AI)',
          phone: '',
          balance: 1000000,
          locked: 0,
          transactions: []
        });
      }
      return this.wallets.get(userId);
    }

    // If phone is provided, check if a registered user with this phone exists in Supabase
    if (phone) {
      const norm = this._normPhone(phone);
      let userByPhone = null;
      if (norm) {
        const { data: rows } = await supabase
          .from('users')
          .select('*')
          .ilike('phone', `%${norm}%`)
          .order('created_at', { ascending: false })
          .limit(1);
        if (rows && rows.length > 0) userByPhone = rows[0];
      }
      if (!userByPhone) {
        const { data: rows } = await supabase
          .from('users')
          .select('*')
          .eq('phone', phone)
          .order('created_at', { ascending: false })
          .limit(1);
        if (rows && rows.length > 0) userByPhone = rows[0];
      }

      if (userByPhone) {
        const wallet = {
          id: userByPhone.id,
          name: (name && !this._isGenericName(name)) ? name : (this._isGenericName(userByPhone.name) ? '' : userByPhone.name),
          phone: userByPhone.phone,
          balance: userByPhone.balance,
          locked: userByPhone.locked,
          transactions: []
        };
        this.wallets.set(wallet.id, wallet);
        if (userId && userId !== wallet.id) {
          this.wallets.set(userId, wallet);
        }
        if (name && !this._isGenericName(name) && name !== userByPhone.name) {
          await supabase.from('users').update({ name, updated_at: new Date().toISOString() }).eq('id', wallet.id);
        }
        return wallet;
      }
    }

    // Check in-memory cache first
    if (this.wallets.has(userId)) {
      const cached = this.wallets.get(userId);
      if (name && !this._isGenericName(name)) cached.name = name;
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
        name: (name && !this._isGenericName(name)) ? name : (this._isGenericName(existing.name) ? '' : existing.name),
        phone: phone || existing.phone,
        balance: existing.balance,
        locked: existing.locked,
        transactions: []
      };
      this.wallets.set(userId, wallet);

      // Update name/phone if changed
      if ((name && !this._isGenericName(name) && name !== existing.name) || (phone && phone !== existing.phone)) {
        await supabase.from('users').update({
          name: wallet.name,
          phone: wallet.phone,
          updated_at: new Date().toISOString()
        }).eq('id', userId);
      }

      return wallet;
    }

    // Create new user in Supabase
    const resolvedName = (name && !this._isGenericName(name)) ? name : '';
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
    // Never persist bots to the database
    if (this._isBot(userId)) {
      if (!this.wallets.has(userId)) {
        this.wallets.set(userId, {
          id: userId,
          name: name || 'Seka Bot (AI)',
          phone: '',
          balance: 1000000,
          locked: 0,
          transactions: []
        });
      }
      return this.wallets.get(userId);
    }

    if (!this.wallets.has(userId)) {
      const resolvedName = (name && !this._isGenericName(name)) ? name : '';
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
      if (name && !this._isGenericName(name)) wallet.name = name;
      if (phone) wallet.phone = phone;
    }
    return this.wallets.get(userId);
  }

  async _syncUserToDb(userId, name, phone) {
    if (this._isBot(userId)) return;
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
          if (existing.name && !this._isGenericName(existing.name)) cached.name = existing.name;
          if (existing.phone) cached.phone = existing.phone;
        }
        // Update name/phone if provided
        if ((name && !this._isGenericName(name) && name !== existing.name) || (phone && phone !== existing.phone)) {
          await supabase.from('users').update({
            name: (name && !this._isGenericName(name)) ? name : (this._isGenericName(existing.name) ? '' : existing.name),
            phone: phone || existing.phone,
            updated_at: new Date().toISOString()
          }).eq('id', userId);
        }
      } else {
        // Create new user
        await supabase.from('users').insert({
          id: userId,
          name: (name && !this._isGenericName(name)) ? name : '',
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
    if (this._isBot(userId)) return;
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
    }).eq('id', userId).then(() => { }).catch(() => { });
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
    }).then(() => { }).catch(() => { });
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
    }).then(() => { }).catch(() => { });
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
      if (!this._isBot(pid)) {
        this._saveBalanceToDb(pid);
        supabase.from('transactions').insert({
          user_id: pid,
          type: 'ESCROW_LOCK',
          amount: -stake,
          room_id: roomId,
          description: `Escrow lock ${stake} ETB for game ${roomId}`
        }).then(() => { }).catch(() => { });
      }
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
      if (!this._isBot(pid)) {
        this._saveBalanceToDb(pid);
      }
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
    if (!this._isBot(winnerId)) {
      this._saveBalanceToDb(winnerId);
      supabase.from('transactions').insert({
        user_id: winnerId,
        type: 'GAME_WIN',
        amount: netWin,
        room_id: roomId,
        description: `Won ${netWin} ETB (pot: ${escrow.pot}, rake: ${platformRake})`
      }).then(() => { }).catch(() => { });
    }

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
      if (!this._isBot(pid)) {
        this._saveBalanceToDb(pid);
        supabase.from('transactions').insert({
          user_id: pid,
          type: 'ESCROW_REFUND',
          amount: escrow.stakeAmount,
          room_id: roomId,
          description: `Refund ${escrow.stakeAmount} ETB from game ${roomId}`
        }).then(() => { }).catch(() => { });
      }
    }

    this.escrows.delete(roomId);
  }
}

module.exports = new WalletManager();
