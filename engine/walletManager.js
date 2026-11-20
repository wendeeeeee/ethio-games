// engine/walletManager.js

class WalletManager {
  constructor() {
    // In-memory wallet store: { userId: { id, name, balance, locked } }
    this.wallets = new Map();
    // Escrow pots by roomId: { roomId: { amount, players: [] } }
    this.escrows = new Map();
  }

  getWallet(userId, name = 'Player') {
    if (!this.wallets.has(userId)) {
      this.wallets.set(userId, {
        id: userId,
        name,
        balance: 1000, // Starting demo balance (1,000 ETB)
        locked: 0,
        transactions: []
      });
    }
    return this.wallets.get(userId);
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
    const w1 = this.getWallet(player1Id);
    const w2 = this.getWallet(player2Id);

    if (w1.balance < stakeAmount) {
      return { success: false, message: `${w1.name} has insufficient balance for ${stakeAmount} ETB stake` };
    }
    if (w2.balance < stakeAmount) {
      return { success: false, message: `${w2.name} has insufficient balance for ${stakeAmount} ETB stake` };
    }

    w1.balance -= stakeAmount;
    w1.locked += stakeAmount;

    w2.balance -= stakeAmount;
    w2.locked += stakeAmount;

    const pot = stakeAmount * 2;
    this.escrows.set(roomId, {
      roomId,
      stakeAmount,
      pot,
      player1Id,
      player2Id
    });

    return { success: true, pot };
  }

  payoutWinner(roomId, winnerId) {
    const escrow = this.escrows.get(roomId);
    if (!escrow) return null;

    const winnerWallet = this.getWallet(winnerId);
    const p1Wallet = this.getWallet(escrow.player1Id);
    const p2Wallet = this.getWallet(escrow.player2Id);

    // Release locked stakes
    p1Wallet.locked = Math.max(0, p1Wallet.locked - escrow.stakeAmount);
    p2Wallet.locked = Math.max(0, p2Wallet.locked - escrow.stakeAmount);

    // Credit full pot to winner (can deduct a 5% platform fee if desired)
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

    const p1Wallet = this.getWallet(escrow.player1Id);
    const p2Wallet = this.getWallet(escrow.player2Id);

    p1Wallet.balance += escrow.stakeAmount;
    p1Wallet.locked -= escrow.stakeAmount;

    p2Wallet.balance += escrow.stakeAmount;
    p2Wallet.locked -= escrow.stakeAmount;

    this.escrows.delete(roomId);
  }
}

module.exports = new WalletManager();

