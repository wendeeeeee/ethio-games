// engine/gameRoom.js
const { createConquerDeck, shuffleDeck, getNextRank, getPrevRank } = require('./cardTypes');
const {
  calculateHandPoints,
  canDrawFromGround,
  validateConquerHand,
  findHandTris,
  isValidTris,
  isValidQuatris,
  isCardGebiToTable,
  isCardGebiToMeld
} = require('./conquerRules');
const walletManager = require('./walletManager');

class GameRoom {
  constructor(roomId, creator, stakeAmount = 100) {
    this.roomId = roomId;
    this.creator = creator; // { id, name, socketId }
    this.joiner = null;     // { id, name, socketId }
    this.stakeAmount = stakeAmount;
    this.pot = 0;
    this.status = 'WAITING'; // WAITING, CUTTING_JOKER, PLAYING, FINISHED

    this.deck = [];
    this.discardPile = [];
    this.jokerCard = null;
    this.jokerRank = null;

    this.creatorHand = [];
    this.joinerHand = [];

    // Table melds laid down by players: { creator: [groups], joiner: [groups] }
    this.tableMelds = {
      [creator.id]: [],
      joiner: []
    };

    this.currentTurnPlayerId = null;
    this.turnState = null; // 'AWAITING_DRAW', 'AWAITING_DISCARD'
    this.isFirstDiscard = true; // Rule 1: Starter's first discard protected
    this.mustMeld41PlayerId = null; // Player who picked from ground and must meld 41

    this.pokeState = {
      active: false,
      pokedBy: null,
      targetPlayerId: null,
      secondsLeft: 30,
      intervalId: null
    };

    this.winner = null;
    this.winReason = null;
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
    this.clearTurnTimer();
    if (this.leaveTimeouts) {
      for (const uid in this.leaveTimeouts) {
        clearTimeout(this.leaveTimeouts[uid]);
      }
      this.leaveTimeouts = {};
    }
  }

  clearTurnTimer() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }

  playerLeaveTemp(userId, onTimeout) {
    if (this.status !== 'PLAYING') return;
    const isCreator = this.creator && this.creator.id === userId;
    const isJoiner = this.joiner && this.joiner.id === userId;
    if (!isCreator && !isJoiner) return;

    const leftPlayer = isCreator ? this.creator : this.joiner;
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
        const opponent = this.getOpponent(userId);
        if (!opponent) return;

        this.status = 'FINISHED';
        this.winner = opponent.id;
        this.winReason = 'ABANDON_FORFEIT';
        this.forfeitedPlayer = leftPlayer;

        walletManager.payoutWinner(this.roomId, opponent.id);
        this.log(`🏆 ❌ ${leftPlayer.name} በ1 ደቂቃ ውስጥ ስላልተመለሰ ተሸንፏል! ${opponent.name} አሸናፊ ሆኗል!`);

        delete this.temporarilyLeft[userId];
        delete this.leaveTimeouts[userId];

        this.resetPoke();
        this.clearAllTimers();

        if (cb) cb(this, opponent, leftPlayer);
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
      this.log(`👋 ${this.getPlayerName(userId)} ወደ ጨዋታው ተመልሷል!`);
    }
  }

  resetTurnTimer(onTimeout) {
    this.clearTurnTimer();
    if (this.status !== 'PLAYING') return;

    this.turnDeadline = Date.now() + this.turnDuration;
    if (!this.currentTurnPlayerId || String(this.currentTurnPlayerId).startsWith('bot_')) {
      return;
    }

    const cb = onTimeout || this.onTurnTimeoutCallback;
    this.turnTimer = setTimeout(() => {
      if (this.status === 'PLAYING') {
        this.handleTurnTimeout(cb);
      }
    }, this.turnDuration);
  }

  handleTurnTimeout(onTimeout) {
    if (this.status !== 'PLAYING') return;
    const timedOutId = this.currentTurnPlayerId;
    const timedOutName = this.getPlayerName(timedOutId);
    const opponent = this.getOpponent(timedOutId);
    if (!opponent) return;

    this.status = 'FINISHED';
    this.winner = opponent.id;
    this.winReason = 'TIMEOUT_FORFEIT';
    this.log(`🏆 ⏰ ${timedOutName} በ1 ደቂቃ ውስጥ ካርታ ስላልጣለ ተሸንፏል! ${opponent.name} አሸናፊ ሆኗል!`);

    walletManager.payoutWinner(this.roomId, opponent.id);
    this.resetPoke();
    this.clearTurnTimer();

    if (onTimeout) {
      onTimeout(this, opponent, { id: timedOutId, name: timedOutName });
    }
  }

  log(message) {
    const time = new Date().toLocaleTimeString();
    this.logs.unshift(`[${time}] ${message}`);
    if (this.logs.length > 50) this.logs.pop();
  }

  join(player) {
    if (this.joiner) return { success: false, message: 'Room already full' };
    this.joiner = player;
    this.tableMelds[player.id] = [];

    // Lock bets into Escrow
    const escrowResult = walletManager.lockEscrow(this.roomId, this.creator.id, this.joiner.id, this.stakeAmount);
    if (!escrowResult.success) {
      this.joiner = null;
      return { success: false, message: escrowResult.message };
    }
    this.pot = escrowResult.pot;

    // 54-Card 2-Deck Setup (cards will be dealt after Joiner calls Joker!)
    this.deck = shuffleDeck(createConquerDeck(2));
    this.creatorHand = [];
    this.joinerHand = [];
    this.baseCard = null;
    this.jokerCard = null;

    // Transition to CUTTING_JOKER (Joiner chooses blindly BEFORE cards are dealt!)
    this.status = 'CUTTING_JOKER';
    this.log(`${player.name} joined the table. Pot is ${this.pot} ETB.`);
    this.log(`🎲 ${player.name} ካርታ ከመታደሉ በፊት በጭፍን ጆከር ይሰይማል (ከፍ፣ ዝቅ፣ አንድ ላይ፣ ወይም ጎን)።`);

    return { success: true };
  }

  // Joiner chooses blindly BEFORE cards are dealt: "ከፍ" (High), "ዝቅ" (Low), "አንድ ላይ" (Same), or "ጎን" (Opposite Color)
  setJokerHighLow(playerId, choice = 'high') {
    if (this.status !== 'CUTTING_JOKER') {
      return { success: false, message: 'Not in cutting phase' };
    }
    if (this.joiner.id !== playerId) {
      return { success: false, message: 'Only the Joiner can call the Joker!' };
    }

    // 1. Deal 27 cards (14 to Creator, 13 to Joiner)
    this.creatorHand = [];
    this.joinerHand = [];

    for (let i = 0; i < 13; i++) {
      this.creatorHand.push(this.deck.pop());
      this.joinerHand.push(this.deck.pop());
    }
    // Creator gets 14th card
    this.creatorHand.push(this.deck.pop());

    // 2. Reveal the 28th card as the Base Card!
    this.baseCard = this.deck.pop();
    this.baseCard.isBase = true;
    this.jokerCard = this.baseCard;

    // 3. Determine target rank and suits based on Joiner's blind call:
    // - 'high' (ከፍ): next rank, same color
    // - 'low' or 'tach' (ዝቅ / ታች): previous rank, same color
    // - 'same' or 'and_lay' (አንድ ላይ): same rank, same color
    // - 'gon' or 'opposite' (ጎን): same rank, OPPOSITE color (black <-> red)
    let targetRank = this.baseCard.rank;
    let targetSuits = [];
    let choiceName = '';

    const sameColorSuits = this.baseCard.color === 'black' ? ['♣', '♠'] : ['♥', '♦'];
    const oppColorSuits = this.baseCard.color === 'black' ? ['♥', '♦'] : ['♣', '♠'];

    if (choice === 'high') {
      targetRank = getNextRank(this.baseCard.rank);
      targetSuits = sameColorSuits;
      choiceName = 'ከፍ (High)';
    } else if (choice === 'low' || choice === 'tach') {
      targetRank = getPrevRank(this.baseCard.rank);
      targetSuits = sameColorSuits;
      choiceName = 'ዝቅ / ታች (Low)';
    } else if (choice === 'same' || choice === 'and_lay') {
      targetRank = this.baseCard.rank;
      targetSuits = sameColorSuits;
      choiceName = 'አንድ ላይ (Same)';
    } else if (choice === 'gon' || choice === 'opposite') {
      targetRank = this.baseCard.rank;
      targetSuits = oppColorSuits;
      choiceName = 'ጎን (Opposite Color)';
    } else {
      targetRank = getNextRank(this.baseCard.rank);
      targetSuits = sameColorSuits;
      choiceName = 'ከፍ (High)';
    }

    this.jokerRank = targetRank;
    this.jokerSuits = targetSuits;
    this.jokerChoice = choice;

    // Apply Joker status to hands and deck
    this.applyJokerStatus();

    // Ground starts empty; Starter discards first card
    this.discardPile = [];
    this.isFirstDiscard = true;
    this.discardsCount = 0;

    // Creator starts in AWAITING_DISCARD
    this.currentTurnPlayerId = this.creator.id;
    this.turnState = 'AWAITING_DISCARD';
    this.status = 'PLAYING';
    this.resetTurnTimer();

    const colorDesc = targetSuits.includes('♥') ? 'ቀይ (Red)' : 'ጥቁር (Black)';
    this.log(`🃏 27 ካርታዎች ተከፋፈሉ (14 ለ${this.creator.name}፣ 13 ለ${this.joiner.name})።`);
    this.log(`⭐ 28ኛዋ መቁረጫ ካርታ ተገለጸች፦ ${this.baseCard.rank}${this.baseCard.suit}!`);
    this.log(`🎯 ${this.joiner.name} በጭፍን የመረጠው፦ "${choiceName}"!`);
    this.log(`👑 ዋና ጆከሮች፦ ${targetRank}${targetSuits[0]} እና ${targetRank}${targetSuits[1]} (${colorDesc})! 2ቱ ፕሪንትድ ጆከሮች ደግሞ ፎልስ ጆከር (False Joker) ናቸው!`);
    this.log(`👉 ${this.creator.name} 14 ካርታ ስላለው የመጀመሪያውን ካርታ በመጣል ጨዋታውን ይጀምራል!`);

    return { success: true, jokerRank: this.jokerRank, jokerSuits: this.jokerSuits };
  }

  // Backward compatibility alias for single-click cut
  cutJoker(playerId) {
    return this.setJokerHighLow(playerId, 'high');
  }

  applyJokerStatus() {
    const mark = (card) => {
      // 1. Designated main jokers: Same rank AND same color group (e.g. 6♣ and 6♠)
      if (card.rank === this.jokerRank && this.jokerSuits && this.jokerSuits.includes(card.suit)) {
        card.isJoker = true;
        card.isMainJoker = true;
      } else {
        card.isJoker = false;
        card.isMainJoker = false;
      }
      // 2. The printed False Jokers are NOT wild jokers! They only substitute for the designated cut rank:
      if (card.isFalseJoker) {
        card.isJoker = false;
        card.isMainJoker = false;
        card.effectiveRank = this.jokerRank;
      }
    };
    this.creatorHand.forEach(mark);
    this.joinerHand.forEach(mark);
    this.deck.forEach(mark);
    this.discardPile.forEach(mark);
  }

  getHand(playerId) {
    return playerId === this.creator.id ? this.creatorHand : this.joinerHand;
  }

  getOpponent(playerId) {
    return playerId === this.creator.id ? this.joiner : this.creator;
  }

  // Draw card: source = 'deck' | 'ground'
  drawCard(playerId, source) {
    if (this.status !== 'PLAYING') return { success: false, message: 'Game not in progress' };
    if (this.currentTurnPlayerId !== playerId) return { success: false, message: 'Not your turn' };
    if (this.turnState !== 'AWAITING_DRAW') return { success: false, message: 'Already drew a card' };

    const hand = this.getHand(playerId);
    let drawnCard = null;

    if (source === 'deck') {
      this.checkAndReshuffleIfNeeded();
      drawnCard = this.deck.pop();
      hand.push(drawnCard);
      this.turnState = 'AWAITING_DISCARD';
      this.resetPoke();
      this.resetTurnTimer();
      this.log(`${this.getPlayerName(playerId)} drew a card from the deck.`);
      return { success: true, card: drawnCard, from: 'deck' };
    }

    if (source === 'ground') {
      if (this.isFirstDiscard) return { success: false, message: 'የመጀመሪያው ካርታ አይነሳም!' };
      if (this.discardPile.length === 0) return { success: false, message: 'Ground is empty' };

      const hasAlreadyOpened = this.tableMelds[playerId] && this.tableMelds[playerId].length > 0;
      const topCard = this.discardPile[this.discardPile.length - 1];
      const isFreeJoker = topCard.isJoker || topCard.rank === this.jokerRank;

      drawnCard = this.discardPile.pop();
      hand.push(drawnCard);
      this.turnState = 'AWAITING_DISCARD';
      this.resetPoke();

      // Player must meld 41 ONLY if they haven't already opened on table AND it wasn't a free Joker!
      if (!hasAlreadyOpened && !isFreeJoker) {
        this.mustMeld41PlayerId = playerId;
      } else {
        this.mustMeld41PlayerId = null;
      }

      this.log(`${this.getPlayerName(playerId)} picked ${drawnCard.rank}${drawnCard.suit} from the ground.`);
      this.resetTurnTimer();
      return { success: true, card: drawnCard, from: 'ground' };
    }

    if (source === 'base') {
      if (!this.baseCard) return { success: false, message: 'የተገለበጠው ካርታ ቀድሞ ተነስቷል!' };
      const hasAlreadyOpened = this.tableMelds[playerId] && this.tableMelds[playerId].length > 0;
      if (hasAlreadyOpened) {
        return { success: false, message: 'ቀድመህ ስለወረድክ የተገለበጠውን ካርታ መሳብ አትችልም!' };
      }

      drawnCard = this.baseCard;
      this.baseCard = null;
      hand.push(drawnCard);
      this.turnState = 'AWAITING_DISCARD';
      this.mustMeld41PlayerId = playerId; // Must close & win Conquer!
      this.resetPoke();
      this.resetTurnTimer();

      this.log(`⭐ ${this.getPlayerName(playerId)} የተገለበጠውን ካርታ (${drawnCard.rank}${drawnCard.suit}) ለመዝጋት ሳበ!`);
      return { success: true, card: drawnCard, from: 'base' };
    }

    return { success: false, message: 'Invalid draw source' };
  }

  // Discard card: toGebi = boolean
  discardCard(playerId, cardId, toGebi = false, melds = null) {
    if (this.status !== 'PLAYING') return { success: false, message: 'Game not in progress' };
    if (this.currentTurnPlayerId !== playerId) return { success: false, message: 'Not your turn' };
    if (this.turnState !== 'AWAITING_DISCARD') return { success: false, message: 'You must draw first' };

    const hand = this.getHand(playerId);
    const cardIndex = hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return { success: false, message: 'Card not in your hand' };

    const [discardedCard] = hand.splice(cardIndex, 1);

    // Conquer Win Condition: All 13 cards melded onto table (via ወረድ + ገቢ) and final 14th card discarded -> WIN!
    if (hand.length === 0) {
      this.mustMeld41PlayerId = null;
      this.discardPile.push(discardedCard);
      this.status = 'FINISHED';
      this.winner = playerId;
      this.winReason = `👑 ኮንከር! ${this.getPlayerName(playerId)} 13ቱንም ካርታ አውርዶ መጨረሻ ላይ ${discardedCard.rank}${discardedCard.suit} በመጣል አሸነፈ!`;
      this.log(`🏆 ${this.winReason}`);

      const payout = walletManager.payoutWinner(this.roomId, playerId);
      this.resetPoke();
      this.clearTurnTimer();
      return { success: true, isWin: true, winner: playerId, payout };
    }

    // Finishing Conquer directly from hand (Rule 5 & 12) — allowed even without 41 on table!
    if (toGebi) {
      const winValidation = validateConquerHand(melds, discardedCard, this.jokerRank, this.jokerCard, this.jokerSuits);
      if (!winValidation.valid) {
        hand.splice(cardIndex, 0, discardedCard);
        if (this.mustMeld41PlayerId === playerId) {
          const forfeitRes = this.forfeitFromFailedGround(playerId);
          return { success: true, isForfeit: true, ...forfeitRes };
        }
        return { success: false, message: `Cannot Conquer: ${winValidation.message}` };
      }

      this.mustMeld41PlayerId = null;
      this.status = 'FINISHED';
      this.winner = playerId;
      this.winReason = `CONQUER! ${this.getPlayerName(playerId)} discarded ${discardedCard.rank}${discardedCard.suit} and won!`;
      this.log(`🏆 ${this.winReason}`);

      const payout = walletManager.payoutWinner(this.roomId, playerId);
      this.resetPoke();
      this.clearTurnTimer();
      return { success: true, isWin: true, winner: playerId, payout };
    }

    // Player picked from ground without having opened: MUST close & win! Otherwise immediate forfeit!
    if (this.mustMeld41PlayerId === playerId) {
      hand.splice(cardIndex, 0, discardedCard);
      const forfeitRes = this.forfeitFromFailedGround(playerId);
      return { success: true, isForfeit: true, ...forfeitRes };
    }

    // Rule: GEBI (ገቢ) Restriction on Discarding
    // A player CANNOT discard a card to ground if it can be GEBI into any open table meld!
    if (isCardGebiToTable(discardedCard, this.tableMelds, this.jokerRank, this.jokerSuits)) {
      hand.splice(cardIndex, 0, discardedCard); // restore card
      return {
        success: false,
        isGebi: true,
        message: `⚠️ [ ${discardedCard.rank}${discardedCard.suit} ] ወደ ጠረጴዛው ሜልድ ገቢ (GEBI) ስለሚሆን ወደ መሬት መጣል አትችልም! ሌላ ካርታ ምረጥ።`
      };
    }

    // Normal discard to Ground
    this.discardPile.push(discardedCard);
    this.discardsCount = (this.discardsCount || 0) + 1;
    this.log(`${this.getPlayerName(playerId)} discarded ${discardedCard.rank}${discardedCard.suit} to the ground.`);

    // First discard by the starter CANNOT be picked up
    if (this.discardsCount <= 1) {
      this.isFirstDiscard = true;
    } else {
      this.isFirstDiscard = false;
    }

    // Pass turn to opponent
    this.currentTurnPlayerId = this.getOpponent(playerId).id;
    this.turnState = 'AWAITING_DRAW';
    this.resetPoke();
    this.resetTurnTimer();

    return { success: true, isWin: false, nextTurnPlayerId: this.currentTurnPlayerId };
  }

  // Draw from ground with 41-point table melds
  drawCardFromGroundWithMelds(playerId, meldsToLayDown) {
    if (this.status !== 'PLAYING') return { success: false, message: 'Game not in progress' };
    if (this.currentTurnPlayerId !== playerId) return { success: false, message: 'Not your turn' };
    if (this.turnState !== 'AWAITING_DRAW') return { success: false, message: 'Already drew card' };

    if (this.isFirstDiscard) {
      return { success: false, message: 'የመጀመሪያው ካርታ አይነሳም!' };
    }

    if (this.discardPile.length === 0) return { success: false, message: 'Ground is empty' };
    const groundCard = this.discardPile[this.discardPile.length - 1];

    let meldPoints = 0;
    const hand = this.getHand(playerId);

    if (meldsToLayDown && meldsToLayDown.length > 0) {
      for (const group of meldsToLayDown) {
        for (const c of group) {
          meldPoints += c.pointValue || 0;
        }
      }
    }

    // If cards laid down are less than 41 -> IMMEDIATE FORFEIT! Player touched ground without 41!
    if (!meldsToLayDown || meldsToLayDown.length === 0 || meldPoints < 41) {
      return this.forfeitFromFailedGround(playerId);
    }

    // 41 Reached! Lay down the cards from hand onto table
    for (const group of meldsToLayDown) {
      for (const card of group) {
        const idx = hand.findIndex(c => c.id === card.id);
        if (idx !== -1) hand.splice(idx, 1);
      }
      this.tableMelds[playerId].push(group);
    }

    // Pick ground card into hand
    const drawnCard = this.discardPile.pop();
    hand.push(drawnCard);
    this.turnState = 'AWAITING_DISCARD';
    this.resetPoke();
    this.resetTurnTimer();

    this.log(`✅ ${this.getPlayerName(playerId)} melded ${meldPoints} points on the table and picked ${drawnCard.rank}${drawnCard.suit} from the ground!`);
    return { success: true, card: drawnCard, meldPoints };
  }

  // Lay down melds onto the table ("ውረድ") without drawing from ground
  layDownMelds(playerId, meldsToLayDown) {
    if (this.status !== 'PLAYING') return { success: false, message: 'Game not in progress' };
    if (this.currentTurnPlayerId !== playerId) return { success: false, message: 'Not your turn' };
    if (!meldsToLayDown || meldsToLayDown.length === 0) return { success: false, message: 'No melds provided' };

    const hand = this.getHand(playerId);
    const hasAlreadyOpened = this.tableMelds[playerId] && this.tableMelds[playerId].length > 0;

    let meldPoints = 0;
    for (const group of meldsToLayDown) {
      if (!isValidTris(group, this.jokerRank, this.jokerSuits) && !isValidQuatris(group, this.jokerRank, this.jokerSuits)) {
        if (this.mustMeld41PlayerId === playerId) {
          const forfeitRes = this.forfeitFromFailedGround(playerId);
          return { success: true, isForfeit: true, ...forfeitRes };
        }
        return { success: false, message: 'ያልተሟላ ወይም የተሳሳተ ትሪስ/ሜልድ ነው!' };
      }
      for (const c of group) {
        meldPoints += c.pointValue || 0;
      }
    }

    // Verify all cards exist in player hand
    for (const group of meldsToLayDown) {
      for (const card of group) {
        const idx = hand.findIndex(c => String(c.id) === String(card.id));
        if (idx === -1) return { success: false, message: `Card ${card.rank}${card.suit} not in hand` };
      }
    }

    // If player picked from ground without having opened, they MUST close (leave <= 1 card to discard & win)!
    if (this.mustMeld41PlayerId === playerId) {
      const meldedCount = meldsToLayDown.reduce((sum, g) => sum + g.length, 0);
      if (hand.length - meldedCount > 1) {
        const forfeitRes = this.forfeitFromFailedGround(playerId);
        return { success: true, isForfeit: true, ...forfeitRes };
      }
    }

    // Remove from hand and add to player's table melds
    for (const group of meldsToLayDown) {
      for (const card of group) {
        const idx = hand.findIndex(c => String(c.id) === String(card.id));
        if (idx !== -1) hand.splice(idx, 1);
      }
      if (!this.tableMelds[playerId]) this.tableMelds[playerId] = [];
      this.tableMelds[playerId].push(group);
    }

    // Clear ground-draw lock once player has laid down all 13 cards (1 card left to discard & win)
    if (this.mustMeld41PlayerId === playerId && hand.length <= 1) {
      this.mustMeld41PlayerId = null;
    }

    this.log(`📥 ${this.getPlayerName(playerId)} ወረደ (ወደ ጠረጴዛ አወረደ): ${meldPoints} ነጥብ!`);
    return { success: true, meldPoints, melds: meldsToLayDown };
  }

  // Penalty: Player touched ground but cannot reach 41 -> IMMEDIATE FORFEIT!
  forfeitFromFailedGround(playerId) {
    if (this.status !== 'PLAYING') return;
    const opponent = this.getOpponent(playerId);
    this.status = 'FINISHED';
    this.winner = opponent.id;
    this.winReason = `❌ ${this.getPlayerName(playerId)} 41 ሳይሞላ ከመሬት ስላነሳ ተሸንፏል! ${opponent.name} አሸናፊ ሆኗል!`;
    this.log(`🏆 ${this.winReason}`);

    const payout = walletManager.payoutWinner(this.roomId, opponent.id);
    this.resetPoke();
    this.clearTurnTimer();
    return { winner: opponent.id, winReason: this.winReason, payout };
  }

  // Rule 7: Reshuffle when deck empties (No Draw/Tie)
  checkAndReshuffleIfNeeded() {
    if (this.deck.length === 0) {
      if (this.discardPile.length <= 1) return;
      const topGround = this.discardPile.pop();
      this.deck = shuffleDeck(this.discardPile);
      this.discardPile = [topGround];
      this.log('🔄 Rule 7: Stock deck ran out! Reshuffled the ground cards to continue the game.');
    }
  }

  // Rule 8: Poke & 30-Second Forfeit
  triggerPoke(pokerId, onTimeoutCallback) {
    if (this.status !== 'PLAYING') return { success: false, message: 'Game is not active' };
    if (this.currentTurnPlayerId === pokerId) return { success: false, message: 'Cannot poke yourself!' };
    if (this.pokeState.active) return { success: false, message: 'Poke timer is already active!' };

    const target = this.getOpponent(pokerId);
    this.pokeState.active = true;
    this.pokeState.pokedBy = pokerId;
    this.pokeState.targetPlayerId = target.id;
    this.pokeState.secondsLeft = 30;

    this.log(`⚠️ ${this.getPlayerName(pokerId)} POKED ${target.name}! 30 seconds to play or forfeit!`);

    this.pokeState.intervalId = setInterval(() => {
      this.pokeState.secondsLeft--;
      if (this.pokeState.secondsLeft <= 0) {
        // Player timed out! Poker wins automatically!
        clearInterval(this.pokeState.intervalId);
        this.status = 'FINISHED';
        this.winner = pokerId;
        this.winReason = `TIMEOUT WIN! ${target.name} did not play within 30 seconds after Poke.`;
        this.log(`🏆 ${this.winReason}`);
        const payout = walletManager.payoutWinner(this.roomId, pokerId);
        this.clearTurnTimer();
        if (onTimeoutCallback) onTimeoutCallback(this.winner, this.winReason, payout);
      }
    }, 1000);

    return { success: true, secondsLeft: 30 };
  }

  resetPoke() {
    if (this.pokeState.intervalId) {
      clearInterval(this.pokeState.intervalId);
    }
    this.pokeState.active = false;
    this.pokeState.pokedBy = null;
    this.pokeState.targetPlayerId = null;
    this.pokeState.secondsLeft = 30;
    this.pokeState.intervalId = null;
  }

  // Rule 9 & 13: Joker Swap / Steal from a table meld
  swapJoker(playerId, targetPlayerMeldOwnerId, meldIndex, naturalCardId) {
    if (this.status !== 'PLAYING') return { success: false, message: 'Game not active' };
    if (this.currentTurnPlayerId !== playerId) return { success: false, message: 'Can only swap on your turn' };

    const playerHand = this.getHand(playerId);
    const naturalCardIndex = playerHand.findIndex(c => c.id === naturalCardId);
    if (naturalCardIndex === -1) return { success: false, message: 'Natural card not in hand' };
    const naturalCard = playerHand[naturalCardIndex];

    const melds = this.tableMelds[targetPlayerMeldOwnerId];
    if (!melds || !melds[meldIndex]) return { success: false, message: 'Meld not found' };

    const targetMeld = melds[meldIndex];
    const jokerIndex = targetMeld.findIndex(c => c.isJoker || c.rank === this.jokerRank);
    if (jokerIndex === -1) return { success: false, message: 'No Joker in this meld' };

    // Swap
    const stolenJoker = targetMeld[jokerIndex];
    targetMeld[jokerIndex] = naturalCard;
    playerHand.splice(naturalCardIndex, 1);
    playerHand.push(stolenJoker);

    this.log(`🔄 ${this.getPlayerName(playerId)} swapped a Joker from table meld with ${naturalCard.rank}${naturalCard.suit}!`);
    return { success: true, stolenJoker };
  }

  // Rule: Attach a card from hand to an open table meld (ገቢ ማድረግ)
  attachGebiCard(playerId, targetPlayerMeldOwnerId, meldIndex, cardId) {
    if (this.status !== 'PLAYING') return { success: false, message: 'Game not active' };
    if (this.currentTurnPlayerId !== playerId) return { success: false, message: 'Can only attach cards on your turn' };

    const playerHand = this.getHand(playerId);
    const cardIndex = playerHand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return { success: false, message: 'Card not in hand' };
    const card = playerHand[cardIndex];

    const melds = this.tableMelds[targetPlayerMeldOwnerId];
    if (!melds || !melds[meldIndex]) return { success: false, message: 'Meld not found' };
    const targetMeld = melds[meldIndex];

    if (!isCardGebiToMeld(card, targetMeld, this.jokerRank, this.jokerSuits)) {
      return { success: false, message: 'ይህ ካርታ ወደዚህ ሜልድ ገቢ (GEBI) መሆን አይችልም!' };
    }

    // Attach card to target meld
    targetMeld.push(card);
    playerHand.splice(cardIndex, 1);

    this.log(`📥 ${this.getPlayerName(playerId)} attached ${card.rank}${card.suit} to table meld (ገቢ አደረገ)!`);
    return { success: true, card, meld: targetMeld };
  }

  getPlayerName(playerId) {
    if (this.creator && this.creator.id === playerId) return this.creator.name;
    if (this.joiner && this.joiner.id === playerId) return this.joiner.name;
    return 'Player';
  }

  // Returns safe sanitized state for a specific player (anti-cheat: hide opponent's hand and deck)
  getClientState(playerId) {
    const isCreator = this.creator && this.creator.id === playerId;
    const myHand = isCreator ? this.creatorHand : this.joinerHand;
    const opponent = isCreator ? this.joiner : this.creator;
    const opponentHandCount = (isCreator ? this.joinerHand : this.creatorHand).length;

    const pointsInfo = calculateHandPoints(myHand);
    const trisList = findHandTris(myHand, this.jokerRank);
    const groundCard = this.discardPile.length > 0 ? this.discardPile[this.discardPile.length - 1] : null;

    let groundEligibility = { canDraw: false, reason: 'Wait for game start' };
    if (this.status === 'PLAYING') {
      groundEligibility = canDrawFromGround(myHand, groundCard, this.isFirstDiscard, this.jokerRank);
    }

    return {
      roomId: this.roomId,
      status: this.status,
      stakeAmount: this.stakeAmount,
      pot: this.pot,
      creator: { id: this.creator.id, name: this.creator.name },
      joiner: this.joiner ? { id: this.joiner.id, name: this.joiner.name } : null,
      baseCard: this.baseCard,
      jokerCard: this.jokerCard,
      jokerRank: this.jokerRank,
      jokerSuits: this.jokerSuits,
      jokerChoice: this.jokerChoice,
      topGroundCard: groundCard,
      groundCardCount: this.discardPile.length,
      deckCardCount: this.deck.length,
      remainingDeckCards: (this.status === 'FINISHED') ? [...this.deck] : undefined,
      isFirstDiscard: this.isFirstDiscard,
      currentTurnPlayerId: this.currentTurnPlayerId,
      turnState: this.turnState,
      turnDeadline: this.turnDeadline,
      turnSecondsLeft: this.turnDeadline ? Math.max(0, Math.round((this.turnDeadline - Date.now()) / 1000)) : 60,
      myHand: myHand,
      opponentHandCount: opponentHandCount,
      opponentHand: (this.status === 'FINISHED' && opponent) ? (isCreator ? this.joinerHand : this.creatorHand) : undefined,
      opponent: opponent ? { id: opponent.id, name: opponent.name } : null,
      tableMelds: this.tableMelds,
      points: pointsInfo.total,
      hasSpecial41: pointsInfo.hasSpecial41,
      specialReason: pointsInfo.specialReason,
      mustMeld41: this.mustMeld41PlayerId === playerId,
      trisCount: trisList.length,
      groundEligibility,
      pokeState: {
        active: this.pokeState.active,
        pokedBy: this.pokeState.pokedBy,
        secondsLeft: this.pokeState.secondsLeft
      },
      winner: this.winner,
      winReason: this.winReason,
      logs: this.logs
    };
  }
}

module.exports = GameRoom;

