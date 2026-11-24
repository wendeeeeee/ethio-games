// engine/sekaGameRoom.js
const {
  createSekaDeck,
  shuffleDeck,
  isSekaJoker,
  validateSekaWinningHand,
  partition10CardsIntoSekaMelds
} = require('./sekaRules');
const { RANK_ORDER } = require('./cardTypes');
const walletManager = require('./walletManager');

class SekaGameRoom {
  constructor(roomId, creator, stakeAmount = 100, maxPlayers = 2) {
    this.roomId = roomId;
    this.maxPlayers = Number(maxPlayers) === 3 ? 3 : 2;
    this.players = [creator];
    this.creator = creator; // { id, name, socketId, isBot }
    this.joiner = null;     // { id, name, socketId, isBot }
    this.stakeAmount = stakeAmount;
    this.pot = 0;
    this.status = 'WAITING'; // WAITING, PLAYING, FINISHED
    this.gameType = 'SEKA';

    this.deck = [];
    this.discardPile = [];

    this.hands = { [creator.id]: [] };
    this.creatorHand = [];
    this.joinerHand = [];

    this.currentTurnPlayerId = null;
    this.turnState = null; // 'AWAITING_DRAW', 'AWAITING_DISCARD'

    this.winner = null;
    this.winReason = null;
    this.winningMelds = null;
    this.logs = [];

    // 60-Second Turn & Leave Timers
    this.turnDuration = 60 * 1000;
    this.turnDeadline = null;
    this.turnTimer = null;
    this.temporarilyLeft = {};
    this.leaveTimeouts = {};
    this.onTurnTimeoutCallback = null;
    this.onLeaveTimeoutCallback = null;
    this.forfeitedPlayer = null;
  }

  clearAllTimers() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    if (this.leaveTimeouts) {
      for (const uid in this.leaveTimeouts) {
        clearTimeout(this.leaveTimeouts[uid]);
      }
      this.leaveTimeouts = {};
    }
  }

  resetTurnTimer(onTimeout) {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    if (this.status !== 'PLAYING') return;

    this.turnDeadline = Date.now() + this.turnDuration;
    const activePlayer = this.players.find(p => p.id === this.currentTurnPlayerId);
    if (!activePlayer || activePlayer.isBot) return;

    const cb = onTimeout || this.onTurnTimeoutCallback;
    this.turnTimer = setTimeout(() => {
      if (this.status === 'PLAYING') {
        this.handleTurnTimeout(cb);
      }
    }, this.turnDuration);
  }

  handleTurnTimeout(onTimeout) {
    if (this.status !== 'PLAYING') return;
    const timedOutPlayer = this.players.find(p => p.id === this.currentTurnPlayerId);
    if (!timedOutPlayer) return;

    const opponents = this.players.filter(p => p.id !== timedOutPlayer.id);
    const winner = opponents[0] || this.creator;

    this.status = 'FINISHED';
    this.winner = winner;
    this.winReason = 'TIMEOUT_FORFEIT';
    this.forfeitedPlayer = timedOutPlayer;

    walletManager.payoutWinner(this.roomId, winner.id);
    this.log(`⏰ ተጫዋች ${timedOutPlayer.name} በ1 ደቂቃ ውስጥ ካርታ ስላልጣለ ተሸንፏል! ${winner.name} አሸነፈ (Timeout)!`);

    this.clearAllTimers();

    if (onTimeout) onTimeout(this, winner, timedOutPlayer);
  }

  playerLeaveTemp(userId, onTimeout) {
    if (this.status !== 'PLAYING') return;
    const leftPlayer = this.players.find(p => p.id === userId);
    if (!leftPlayer) return;

    const deadline = Date.now() + 60 * 1000;
    this.temporarilyLeft[userId] = {
      name: leftPlayer.name,
      deadline
    };

    this.log(`🚪 ${leftPlayer.name} ለጊዜው ከጠረጴዛው ወጥቷል! በ1 ደቂቃ ውስጥ ካልተመለሰ ይሸነፋል!`);

    if (this.leaveTimeouts[userId]) {
      clearTimeout(this.leaveTimeouts[userId]);
    }

    const cb = onTimeout || this.onLeaveTimeoutCallback;
    this.leaveTimeouts[userId] = setTimeout(() => {
      if (this.status === 'PLAYING' && this.temporarilyLeft[userId]) {
        const opponents = this.players.filter(p => p.id !== userId);
        const winner = opponents[0] || this.creator;

        this.status = 'FINISHED';
        this.winner = winner;
        this.winReason = 'ABANDON_FORFEIT';
        this.forfeitedPlayer = leftPlayer;

        walletManager.payoutWinner(this.roomId, winner.id);
        this.log(`❌ ${leftPlayer.name} በ1 ደቂቃ ውስጥ ስላልተመለሰ ተሸንፏል! ${winner.name} አሸነፈ!`);

        delete this.temporarilyLeft[userId];
        delete this.leaveTimeouts[userId];

        this.clearAllTimers();

        if (cb) cb(this, winner, leftPlayer);
      }
    }, 60 * 1000);
  }

  playerReturn(userId) {
    if (this.leaveTimeouts && this.leaveTimeouts[userId]) {
      clearTimeout(this.leaveTimeouts[userId]);
      delete this.leaveTimeouts[userId];
    }
    if (this.temporarilyLeft && this.temporarilyLeft[userId]) {
      delete this.temporarilyLeft[userId];
    }
    const returningPlayer = this.players.find(p => p.id === userId);
    if (returningPlayer) {
      this.log(`👋 ${returningPlayer.name} ወደ ጨዋታው ተመልሷል!`);
    }
  }

  log(message) {
    const time = new Date().toLocaleTimeString();
    this.logs.unshift(`[${time}] ${message}`);
    if (this.logs.length > 50) this.logs.pop();
  }

  join(player) {
    if (this.players.length >= this.maxPlayers) return { success: false, message: 'Room already full' };
    this.players.push(player);
    this.hands[player.id] = [];
    if (!this.joiner) this.joiner = player;

    if (this.players.length === this.maxPlayers) {
      // Lock bets into Escrow
      const escrowResult = walletManager.lockEscrow(this.roomId, this.players.map(p => p.id), this.stakeAmount);
      if (!escrowResult.success) {
        this.players.pop();
        if (this.joiner && this.joiner.id === player.id) this.joiner = null;
        return { success: false, message: escrowResult.message };
      }
      this.pot = escrowResult.pot;

      // Start Seka Game immediately (no cutting joker in Seka)
      this.startGame();
      return { success: true, started: true };
    }

    return { success: true, started: false, waitingFor: this.maxPlayers - this.players.length };
  }

  startGame() {
    this.deck = shuffleDeck(createSekaDeck());
    this.discardPile = [];
    this.players.forEach(p => {
      this.hands[p.id] = [];
    });

    // Deal: 10 cards to each player
    for (let i = 0; i < 10; i++) {
      for (const p of this.players) {
        this.hands[p.id].push(this.deck.pop());
      }
    }
    // Creator gets 11th card (Starter / አጫዋች)
    this.hands[this.creator.id].push(this.deck.pop());

    this.creatorHand = this.hands[this.creator.id];
    this.joinerHand = this.players[1] ? this.hands[this.players[1].id] : [];

    this.status = 'PLAYING';
    // Creator starts in AWAITING_DISCARD because they already have 11 cards
    this.currentTurnPlayerId = this.creator.id;
    this.turnState = 'AWAITING_DISCARD';
    this.resetTurnTimer();

    this.log(`🎮 ሴካ ጨዋታ ተጀመረ! ፖት: ${this.pot} ETB (${this.players.length} ተጫዋቾች)።`);
    this.log(`🃏 አጫዋች ${this.creator.name} 11 ካርታ ተሰጥቶታል፤ 1 ካርታ ወደ መሬት በመጣል ጨዋታውን ይጀምራል!`);
    for (let i = 1; i < this.players.length; i++) {
      this.log(`🃏 ${this.players[i].name} 10 ካርታ ተሰጥቶታል።`);
    }
  }

  getHand(playerId) {
    return this.hands[playerId] || null;
  }

  setHand(playerId, newHand) {
    this.hands[playerId] = newHand;
    if (playerId === this.creator.id) this.creatorHand = newHand;
    else if (this.joiner && playerId === this.joiner.id) this.joinerHand = newHand;
  }

  drawCard(playerId, source = 'deck') {
    if (this.status !== 'PLAYING') {
      return { success: false, message: 'ጨዋታው በሂደት ላይ አይደለም!' };
    }
    if (this.currentTurnPlayerId !== playerId) {
      return { success: false, message: 'የአንተ ተራ አይደለም!' };
    }
    if (this.turnState !== 'AWAITING_DRAW') {
      return { success: false, message: 'ቀድመህ ካርታ አንስተሃል፤ አሁን 1 ካርታ ጣል!' };
    }

    let drawnCard = null;

    if (source === 'ground') {
      if (this.discardPile.length === 0) {
        return { success: false, message: 'መሬት ላይ ምንም ካርታ የለም!' };
      }
      // Free ground draw in Seka (no 41 restriction)
      drawnCard = this.discardPile.pop();
    } else {
      // Draw from deck
      if (this.deck.length === 0) {
        if (this.discardPile.length <= 1) {
          return { success: false, message: 'በቂ ካርታ የለም!' };
        }
        // Reshuffle discard pile keeping top card
        const topDiscard = this.discardPile.pop();
        this.deck = shuffleDeck([...this.discardPile]);
        this.discardPile = [topDiscard];
        this.log('🔄 የካርታ መደብ አልቆ ከመሬት ተደባልቆ አዲስ መደብ ተሰራ።');
      }
      drawnCard = this.deck.pop();
    }

    const hand = this.getHand(playerId);
    hand.push(drawnCard);

    this.turnState = 'AWAITING_DISCARD';
    const playerObj = this.players.find(p => p.id === playerId);
    const playerName = playerObj ? playerObj.name : 'Player';
    this.log(`📥 ${playerName} ከ${source === 'ground' ? 'መሬት' : 'መደብ'} [ ${drawnCard.suit} ${drawnCard.rank} ] አነሳ።`);

    return { success: true, card: drawnCard, from: source };
  }

  discardCard(playerId, cardId, melds = null) {
    if (this.status !== 'PLAYING') {
      return { success: false, message: 'ጨዋታው በሂደት ላይ አይደለም!' };
    }
    if (this.currentTurnPlayerId !== playerId) {
      return { success: false, message: 'የአንተ ተራ አይደለም!' };
    }
    if (this.turnState !== 'AWAITING_DISCARD') {
      return { success: false, message: 'መጀመሪያ ካርታ አንሳ!' };
    }

    const hand = this.getHand(playerId);
    const cardIndex = hand.findIndex(c => String(c.id) === String(cardId));
    if (cardIndex === -1) {
      return { success: false, message: 'የተመረጠው ካርታ እጅህ ላይ የለም!' };
    }

    const cardToDiscard = hand[cardIndex];

    // Normal Discard (passes turn to next player in circular order)
    // In Seka, winning is never automatic on discard; a player must explicitly click "ሴካ አሸንፍ" (claimWin)!
    hand.splice(cardIndex, 1);
    this.discardPile.push(cardToDiscard);

    const playerObj = this.players.find(p => p.id === playerId);
    const playerName = playerObj ? playerObj.name : 'Player';
    this.log(`📤 ${playerName} [ ${cardToDiscard.suit} ${cardToDiscard.rank} ] ወደ መሬት ጣለ።`);

    // Switch Turn
    const currIdx = this.players.findIndex(p => p.id === playerId);
    const nextIdx = (currIdx + 1) % this.players.length;
    this.currentTurnPlayerId = this.players[nextIdx].id;
    this.turnState = 'AWAITING_DRAW';
    this.resetTurnTimer();

    return {
      success: true,
      isWin: false,
      discardedCard: cardToDiscard,
      nextTurnPlayerId: this.currentTurnPlayerId
    };
  }

  claimWin(playerId, discardCardId = null) {
    if (this.status !== 'PLAYING') {
      return { success: false, message: 'ጨዋታው በሂደት ላይ አይደለም!' };
    }
    if (this.currentTurnPlayerId !== playerId) {
      return { success: false, message: 'የአንተ ተራ አይደለም!' };
    }
    if (this.turnState !== 'AWAITING_DISCARD') {
      return { success: false, message: 'ለማሸነፍ 11 ካርታ ሊኖርህ ይገባል (መጀመሪያ አንሳ)!' };
    }

    const hand = this.getHand(playerId);
    let discardCard = null;

    if (discardCardId) {
      discardCard = hand.find(c => String(c.id) === String(discardCardId));
    }

    // Check with specified discard card, or fallback to auto-detecting any valid discard card
    let winCheck = discardCard ? validateSekaWinningHand(hand, discardCard) : null;
    if (!winCheck || !winCheck.valid) {
      const fallbackCheck = validateSekaWinningHand(hand, null);
      if (fallbackCheck.valid) {
        winCheck = fallbackCheck;
      }
    }

    if (!winCheck || !winCheck.valid) {
      return {
        success: false,
        message: 'ካርታዎችህ 2 ትሪስ እና 1 ኳትሪስ አላሟሉም!'
      };
    }

    // Player wins!
    const tetay = winCheck.discardedCard;
    const discardIndex = hand.findIndex(c => String(c.id) === String(tetay.id));
    if (discardIndex !== -1) {
      hand.splice(discardIndex, 1);
    }
    this.discardPile.push(tetay);

    this.status = 'FINISHED';
    this.winner = this.players.find(p => p.id === playerId) || this.creator;
    this.winReason = 'SEKA_WIN';
    this.winningMelds = winCheck.melds;
    this.winningDiscard = tetay;
    this.clearAllTimers();

    walletManager.payoutWinner(this.roomId, this.winner.id);

    this.log(`🏆 እንኳን ደስ አለህ! ${this.winner.name} በ 2 ትሪስ + 1 ኳትሪስ ሴካ ጨርሶ አሸነፈ! ፖት: ${this.pot} ETB ወሰደ!`);

    return {
      success: true,
      isWin: true,
      winner: this.winner,
      winningMelds: winCheck.melds,
      discardedCard: tetay
    };
  }

  getPublicState(forPlayerId) {
    const myHand = this.hands[forPlayerId] || [];
    const isTimeoutForfeit = this.winReason === 'TIMEOUT_FORFEIT' || this.winReason === 'ABANDON_FORFEIT';
    const opponents = this.players
      .filter(p => p.id !== forPlayerId)
      .map(p => ({
        id: p.id,
        name: p.name,
        cardCount: (this.hands[p.id] || []).length,
        hand: (this.status === 'FINISHED' && !isTimeoutForfeit) ? (this.hands[p.id] || []) : undefined
      }));

    const mainOpponent = opponents[0] || null;

    const topDiscard = this.discardPile.length > 0
      ? this.discardPile[this.discardPile.length - 1]
      : null;

    return {
      roomId: this.roomId,
      gameType: 'SEKA',
      status: this.status,
      stakeAmount: this.stakeAmount,
      pot: this.pot,
      maxPlayers: this.maxPlayers,
      playersCount: this.players.length,
      creator: { id: this.creator.id, name: this.creator.name },
      joiner: this.joiner ? { id: this.joiner.id, name: this.joiner.name } : null,
      players: this.players.map(p => ({ id: p.id, name: p.name })),
      opponents: opponents,
      opponentName: opponents.map(o => o.name).join(' & '),
      myHand: myHand,
      opponentCardCount: mainOpponent ? mainOpponent.cardCount : 0,
      opponentHand: (this.status === 'FINISHED' && !isTimeoutForfeit && mainOpponent) ? mainOpponent.hand : undefined,
      topDiscard: topDiscard,
      deckCount: this.deck.length,
      remainingDeckCards: (this.status === 'FINISHED') ? [...this.deck] : undefined,
      currentTurnPlayerId: this.currentTurnPlayerId,
      turnState: this.turnState,
      isMyTurn: this.currentTurnPlayerId === forPlayerId,
      winner: this.winner,
      winReason: this.winReason,
      winningMelds: this.winningMelds,
      winningDiscard: this.winningDiscard,
      turnDeadline: this.turnDeadline,
      turnSecondsLeft: this.turnDeadline ? Math.max(0, Math.round((this.turnDeadline - Date.now()) / 1000)) : 60,
      temporarilyLeft: this.temporarilyLeft || {},
      forfeitedPlayer: this.forfeitedPlayer ? { id: this.forfeitedPlayer.id, name: this.forfeitedPlayer.name } : null,
      logs: this.logs.slice(0, 10)
    };
  }
}

/**
 * Intelligent AI Bot for Seka
 */
class SekaBotPlayer {
  constructor(room, botId, botName = 'ሴካ ቦት (AI)') {
    this.room = room;
    this.botId = botId;
    this.botName = botName;
  }

  takeTurn(io = null, callback = null) {
    if (this.room.status !== 'PLAYING') return;
    if (this.room.currentTurnPlayerId !== this.botId) return;

    if (this.room.turnState === 'AWAITING_DRAW') {
      setTimeout(() => {
        if (this.room.status !== 'PLAYING') return;
        if (this.room.currentTurnPlayerId !== this.botId) return;
        if (this.room.turnState !== 'AWAITING_DRAW') return;

        const topDiscard = this.room.discardPile.length > 0
          ? this.room.discardPile[this.room.discardPile.length - 1]
          : null;

        let drawFrom = 'deck';

        // Check if top ground card is beneficial
        if (topDiscard) {
          const currentHand = this.room.getHand(this.botId) || [];
          const testWin = validateSekaWinningHand([...currentHand, topDiscard]);
          if (testWin.valid) {
            drawFrom = 'ground';
          } else {
            const sameSuit = currentHand.filter(c => c.suit === topDiscard.suit);
            if (sameSuit.length >= 2) {
              const topRankNum = RANK_ORDER[topDiscard.rank] || 0;
              const hasAdjacent = sameSuit.some(c => {
                const rNum = RANK_ORDER[c.rank] || 0;
                return Math.abs(rNum - topRankNum) === 1 || Math.abs(rNum - topRankNum) === 2;
              });
              if (hasAdjacent) drawFrom = 'ground';
            }
          }
        }

        this.room.drawCard(this.botId, drawFrom);
        if (callback) callback();

        // 2. AWAITING_DISCARD after 1 second delay
        setTimeout(() => {
          this.executeBotDiscard(callback);
        }, 1000);

      }, 800);
    } else if (this.room.turnState === 'AWAITING_DISCARD') {
      setTimeout(() => {
        this.executeBotDiscard(callback);
      }, 1000);
    }
  }

  executeBotDiscard(callback = null) {
    if (this.room.status !== 'PLAYING') return;
    if (this.room.currentTurnPlayerId !== this.botId) return;
    if (this.room.turnState !== 'AWAITING_DISCARD') return;

    const hand = this.room.getHand(this.botId) || [];

    // Check if Bot has winning hand
    const winCheck = validateSekaWinningHand(hand);
    if (winCheck.valid) {
      this.room.claimWin(this.botId, winCheck.discardedCard.id);
      if (callback) callback();
      return;
    }

    // Otherwise pick the least useful card to discard
    const cardToDiscard = this.chooseDiscard(hand);
    this.room.discardCard(this.botId, cardToDiscard.id);
    if (callback) callback();
  }

  chooseDiscard(hand) {
    // Never discard a wild joker
    const nonJokers = hand.filter(c => !isSekaJoker(c));
    if (nonJokers.length === 0) return hand[0];

    // Score cards by proximity to other cards of same suit
    let worstCard = nonJokers[0];
    let minScore = Infinity;

    for (const card of nonJokers) {
      let score = 0;
      const sameSuit = hand.filter(c => c.suit === card.suit && c.id !== card.id);
      const cardRankNum = RANK_ORDER[card.rank] || 0;

      for (const other of sameSuit) {
        const otherRankNum = RANK_ORDER[other.rank] || 0;
        const diff = Math.abs(cardRankNum - otherRankNum);
        if (diff === 1) score += 10;
        else if (diff === 2) score += 5;
        else if (diff === 3) score += 2;
      }

      if (score < minScore) {
        minScore = score;
        worstCard = card;
      }
    }

    return worstCard;
  }
}

module.exports = {
  SekaGameRoom,
  SekaBotPlayer
};
