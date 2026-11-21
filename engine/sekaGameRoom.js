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
  constructor(roomId, creator, stakeAmount = 100) {
    this.roomId = roomId;
    this.creator = creator; // { id, name, socketId, isBot }
    this.joiner = null;     // { id, name, socketId, isBot }
    this.stakeAmount = stakeAmount;
    this.pot = 0;
    this.status = 'WAITING'; // WAITING, PLAYING, FINISHED
    this.gameType = 'SEKA';

    this.deck = [];
    this.discardPile = [];

    this.creatorHand = [];
    this.joinerHand = [];

    this.currentTurnPlayerId = null;
    this.turnState = null; // 'AWAITING_DRAW', 'AWAITING_DISCARD'

    this.winner = null;
    this.winReason = null;
    this.winningMelds = null;
    this.logs = [];
  }

  log(message) {
    const time = new Date().toLocaleTimeString();
    this.logs.unshift(`[${time}] ${message}`);
    if (this.logs.length > 50) this.logs.pop();
  }

  join(player) {
    if (this.joiner) return { success: false, message: 'Room already full' };
    this.joiner = player;

    // Lock bets into Escrow
    const escrowResult = walletManager.lockEscrow(this.roomId, this.creator.id, this.joiner.id, this.stakeAmount);
    if (!escrowResult.success) {
      this.joiner = null;
      return { success: false, message: escrowResult.message };
    }
    this.pot = escrowResult.pot;

    // Start Seka Game immediately (no cutting joker in Seka)
    this.startGame();
    return { success: true };
  }

  startGame() {
    this.deck = shuffleDeck(createSekaDeck());
    this.discardPile = [];
    this.creatorHand = [];
    this.joinerHand = [];

    // Deal: 11 cards to Creator (Starter / አጫዋች), 10 cards to Joiner
    for (let i = 0; i < 10; i++) {
      this.creatorHand.push(this.deck.pop());
      this.joinerHand.push(this.deck.pop());
    }
    // Creator gets 11th card
    this.creatorHand.push(this.deck.pop());

    this.status = 'PLAYING';
    // Creator starts in AWAITING_DISCARD because they already have 11 cards
    this.currentTurnPlayerId = this.creator.id;
    this.turnState = 'AWAITING_DISCARD';

    this.log(`🎮 ሴካ ጨዋታ ተጀመረ! ፖት: ${this.pot} ETB።`);
    this.log(`🃏 አጫዋች ${this.creator.name} 11 ካርታ ተሰጥቶታል፤ 1 ካርታ ወደ መሬት በመጣል ጨዋታውን ይጀምራል!`);
    this.log(`🃏 ${this.joiner.name} 10 ካርታ ተሰጥቶታል።`);
  }

  getHand(playerId) {
    if (playerId === this.creator.id) return this.creatorHand;
    if (this.joiner && playerId === this.joiner.id) return this.joinerHand;
    return null;
  }

  setHand(playerId, newHand) {
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
    const playerName = playerId === this.creator.id ? this.creator.name : this.joiner.name;
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

    // Check if player claims or forms a winning hand
    const remainingHand = hand.filter((_, idx) => idx !== cardIndex);
    const winCheck = validateSekaWinningHand(hand, cardToDiscard);

    if (winCheck.valid && melds) {
      // Confirmed Win!
      hand.splice(cardIndex, 1);
      this.discardPile.push(cardToDiscard);

      this.status = 'FINISHED';
      this.winner = playerId === this.creator.id ? this.creator : this.joiner;
      this.winReason = 'SEKA_WIN';
      this.winningMelds = winCheck.melds;
      this.winningDiscard = cardToDiscard;

      walletManager.payoutWinner(this.roomId, this.winner.id);

      this.log(`🏆 እንኳን ደስ አለህ! ${this.winner.name} በ 2 ትሪስ + 1 ኳትሪስ ሴካ ጨርሶ አሸነፈ! ፖት: ${this.pot} ETB ወሰደ!`);

      return {
        success: true,
        isWin: true,
        winner: this.winner,
        winningMelds: winCheck.melds,
        discardedCard: cardToDiscard
      };
    }

    // Normal Discard (passes turn)
    hand.splice(cardIndex, 1);
    this.discardPile.push(cardToDiscard);

    const playerName = playerId === this.creator.id ? this.creator.name : this.joiner.name;
    this.log(`📤 ${playerName} [ ${cardToDiscard.suit} ${cardToDiscard.rank} ] ወደ መሬት ጣለ።`);

    // Switch Turn
    this.currentTurnPlayerId = (playerId === this.creator.id) ? this.joiner.id : this.creator.id;
    this.turnState = 'AWAITING_DRAW';

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
      if (!discardCard) {
        return { success: false, message: 'የተመረጠው ተጣይ ካርታ እጅህ ላይ የለም!' };
      }
    }

    const winCheck = validateSekaWinningHand(hand, discardCard);
    if (!winCheck.valid) {
      return {
        success: false,
        message: 'ካርታዎችህ 2 ትሪስ (ጦር) እና 1 ኳትሪስ (ጦር) አላሟሉም!'
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
    this.winner = playerId === this.creator.id ? this.creator : this.joiner;
    this.winReason = 'SEKA_WIN';
    this.winningMelds = winCheck.melds;
    this.winningDiscard = tetay;

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
    const isCreator = forPlayerId === this.creator.id;
    const myHand = isCreator ? this.creatorHand : (this.joinerHand || []);
    const oppHand = isCreator ? (this.joinerHand || []) : this.creatorHand;

    const topDiscard = this.discardPile.length > 0
      ? this.discardPile[this.discardPile.length - 1]
      : null;

    return {
      roomId: this.roomId,
      gameType: 'SEKA',
      status: this.status,
      stakeAmount: this.stakeAmount,
      pot: this.pot,
      creator: { id: this.creator.id, name: this.creator.name },
      joiner: this.joiner ? { id: this.joiner.id, name: this.joiner.name } : null,
      myHand: myHand,
      opponentCardCount: oppHand.length,
      opponentHand: this.status === 'FINISHED' ? oppHand : undefined,
      topDiscard: topDiscard,
      deckCount: this.deck.length,
      currentTurnPlayerId: this.currentTurnPlayerId,
      turnState: this.turnState,
      isMyTurn: this.currentTurnPlayerId === forPlayerId,
      winner: this.winner,
      winReason: this.winReason,
      winningMelds: this.winningMelds,
      winningDiscard: this.winningDiscard,
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

    // Small delay to simulate human play
    setTimeout(() => {
      if (this.room.status !== 'PLAYING') return;

      // 1. AWAITING_DRAW
      if (this.room.turnState === 'AWAITING_DRAW') {
        const topDiscard = this.room.discardPile.length > 0
          ? this.room.discardPile[this.room.discardPile.length - 1]
          : null;

        let drawFrom = 'deck';

        // Check if top ground card is beneficial
        if (topDiscard) {
          const currentHand = this.room.getHand(this.botId);
          // Test if drawing top ground card creates an immediate win
          const testWin = validateSekaWinningHand([...currentHand, topDiscard]);
          if (testWin.valid) {
            drawFrom = 'ground';
          } else {
            // Check if top discard has matching suit with hand
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
        if (io) callback && callback();
      }

      // 2. AWAITING_DISCARD
      setTimeout(() => {
        if (this.room.status !== 'PLAYING') return;
        if (this.room.currentTurnPlayerId !== this.botId) return;
        if (this.room.turnState !== 'AWAITING_DISCARD') return;

        const hand = this.room.getHand(this.botId);

        // Check if Bot has winning hand
        const winCheck = validateSekaWinningHand(hand);
        if (winCheck.valid) {
          this.room.claimWin(this.botId, winCheck.discardedCard.id);
          if (io) callback && callback();
          return;
        }

        // Otherwise pick the least useful card to discard
        const cardToDiscard = this.chooseDiscard(hand);
        this.room.discardCard(this.botId, cardToDiscard.id);
        if (io) callback && callback();
      }, 1000);

    }, 800);
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
