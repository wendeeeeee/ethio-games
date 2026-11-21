// engine/walletManager.js

class WalletManager {
  constructor() {
    // In-memory wallet store: { userId: { id, name, balance, locked } }
    this.wallets = new Map();
    // Escrow pots by roomId: { roomId: { amount, players: [] } }
    this.escrows = new Map();
  }

  getWallet(userId, name = 'Player', phone = '') {
    if (!this.wallets.has(userId)) {
      this.wallets.set(userId, {
        id: userId,
        name,
        phone: phone || '',
        balance: 1000, // Starting demo balance (1,000 ETB)
        locked: 0,
        transactions: []
      });
    } else {
      const wallet = this.wallets.get(userId);
      if (name && name !== 'Player') wallet.name = name;
      if (phone) wallet.phone = phone;
    }
    return this.wallets.get(userId);
  }

  updateProfile(userId, { name, phone }) {
    const wallet = this.getWallet(userId, name, phone);
    if (name) wallet.name = name;
    if (phone) wallet.phone = phone;
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
    }

    // Credit full pot to winner (5% platform fee)
    const platformRake = Math.floor(escrow.pot * 0.05); // 5% house rake
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
    }

    this.escrows.delete(roomId);
  }
}

module.exports = new WalletManager();

