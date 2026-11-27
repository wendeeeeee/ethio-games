// engine/gameRoom.js
const { createConquerDeck, shuffleDeck, getNextRank, getPrevRank, getCardPointValue } = require('./cardTypes');
const {
  calculateHandPoints,
  canDrawFromGround,
  validateConquerHand,
  findHandTris,
  isValidTris,
  isValidQuatris,
  isValidConquerMeld,
  isCardGebiToTable,
  isCardGebiToMeld,
  getJokerReplacementOptions,
  sortMeldCards,
  isValidDubePair,
  findDubeWin,
  getMeldPoints
} = require('./conquerRules');
const walletManager = require('./walletManager');

class GameRoom {
  constructor(roomId, creator, stakeAmount = 100, maxPlayers = 2, options = {}) {
    this.roomId = roomId;
    this.creator = creator; // { id, name, socketId }
    this.joiner = null;     // { id, name, socketId } (2nd player, calls Joker)
    this.maxPlayers = Math.min(4, Math.max(2, Number(maxPlayers) || 2));
    this.jokerDouble = !!(options && options.jokerDouble);
    this.dubeDouble = !!(options && options.dubeDouble);
    this.doubleEnabled = this.jokerDouble || this.dubeDouble;
    this.doubleWin = false;
    this.players = [creator];
    this.eliminatedPlayers = new Set();
    this.stakeAmount = stakeAmount;
    this.pot = 0;
    this.status = 'WAITING'; // WAITING, CUTTING_JOKER, PLAYING, FINISHED

    this.deck = [];
    this.discardPile = [];
    this.reshuffleCount = 0;
    this.jokerCard = null;
    this.jokerRank = null;

    this.hands = {
      [creator.id]: []
    };
    this.creatorHand = this.hands[creator.id];
    this.joinerHand = [];

    // Table melds laid down by players
    this.tableMelds = {
      [creator.id]: []
    };

    this.currentTurnPlayerId = null;
    this.turnState = null; // 'AWAITING_DRAW', 'AWAITING_DISCARD'
    this.isFirstDiscard = true; // Rule 1: Starter's first discard protected
    this.mustMeld41PlayerId = null; // Player who picked from ground and must meld 41
    this.gebiOpenPoints = {}; // Tracks Gebi card points attached before/while reaching 41

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
        delete this.temporarilyLeft[userId];
        delete this.leaveTimeouts[userId];

        const elimRes = this.eliminateOrFinish(
          userId,
          'ABANDON_FORFEIT',
          `❌ ${leftPlayer.name} በ1 ደቂቃ ውስጥ ስላልተመለሰ ተሸንፏል!`
        );
        if (cb) cb(this, elimRes.winner || null, leftPlayer, elimRes.gameFinished);
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
    if (!this.currentTurnPlayerId) {
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
    const elimRes = this.eliminateOrFinish(
      timedOutId,
      'TIMEOUT_FORFEIT',
      `⏰ ${timedOutName} በ1 ደቂቃ ውስጥ ካርታ ስላልጣለ ተሸንፏል!`
    );
    if (onTimeout) {
      onTimeout(this, elimRes.winner || null, { id: timedOutId, name: timedOutName }, elimRes.gameFinished);
    }
  }

  checkTurnTimeout() {
    if (this.status === 'PLAYING' && this.turnDeadline && Date.now() >= this.turnDeadline) {
      this.handleTurnTimeout(this.onTurnTimeoutCallback);
      return true;
    }
    return false;
  }

  getActivePlayers() {
    return this.players.filter(p => !this.eliminatedPlayers.has(p.id));
  }

  getNextActivePlayer(currentPlayerId) {
    const idx = this.players.findIndex(p => p.id === currentPlayerId);
    if (idx === -1) return this.getActivePlayers()[0] || null;
    for (let offset = 1; offset <= this.players.length; offset++) {
      const candidate = this.players[(idx + offset) % this.players.length];
      if (candidate && !this.eliminatedPlayers.has(candidate.id)) {
        return candidate;
      }
    }
    return null;
  }

  eliminateOrFinish(playerId, winReasonCode, logMsg) {
    if (this.status !== 'PLAYING') return { gameFinished: false };
    this.eliminatedPlayers.add(playerId);

    if (this.mustMeld41PlayerId === playerId) {
      this.mustMeld41PlayerId = null;
    }

    const active = this.getActivePlayers();
    if (active.length <= 1) {
      const winner = active[0] || this.creator;
      this.status = 'FINISHED';
      this.winner = winner.id;
      this.winReason = winReasonCode;
      this.forfeitedPlayer = { id: playerId, name: this.getPlayerName(playerId) };

      const payout = walletManager.payoutWinner(this.roomId, winner.id);
      this.log(`🏆 ${logMsg} ${winner.name} አሸናፊ ሆኗል!`);
      this.resetPoke();
      this.clearAllTimers();
      return { gameFinished: true, winner, payout };
    }

    // 2+ active players remain: return eliminated player's cards to deck and continue!
    const hand = this.hands[playerId] || [];
    if (hand.length > 0) {
      this.deck.push(...hand);
      this.hands[playerId] = [];
      this.deck = shuffleDeck(this.deck);
    }

    this.log(`${logMsg} (ቀሪ ${active.length} ተጫዋቾች ይቀጥላሉ!)`);
    if (this.currentTurnPlayerId === playerId) {
      const nextP = this.getNextActivePlayer(playerId);
      if (nextP) {
        this.currentTurnPlayerId = nextP.id;
        this.turnState = 'AWAITING_DRAW';
      }
      this.resetPoke();
      this.resetTurnTimer();
    }
    return { gameFinished: false, eliminatedId: playerId };
  }

  log(message) {
    const time = new Date().toLocaleTimeString();
    this.logs.unshift(`[${time}] ${message}`);
    if (this.logs.length > 50) this.logs.pop();
  }

  join(player) {
    if (this.players.length >= this.maxPlayers) return { success: false, message: 'Room already full' };
    if (this.players.some(p => p.id === player.id)) return { success: false, message: 'Already in room' };

    this.players.push(player);
    this.hands[player.id] = [];
    this.tableMelds[player.id] = [];
    if (!this.joiner) {
      this.joiner = player;
      this.joinerHand = this.hands[player.id];
    }

    this.log(`${player.name} joined the table (${this.players.length}/${this.maxPlayers}).`);

    if (this.players.length < this.maxPlayers) {
      return { success: true, waitingForMore: true };
    }

    // Lock bets into Escrow for all players once table is full (skip for free AI bot practice)
    if (this.isFreeBot || this.stakeAmount <= 0) {
      this.pot = 0;
    } else {
      const lockMultiplier = this.doubleEnabled ? 2 : 1;
      const escrowResult = walletManager.lockEscrow(this.roomId, this.players.map(p => p.id), this.stakeAmount, { lockMultiplier });
      if (!escrowResult.success) {
        this.players.pop();
        delete this.hands[player.id];
        delete this.tableMelds[player.id];
        if (this.joiner && this.joiner.id === player.id) this.joiner = null;
        return { success: false, message: escrowResult.message };
      }
      this.pot = escrowResult.pot;
    }

    // 108-Card 2-Deck Setup (cards will be dealt after Joiner calls Joker!)
    this.deck = shuffleDeck(createConquerDeck(2));
    for (const p of this.players) {
      this.hands[p.id] = [];
    }
    this.creatorHand = this.hands[this.creator.id];
    this.joinerHand = this.joiner ? this.hands[this.joiner.id] : [];
    this.baseCard = null;
    this.jokerCard = null;

    // Transition to CUTTING_JOKER (Joiner chooses blindly BEFORE cards are dealt!)
    this.status = 'CUTTING_JOKER';
    this.log(`Pot is ${this.pot} ETB. 🎲 ${this.joiner.name} ካርታ ከመታደሉ በፊት በጭፍን ጆከር ይሰይማል (ከፍ፣ ዝቅ፣ አንድ ላይ፣ ወይም ጎን)።`);

    return { success: true };
  }

  // Joiner chooses blindly BEFORE cards are dealt: "ከፍ" (High), "ዝቅ" (Low), "አንድ ላይ" (Same), or "ጎን" (Opposite Color)
  setJokerHighLow(playerId, choice = 'high') {
    if (this.status !== 'CUTTING_JOKER') {
      return { success: false, message: 'Not in cutting phase' };
    }
    if (!this.joiner || this.joiner.id !== playerId) {
      return { success: false, message: 'Only the Joiner can call the Joker!' };
    }

    // 1. Deal 13 cards to each player, and 14th card to Creator
    for (const p of this.players) {
      this.hands[p.id] = [];
    }
    for (let i = 0; i < 13; i++) {
      for (const p of this.players) {
        this.hands[p.id].push(this.deck.pop());
      }
    }
    // Creator gets 14th card
    this.hands[this.creator.id].push(this.deck.pop());
    this.creatorHand = this.hands[this.creator.id];
    this.joinerHand = this.joiner ? this.hands[this.joiner.id] : [];

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
    this.printedJokersAreWild = false;

    if (this.baseCard.isFalseJoker) {
      // If the flipped cut card itself is a False Joker, the Printed Jokers become the REAL Wild Jokers!
      this.printedJokersAreWild = true;
      targetRank = 'JOKER';
      targetSuits = ['🃏'];
      choiceName = choice === 'low' || choice === 'tach' ? 'ዝቅ / ታች (Low)' : (choice === 'gon' || choice === 'opposite' ? 'ጎን (Opposite)' : 'ከፍ (High)');
      this.baseCard.isJoker = true;
      this.baseCard.isMainJoker = true;
      this.baseCard.isFalseJoker = false;
      this.baseCard.rank = 'JOKER';
    } else {
      const sameColorSuits = this.baseCard.color === 'black' ? ['♣', '♠'] : ['♥', '♦'];
      const oppColorSuits = this.baseCard.color === 'black' ? ['♥', '♦'] : ['♣', '♠'];

      if (choice === 'low' || choice === 'tach') {
        targetRank = getPrevRank(this.baseCard.rank);
        targetSuits = sameColorSuits;
        choiceName = 'ዝቅ / ታች (Low)';
      } else if (choice === 'gon' || choice === 'opposite') {
        targetRank = this.baseCard.rank;
        targetSuits = oppColorSuits;
        choiceName = 'ጎን (Opposite Color)';
      } else {
        targetRank = getNextRank(this.baseCard.rank);
        targetSuits = sameColorSuits;
        choiceName = 'ከፍ (High)';
      }
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
      if (this.printedJokersAreWild) {
        if (card.isFalseJoker || card.rank === 'FALSE' || card.rank === 'JOKER') {
          card.isJoker = true;
          card.isMainJoker = true;
          card.isFalseJoker = false;
          card.rank = 'JOKER';
        } else {
          card.isJoker = false;
          card.isMainJoker = false;
        }
        return;
      }

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
        card.pointValue = this.jokerRank ? getCardPointValue(this.jokerRank) : 0;
      }
    };
    for (const p of this.players) {
      (this.hands[p.id] || []).forEach(mark);
    }
    this.deck.forEach(mark);
    this.discardPile.forEach(mark);
  }

  getHand(playerId) {
    return this.hands[playerId] || [];
  }

  getOpponent(playerId) {
    return this.getNextActivePlayer(playerId) || this.players.find(p => p.id !== playerId) || null;
  }

  // Draw card: source = 'deck' | 'ground'
  drawCard(playerId, source) {
    if (this.status !== 'PLAYING') return { success: false, message: 'Game not in progress' };
    if (this.currentTurnPlayerId !== playerId) return { success: false, message: 'Not your turn' };
    if (this.turnState !== 'AWAITING_DRAW') return { success: false, message: 'Already drew a card' };

    const hand = this.getHand(playerId);
    let drawnCard = null;

    if (source === 'deck') {
      const reshuffledBefore = this.checkAndReshuffleIfNeeded();
      if (reshuffledBefore === 'MONTE') {
        return { success: true, isMonte: true };
      }
      drawnCard = this.deck.pop();
      if (!drawnCard) {
        return { success: false, message: 'ዴኩም መሬቱም ባዶ ነው!' };
      }
      hand.push(drawnCard);
      const reshuffledAfter = this.checkAndReshuffleIfNeeded();
      if (reshuffledAfter === 'MONTE') {
        return { success: true, card: drawnCard, from: 'deck', isMonte: true };
      }
      const reshuffled = reshuffledBefore || reshuffledAfter;
      this.turnState = 'AWAITING_DISCARD';
      this.resetPoke();
      this.resetTurnTimer();
      this.log(`${this.getPlayerName(playerId)} drew a card from the deck.`);
      return { success: true, card: drawnCard, from: 'deck', reshuffled };
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
      const discardedIsJoker = Boolean(
        !discardedCard.isFalseJoker && (
          discardedCard.isJoker ||
          (this.jokerRank && discardedCard.rank === this.jokerRank && (!this.jokerSuits || this.jokerSuits.includes(discardedCard.suit)))
        )
      );
      const hasDubeMelds = (this.tableMelds[playerId] || []).some(m => Array.isArray(m) && m.length === 2);
      const isDouble = (this.jokerDouble && discardedIsJoker) || (this.dubeDouble && hasDubeMelds);
      this.doubleWin = isDouble;

      this.mustMeld41PlayerId = null;
      this.discardPile.push(discardedCard);
      this.status = 'FINISHED';
      this.winner = playerId;
      this.winReason = isDouble
        ? `🔥 DOUBLE ኮንከር (ጆከር ለመሬት)! ${this.getPlayerName(playerId)} 13ቱንም ካርታ አውርዶ መጨረሻ ላይ ጆከር (${discardedCard.rank}${discardedCard.suit}) በመጣል 2× አሸነፈ!`
        : `👑 ኮንከር! ${this.getPlayerName(playerId)} 13ቱንም ካርታ አውርዶ መጨረሻ ላይ ${discardedCard.rank}${discardedCard.suit} በመጣል አሸነፈ!`;
      this.log(`🏆 ${this.winReason}`);

      const payout = walletManager.payoutWinner(this.roomId, playerId, { isDouble });
      this.resetPoke();
      this.clearTurnTimer();
      return { success: true, isWin: true, isDouble, winner: playerId, payout };
    }

    // Finishing Conquer or Dube directly from hand (Rule 5 & 12) — allowed even without 41 on table!
    if (toGebi) {
      const hasAlreadyOpened = this.tableMelds[playerId] && this.tableMelds[playerId].length > 0;
      const winValidation = validateConquerHand(melds, discardedCard, this.jokerRank, this.jokerCard, this.jokerSuits);
      const dubeResult = (!winValidation.valid && !hasAlreadyOpened && hand.length === 13)
        ? findDubeWin(hand, this.jokerRank, this.jokerSuits)
        : null;

      if (!winValidation.valid && !dubeResult) {
        hand.splice(cardIndex, 0, discardedCard);
        if (this.mustMeld41PlayerId === playerId) {
          const forfeitRes = this.forfeitFromFailedGround(playerId);
          return { success: true, isForfeit: true, ...forfeitRes };
        }
        return { success: false, message: `Cannot Conquer: ${winValidation.message}` };
      }

      if (dubeResult) {
        this.tableMelds[playerId] = [dubeResult.tris, ...dubeResult.pairs];
        this.hands[playerId] = [];
      } else if (Array.isArray(melds) && melds.length > 0) {
        this.tableMelds[playerId] = melds.map(g => sortMeldCards(g, this.jokerRank, this.jokerSuits));
        this.hands[playerId] = [];
      }

      const discardedIsJoker = Boolean(
        !discardedCard.isFalseJoker && (
          discardedCard.isJoker ||
          (this.jokerRank && discardedCard.rank === this.jokerRank && (!this.jokerSuits || this.jokerSuits.includes(discardedCard.suit)))
        )
      );
      const isDouble = (this.jokerDouble && discardedIsJoker) || (this.dubeDouble && !!dubeResult);
      this.doubleWin = isDouble;

      this.mustMeld41PlayerId = null;
      this.discardPile.push(discardedCard);
      this.status = 'FINISHED';
      this.winner = playerId;
      if (dubeResult) {
        this.winReason = (this.dubeDouble)
          ? `🔥 DOUBLE ዱቤ (DUBE 2×)! ${this.getPlayerName(playerId)} 1 ትሪስ + 5 ጥንድ አውርዶ 2× አሸነፈ!`
          : `👑 ዱቤ (DUBE)! ${this.getPlayerName(playerId)} 1 ትሪስ + 5 ጥንድ አውርዶ አሸነፈ!`;
      } else {
        this.winReason = isDouble
          ? `🔥 DOUBLE ኮንከር (ጆከር ለመሬት)! ${this.getPlayerName(playerId)} ጆከር (${discardedCard.rank}${discardedCard.suit}) ጥሎ 2× አሸነፈ!`
          : `CONQUER! ${this.getPlayerName(playerId)} discarded ${discardedCard.rank}${discardedCard.suit} and won!`;
      }
      this.log(`🏆 ${this.winReason}`);

      const payout = walletManager.payoutWinner(this.roomId, playerId, { isDouble });
      this.resetPoke();
      this.clearTurnTimer();
      return { success: true, isWin: true, isDube: !!dubeResult, isDouble, winner: playerId, payout };
    }

    // Player picked from ground without having opened: cannot discard until 41 is melded or hand closes!
    if (this.mustMeld41PlayerId === playerId) {
      hand.splice(cardIndex, 0, discardedCard);
      return {
        success: false,
        mustMeld41: true,
        message: '⚠️ ከመሬት ስላነሳህ 41 የሚሞላ መውረድ አለብህ!'
      };
    }

    // Rule: GEBI (ገቢ) Restriction on Discarding
    // A player CANNOT discard a card to ground if it can be GEBI into any open table meld!
    if (isCardGebiToTable(discardedCard, this.tableMelds, this.jokerRank, this.jokerSuits)) {
      hand.splice(cardIndex, 0, discardedCard); // restore card
      return {
        success: false,
        isGebi: true,
        message: `⚠️ [ ${discardedCard.rank}${discardedCard.suit} ] ወደ ጠረጴዛው የወረደ ካርታ ገቢ (GEBI) ስለሚሆን ወደ መሬት መጣል አትችልም! ሌላ ካርታ ምረጥ።`
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
        meldPoints += getMeldPoints(group, this.jokerRank, this.jokerSuits);
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

    this.log(`✅ ${this.getPlayerName(playerId)} ${meldPoints} ነጥብ አውርዶ ${drawnCard.rank}${drawnCard.suit} ከመሬት አነሳ!`);
    return { success: true, card: drawnCard, meldPoints };
  }

  // Lay down melds onto the table ("ውረድ") without drawing from ground
  layDownMelds(playerId, meldsToLayDown) {
    if (this.status !== 'PLAYING') return { success: false, message: 'Game not in progress' };
    if (this.currentTurnPlayerId !== playerId) return { success: false, message: 'Not your turn' };
    if (!meldsToLayDown || meldsToLayDown.length === 0) return { success: false, message: 'ምንም ካርታ አልተመረጠም' };

    const hand = this.getHand(playerId);
    const hasAlreadyOpened = this.tableMelds[playerId] && this.tableMelds[playerId].length > 0;

    let meldPoints = 0;
    for (const group of meldsToLayDown) {
      const isDubePair = Array.isArray(group) && group.length === 2 && isValidDubePair(group[0], group[1], this.jokerRank, this.jokerSuits);
      if (!isDubePair && !isValidConquerMeld(group, this.jokerRank, this.jokerSuits)) {
        return { success: false, message: 'ያልተሟላ ወይም የተሳሳተ ትሪስ / ጥንድ ነው!' };
      }
      meldPoints += getMeldPoints(group, this.jokerRank, this.jokerSuits);
    }

    // Verify all cards exist in player hand
    for (const group of meldsToLayDown) {
      for (const card of group) {
        const idx = hand.findIndex(c => String(c.id) === String(card.id));
        if (idx === -1) return { success: false, message: `Card ${card.rank}${card.suit} not in hand` };
      }
    }

    // Remove from hand and add to player's table melds (preserving/auto-setting Joker designation)
    for (const group of meldsToLayDown) {
      const laidGroup = [];
      const jokerOpts = getJokerReplacementOptions(group, this.jokerRank, this.jokerSuits);
      for (const card of group) {
        const idx = hand.findIndex(c => String(c.id) === String(card.id));
        if (idx !== -1) {
          const [handCard] = hand.splice(idx, 1);
          const isJk = handCard.isJoker || handCard.rank === this.jokerRank;
          if (isJk) {
            if (card.assignedCard && jokerOpts.some(o => o.rank === card.assignedCard.rank && o.suit === card.assignedCard.suit)) {
              handCard.assignedCard = { rank: card.assignedCard.rank, suit: card.assignedCard.suit };
            } else if (jokerOpts.length >= 1) {
              handCard.assignedCard = { rank: jokerOpts[0].rank, suit: jokerOpts[0].suit };
            }
          }
          laidGroup.push(handCard);
        }
      }
      if (!this.tableMelds[playerId]) this.tableMelds[playerId] = [];
      this.tableMelds[playerId].push(
        laidGroup.length === 2 ? laidGroup : sortMeldCards(laidGroup, this.jokerRank, this.jokerSuits)
      );
    }

    // Combined table melds + Gebi points toward 41 opening threshold
    const totalTablePoints = (this.tableMelds[playerId] || []).reduce(
      (sum, m) => sum + getMeldPoints(m, this.jokerRank, this.jokerSuits), 0
    ) + (this.gebiOpenPoints[playerId] || 0);
    if (totalTablePoints >= 41 || hand.length <= 1) {
      if (this.mustMeld41PlayerId === playerId) this.mustMeld41PlayerId = null;
    } else if (!hasAlreadyOpened) {
      this.mustMeld41PlayerId = playerId;
    }

    this.resetPoke();
    this.resetTurnTimer();
    this.log(`📥 ${this.getPlayerName(playerId)} ወረደ (ወደ ጠረጴዛ አወረደ): ${meldPoints} ነጥብ!`);
    return { success: true, meldPoints, melds: meldsToLayDown };
  }

  // Penalty: Player picked from ground/base and failed to close -> ELIMINATE (or finish if 1 left)!
  forfeitFromFailedGround(playerId) {
    if (this.status !== 'PLAYING') return;
    const elimRes = this.eliminateOrFinish(
      playerId,
      'GROUND_FORFEIT',
      `❌ ${this.getPlayerName(playerId)} ከመሬት/ጆከር ስቦ ሳይዘጋ ስላጠፋ ተሸንፏል!`
    );
    if (elimRes.gameFinished && this.onTurnTimeoutCallback) {
      // Wallet payout already happened inside eliminateOrFinish
    }
    return elimRes;
  }

  // Rule 7: Reshuffle ONCE when deck empties; 2nd time deck empties -> MONTE (5% fee deducted, 95% refunded)
  checkAndReshuffleIfNeeded() {
    if (this.deck.length === 0) {
      if (this.reshuffleCount >= 1 || this.discardPile.length <= 1) {
        this.status = 'FINISHED';
        this.winner = 'MONTE';
        this.winReason = 'MONTE';
        const monteRes = walletManager.settleMonte(this.roomId, 0.05);
        this.resetPoke();
        this.clearAllTimers();
        this.log(
          monteRes
            ? `🃏 ሞንቴ (MONTE)! ካርታው ለ2ኛ ጊዜ ስላለቀ ጨዋታው ሞንቴ ሆኗል — 5% (${monteRes.feePerPlayer} ETB) ተቀንሶ ${monteRes.refundPerPlayer} ETB ተመልሷል።`
            : '🃏 ሞንቴ (MONTE)! ካርታው ለ2ኛ ጊዜ ስላለቀ ጨዋታው ሞንቴ ሆኗል።'
        );
        return 'MONTE';
      }
      const topGround = this.discardPile.pop();
      this.deck = shuffleDeck(this.discardPile);
      this.discardPile = [topGround];
      this.reshuffleCount += 1;
      this.log('🔄 Rule 7: Stock deck ran out! Reshuffled the ground cards once to continue the game.');
      return true;
    }
    return false;
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

  // Rule 9 & 13: Joker Swap / Steal from a table meld (ጆከር ተካ)
  swapJoker(playerId, targetPlayerMeldOwnerId, meldIndex, naturalCardId) {
    if (this.status !== 'PLAYING') return { success: false, message: 'Game not active' };
    if (this.currentTurnPlayerId !== playerId) return { success: false, message: 'Can only swap on your turn' };

    const playerHand = this.getHand(playerId);
    const naturalCardIndex = playerHand.findIndex(c => String(c.id) === String(naturalCardId));
    if (naturalCardIndex === -1) return { success: false, message: 'Natural card not in hand' };
    const naturalCard = playerHand[naturalCardIndex];

    if (naturalCard.isJoker || naturalCard.rank === this.jokerRank) {
      return { success: false, message: 'ጆከርን በጆከር መተካት አይቻልም!' };
    }

    const melds = this.tableMelds[targetPlayerMeldOwnerId];
    if (!melds || !melds[meldIndex]) return { success: false, message: 'የወረደ ቡድን አልተገኘም' };

    const targetMeld = melds[meldIndex];
    const jokerIndex = targetMeld.findIndex(c => c.isJoker || c.rank === this.jokerRank);
    if (jokerIndex === -1) return { success: false, message: 'በዚህ ቡድን ውስጥ ጆከር የለም' };

    const stolenJoker = targetMeld[jokerIndex];
    const expected = stolenJoker.assignedCard;
    if (expected) {
      if (naturalCard.rank !== expected.rank || naturalCard.suit !== expected.suit) {
        return {
          success: false,
          message: `⚠️ ይህ ጆከር የተሰየመው ለ [ ${expected.rank}${expected.suit} ] ነው! [ ${naturalCard.rank}${naturalCard.suit} ] አይተካውም!`
        };
      }
    } else {
      const opts = getJokerReplacementOptions(targetMeld, this.jokerRank, this.jokerSuits);
      if (!opts.some(o => o.rank === naturalCard.rank && o.suit === naturalCard.suit)) {
        return { success: false, message: '⚠️ ይህ ካርታ ጆከሩን መተካት አይችልም!' };
      }
    }

    // Swap
    delete stolenJoker.assignedCard;
    targetMeld[jokerIndex] = naturalCard;
    melds[meldIndex] = sortMeldCards(targetMeld, this.jokerRank, this.jokerSuits);
    playerHand.splice(naturalCardIndex, 1);
    playerHand.push(stolenJoker);

    this.log(`🔄 ${this.getPlayerName(playerId)} swapped a Joker from table with ${naturalCard.rank}${naturalCard.suit} (ጆከር ተካ)!`);
    return { success: true, stolenJoker };
  }

  // Rule: Attach a card from hand to an open table meld (ገቢ ማድረግ)
  attachGebiCard(playerId, targetPlayerMeldOwnerId, meldIndex, cardId) {
    if (this.status !== 'PLAYING') return { success: false, message: 'Game not active' };
    if (this.currentTurnPlayerId !== playerId) return { success: false, message: 'Can only attach cards on your turn' };
    if (this.turnState !== 'AWAITING_DISCARD') return { success: false, message: 'መጀመሪያ ካርታ ማንሳት አለብህ!' };

    const playerHand = this.getHand(playerId);
    const cardIndex = playerHand.findIndex(c => String(c.id) === String(cardId));
    if (cardIndex === -1) return { success: false, message: 'Card not in hand' };
    const card = playerHand[cardIndex];

    // False Joker cannot be attached via Gebi!
    if (card.isFalseJoker) {
      return { success: false, message: 'False Joker ገቢ ማድረግ አይቻልም! ወረድ (ትሪስ) ውስጥ ብቻ ያስገባል።' };
    }

    const melds = this.tableMelds[targetPlayerMeldOwnerId];
    if (!melds || !melds[meldIndex]) return { success: false, message: 'የወረደ ቡድን አልተገኘም' };
    const targetMeld = melds[meldIndex];

    if (!isCardGebiToMeld(card, targetMeld, this.jokerRank, this.jokerSuits)) {
      return { success: false, message: 'ይህ ካርታ ወደዚህ ቡድን ገቢ (GEBI) መሆን አይችልም!' };
    }

    // Attach card to target meld and sort into proper sequence order (e.g. 2 + 3-4-5 -> 2-3-4-5)
    targetMeld.push(card);
    melds[meldIndex] = sortMeldCards(targetMeld, this.jokerRank, this.jokerSuits);
    playerHand.splice(cardIndex, 1);

    const cardPts = card.isFalseJoker ? getCardPointValue(this.jokerRank) : (card.pointValue || getCardPointValue(card.rank) || 0);
    this.gebiOpenPoints[playerId] = (this.gebiOpenPoints[playerId] || 0) + cardPts;

    const totalCombinedPoints = (this.tableMelds[playerId] || []).reduce(
      (sum, m) => sum + getMeldPoints(m, this.jokerRank, this.jokerSuits), 0
    ) + this.gebiOpenPoints[playerId];

    if (totalCombinedPoints >= 41 || playerHand.length <= 1) {
      if (this.mustMeld41PlayerId === playerId) this.mustMeld41PlayerId = null;
    } else {
      this.mustMeld41PlayerId = playerId;
    }

    this.log(`📥 ${this.getPlayerName(playerId)} ${card.rank}${card.suit} ጠረጴዛ ላይ ገቢ አደረገ! (+${cardPts} ነጥብ)`);
    return { success: true, card, meld: targetMeld, totalCombinedPoints };
  }

  getPlayerName(playerId) {
    const found = this.players.find(p => p.id === playerId);
    if (found) return found.name;
    if (this.creator && this.creator.id === playerId) return this.creator.name;
    if (this.joiner && this.joiner.id === playerId) return this.joiner.name;
    return 'Player';
  }

  // Returns safe sanitized state for a specific player (anti-cheat: hide opponent's hand and deck)
  getClientState(playerId) {
    const myHand = this.getHand(playerId);
    const otherPlayers = this.players.filter(p => p.id !== playerId);
    const primaryOpp = this.getOpponent(playerId) || otherPlayers[0] || null;
    const opponentHandCount = primaryOpp ? this.getHand(primaryOpp.id).length : 0;

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
      maxPlayers: this.maxPlayers,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        handCount: (this.hands[p.id] || []).length,
        eliminated: this.eliminatedPlayers.has(p.id)
      })),
      opponents: otherPlayers.map(p => ({
        id: p.id,
        name: p.name,
        handCount: (this.hands[p.id] || []).length,
        eliminated: this.eliminatedPlayers.has(p.id)
      })),
      eliminatedPlayers: Array.from(this.eliminatedPlayers),
      stakeAmount: this.stakeAmount,
      pot: this.pot,
      jokerDouble: this.jokerDouble,
      dubeDouble: this.dubeDouble,
      doubleEnabled: this.doubleEnabled,
      doubleWin: this.doubleWin,
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
      opponentHand: undefined,
      opponent: primaryOpp ? { id: primaryOpp.id, name: primaryOpp.name } : null,
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

