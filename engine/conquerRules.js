// engine/conquerRules.js
const { RANK_ORDER, getCardPointValue } = require('./cardTypes');

/**
 * Checks if cards form a 100% pure natural meld (sequence of same suit or set of same rank)
 * without using any wild joker power.
 */
function isNaturalMeld(cards) {
  if (!cards || (cards.length !== 3 && cards.length !== 4)) return false;
  if (cards.some(c => c.isJoker || c.isMainJoker || c.isFalseJoker)) return false;
  if (isSequenceSameSuit(cards)) return true;
  if (cards.every(c => c.rank === cards[0].rank)) {
    const suits = new Set(cards.map(c => c.suit));
    return suits.size >= 2;
  }
  return false;
}

function isWildJoker(c, jokerRank, jokerSuits) {
  if (!c) return false;
  if (c.isFalseJoker) return false; // False joker is NEVER wild!
  if (c.isJoker && !c.isFalseJoker) return true;
  if (jokerRank && c.rank === jokerRank) {
    if (!jokerSuits || jokerSuits.includes(c.suit)) return true;
  }
  return false;
}

/**
 * Checks if a group of 3 cards forms a valid Tris (Set or Sequence).
 * Enforces Rule 14: Maximum 1 Joker per Tris!
 */
function isValidTris(cards, jokerRank, jokerSuits) {
  if (!cards || cards.length !== 3) return false;
  if (isNaturalMeld(cards)) return true;

  const isJk = (c) => isWildJoker(c, jokerRank, jokerSuits);
  const jokerCount = cards.filter(isJk).length;
  // Rule 14: Cannot use 2 or more jokers in the same Tris!
  if (jokerCount > 1) return false;

  const naturalCards = cards.filter(c => !isJk(c));
  const getRank = (c) => (c.isFalseJoker ? jokerRank : c.rank);

  // Case 1: Pure Tris (Set of 3 same rank, or False Joker substituting designated rank)
  if (jokerCount === 0) {
    const r0 = getRank(naturalCards[0]);
    if (r0 && getRank(naturalCards[1]) === r0 && getRank(naturalCards[2]) === r0) {
      const suits = new Set(naturalCards.map(c => c.suit));
      return suits.size >= 2;
    }
    const nonFalse = naturalCards.filter(c => !c.isFalseJoker);
    const hasFalse = naturalCards.some(c => c.isFalseJoker);
    const seqSuit = nonFalse.length > 0 ? nonFalse[0].suit : naturalCards[0].suit;
    if (!hasFalse || !jokerSuits || jokerSuits.includes(seqSuit)) {
      const cardsWithRanks = naturalCards.map(c => ({ rank: getRank(c), suit: c.isFalseJoker ? seqSuit : c.suit }));
      if (isSequenceSameSuit(cardsWithRanks)) return true;
    }
  }

  // Case 2: Tris with 1 Joker
  if (jokerCount === 1) {
    const r0 = getRank(naturalCards[0]);
    const r1 = getRank(naturalCards[1]);
    if (r0 && r0 === r1) {
      return true; // Joker acts as the 3rd card of that rank
    }
    const nonFalse = naturalCards.filter(c => !c.isFalseJoker);
    const hasFalse = naturalCards.some(c => c.isFalseJoker);
    const seqSuit = nonFalse.length > 0 ? nonFalse[0].suit : naturalCards[0].suit;
    if (!hasFalse || !jokerSuits || jokerSuits.includes(seqSuit)) {
      const s0 = naturalCards[0].isFalseJoker ? seqSuit : naturalCards[0].suit;
      const s1 = naturalCards[1].isFalseJoker ? seqSuit : naturalCards[1].suit;
      if (s0 === s1) {
        if (canFormSequenceWithJoker([
          { rank: r0, suit: s0 },
          { rank: r1, suit: s1 }
        ], 1, 3)) return true;
      }
    }
  }

  return false;
}

/**
 * Checks if a group of 4 cards forms a valid Quatris (Set or Sequence).
 * Enforces Rule 14: Maximum 1 Joker per Quatris!
 */
function isValidQuatris(cards, jokerRank, jokerSuits) {
  if (!cards || cards.length !== 4) return false;
  if (isNaturalMeld(cards)) return true;

  const isJk = (c) => isWildJoker(c, jokerRank, jokerSuits);
  const jokerCount = cards.filter(isJk).length;
  // Rule 14: Cannot use 2 or more jokers in the same Quatris!
  if (jokerCount > 1) return false;

  const naturalCards = cards.filter(c => !isJk(c));
  const getRank = (c) => (c.isFalseJoker ? jokerRank : c.rank);

  // Case 1: Pure Quatris (4 same rank or 4 sequence same suit)
  if (jokerCount === 0) {
    const r0 = getRank(naturalCards[0]);
    if (r0 && naturalCards.every(c => getRank(c) === r0)) {
      const suits = new Set(naturalCards.map(c => c.suit));
      return suits.size >= 2;
    }
    const nonFalse = naturalCards.filter(c => !c.isFalseJoker);
    const hasFalse = naturalCards.some(c => c.isFalseJoker);
    const seqSuit = nonFalse.length > 0 ? nonFalse[0].suit : naturalCards[0].suit;
    if (!hasFalse || !jokerSuits || jokerSuits.includes(seqSuit)) {
      const cardsWithRanks = naturalCards.map(c => ({ rank: getRank(c), suit: c.isFalseJoker ? seqSuit : c.suit }));
      if (isSequenceSameSuit(cardsWithRanks)) return true;
    }
  }

  // Case 2: Quatris with 1 Joker
  if (jokerCount === 1) {
    const r0 = getRank(naturalCards[0]);
    if (r0 && naturalCards.every(c => getRank(c) === r0)) {
      return true;
    }
    const nonFalse = naturalCards.filter(c => !c.isFalseJoker);
    const hasFalse = naturalCards.some(c => c.isFalseJoker);
    const seqSuit = nonFalse.length > 0 ? nonFalse[0].suit : naturalCards[0].suit;
    if (!hasFalse || !jokerSuits || jokerSuits.includes(seqSuit)) {
      const mapped = naturalCards.map(c => ({ rank: getRank(c), suit: c.isFalseJoker ? seqSuit : c.suit }));
      if (mapped.every(c => c.suit === seqSuit)) {
        if (canFormSequenceWithJoker(mapped, 1, 4)) return true;
      }
    }
  }

  return false;
}

// Helper: check if natural cards form an unbroken sequence of the same suit
function isSequenceSameSuit(cards) {
  if (!cards || cards.length < 3) return false;
  const suit = cards[0].suit;
  if (!cards.every(c => c.suit === suit)) return false;

  // Check standard sequence
  const orderAAs1 = cards.map(c => RANK_ORDER[c.rank]).sort((a, b) => a - b);
  if (isConsecutive(orderAAs1)) return true;

  // Check A as high (14) for sequences like 10-J-Q-K-A
  const orderAAs14 = cards.map(c => (c.rank === 'A' ? 14 : RANK_ORDER[c.rank])).sort((a, b) => a - b);
  if (isConsecutive(orderAAs14)) return true;

  return false;
}

function isConsecutive(numbers) {
  for (let i = 0; i < numbers.length - 1; i++) {
    if (numbers[i + 1] - numbers[i] !== 1) return false;
  }
  return true;
}

function canFormSequenceWithJoker(naturalCards, jokerCount, targetLength) {
  const suit = naturalCards[0].suit;
  if (!naturalCards.every(c => c.suit === suit)) return false;

  const testSequence = (orderMap) => {
    const nums = naturalCards.map(c => orderMap(c.rank)).sort((a, b) => a - b);
    // check for duplicates
    for (let i = 0; i < nums.length - 1; i++) {
      if (nums[i] === nums[i + 1]) return false;
    }
    const span = nums[nums.length - 1] - nums[0] + 1;
    const missing = span - nums.length;
    return span <= targetLength && missing <= jokerCount;
  };

  const as1 = testSequence(r => RANK_ORDER[r]);
  const as14 = testSequence(r => (r === 'A' ? 14 : RANK_ORDER[r]));
  return as1 || as14;
}

/**
 * Calculates current hand points according to Conquer rules:
 * - A = 11
 * - K, Q, J, 10 = 10
 * - 2..9 = face value
 * - Special 41: 4 Aces = 41
 * - Special 41: J, Q, K, A same suit = 41
 */
function calculateHandPoints(hand) {
  if (!hand || hand.length === 0) return { total: 0, hasSpecial41: false, specialReason: null };

  // Rule 10: 4 Aces check (Quatris of Aces)
  const aces = hand.filter(c => c.rank === 'A');
  const aceSuits = new Set(aces.map(c => c.suit));
  if (aces.length >= 4 && aceSuits.size === 4) {
    return {
      total: 41,
      hasSpecial41: true,
      specialReason: '4 Aces (A♠, A♥, A♦, A♣) - 41 Point Quatris!'
    };
  }

  // Rule 11: J-Q-K-A same suit check
  const suits = ['♠', '♥', '♦', '♣'];
  for (const s of suits) {
    const suited = hand.filter(c => c.suit === s);
    const ranks = new Set(suited.map(c => c.rank));
    if (ranks.has('J') && ranks.has('Q') && ranks.has('K') && ranks.has('A')) {
      return {
        total: 41,
        hasSpecial41: true,
        specialReason: `J-Q-K-A of ${s} - 41 Point Quatris!`
      };
    }
  }

  // Standard point sum
  let sum = 0;
  for (const card of hand) {
    sum += card.pointValue || 0;
  }

  return {
    total: sum,
    hasSpecial41: sum >= 41,
    specialReason: sum >= 41 ? '41 points reached' : null
  };
}

/**
 * Finds all valid Tris present in the user's hand
 */
function findHandTris(hand, jokerRank) {
  const validTrisList = [];
  const n = hand.length;
  for (let i = 0; i < n - 2; i++) {
    for (let j = i + 1; j < n - 1; j++) {
      for (let k = j + 1; k < n; k++) {
        const trio = [hand[i], hand[j], hand[k]];
        if (isValidTris(trio, jokerRank)) {
          validTrisList.push(trio);
        }
      }
    }
  }
  return validTrisList;
}

/**
 * Rule 1, 4 & 6: Ground Draw Eligibility Check
 * Returns { canDraw: boolean, reason: string }
 */
function canDrawFromGround(hand, groundCard, isFirstDiscard, jokerRank) {
  // First discard by starter cannot be drawn
  if (isFirstDiscard) {
    return {
      canDraw: false,
      reason: 'የመጀመሪያው ካርታ አይነሳም!'
    };
  }

  // If a Joker was accidentally dropped on ground, opponent can always pick it up!
  if (groundCard && (groundCard.rank === jokerRank || groundCard.isJoker)) {
    return {
      canDraw: true,
      reason: 'Joker on the ground can be picked up!'
    };
  }

  // Rule 4, 10, 11: Need 41 points AND at least 1 valid Tris
  const pointsInfo = calculateHandPoints(hand);
  const trisList = findHandTris(hand, jokerRank);

  // If special 41 (4 Aces or JQKA), that already forms a valid group
  if (pointsInfo.hasSpecial41 && pointsInfo.specialReason && pointsInfo.specialReason.includes('Quatris')) {
    return {
      canDraw: true,
      reason: pointsInfo.specialReason
    };
  }

  if (pointsInfo.total >= 41 && trisList.length > 0) {
    return {
      canDraw: true,
      reason: `41 points (${pointsInfo.total}) + ${trisList.length} Tris available`
    };
  }

  return {
    canDraw: false,
    reason: `Need $\\ge$ 41 points & 1 Tris (Current: ${pointsInfo.total} pts, Tris: ${trisList.length})`
  };
}

/**
 * Checks if a player can declare "CONQUER" (Win) with their arranged melds.
 * Complete 13 cards partitioned into valid melds:
 * e.g., 4 + 3 + 3 + 3 = 13 cards (or 4 + 4 + 3) + 1 card to GEBI.
 */
function validateConquerHand(melds, gebiCard, jokerRank, baseCard, jokerSuits = null) {
  if (!gebiCard) return { valid: false, message: 'You must select a final card to discard!' };
  if (!melds || melds.length < 3) return { valid: false, message: 'Must have at least 3 valid melds (Tris/Quatris)!' };

  let totalCardsCount = 0;
  for (const group of melds) {
    if (group.length === 3) {
      if (!isValidTris(group, jokerRank, jokerSuits)) {
        return { valid: false, message: 'One of your 3-card groups is not a valid Tris!' };
      }
    } else if (group.length === 4) {
      if (!isValidQuatris(group, jokerRank, jokerSuits)) {
        return { valid: false, message: 'One of your 4-card groups is not a valid Quatris!' };
      }
    } else {
      return { valid: false, message: 'Melds must be exactly 3 cards (Tris) or 4 cards (Quatris)!' };
    }
    totalCardsCount += group.length;
  }

  if (totalCardsCount !== 13) {
    return { valid: false, message: `Your melded cards must equal exactly 13 (current: ${totalCardsCount})!` };
  }

  return { valid: true, message: 'CONQUER! Valid winning hand!' };
}

/**
 * Rule: GEBI (ገቢ) Detection
 * Checks if a card can attach to an existing table meld (extends sequence or completes 4-set).
 * If true, this card CANNOT be discarded to ground (የተወረደ ሜልድ ላይ ገቢ የሚሆን ካርታ መሬት ላይ መጣል አይቻልም)!
 */
function isCardGebiToMeld(card, meld, jokerRank, jokerSuits) {
  if (!card || !meld || meld.length < 3) return false;

  const isJk = (c) => isWildJoker(c, jokerRank, jokerSuits);
  const naturals = meld.filter(c => !isJk(c));
  if (naturals.length === 0) return false;

  // 1. Same-rank set of 3 cards (can take 4th card of same rank)
  const isSet = naturals.every(c => (c.isFalseJoker ? jokerRank : c.rank) === (naturals[0].isFalseJoker ? jokerRank : naturals[0].rank));
  if (isSet && meld.length === 3) {
    const setRank = naturals[0].isFalseJoker ? jokerRank : naturals[0].rank;
    const cardRank = card.isFalseJoker ? jokerRank : card.rank;
    if (cardRank === setRank && meld.every(c => c.suit !== card.suit)) {
      return true;
    }
  }

  // 2. Same-suit sequence (can extend on either end, including assigned/placed Joker positions)
  const isSeq = naturals.every(c => c.suit === naturals[0].suit);
  if (isSeq) {
    const suit = naturals[0].suit;
    if (card.suit !== suit && !(card.isFalseJoker && (!jokerSuits || jokerSuits.includes(suit)))) return false;

    const cardRankEff = card.isFalseJoker ? jokerRank : card.rank;
    const cardNum1 = RANK_ORDER[cardRankEff];
    const cardNum14 = cardRankEff === 'A' ? 14 : RANK_ORDER[cardRankEff];

    const jokersInMeld = meld.filter(isJk);
    const baseRanks = naturals.map(c => (c.isFalseJoker ? jokerRank : c.rank));

    const checkWithExtraRanks = (ranksList) => {
      const numsAs1 = ranksList.map(r => RANK_ORDER[r]).filter(Boolean).sort((a, b) => a - b);
      if (numsAs1.length > 0 && !numsAs1.includes(cardNum1)) {
        if (cardNum1 === numsAs1[0] - 1 || cardNum1 === numsAs1[numsAs1.length - 1] + 1) return true;
      }
      const numsAs14 = ranksList.map(r => (r === 'A' ? 14 : RANK_ORDER[r])).filter(Boolean).sort((a, b) => a - b);
      if (numsAs14.length > 0 && !numsAs14.includes(cardNum14)) {
        if (cardNum14 === numsAs14[0] - 1 || cardNum14 === numsAs14[numsAs14.length - 1] + 1) return true;
      }
      return false;
    };

    const assignedJokers = jokersInMeld.filter(jk => jk.assignedCard && jk.assignedCard.rank);
    if (assignedJokers.length === jokersInMeld.length) {
      return checkWithExtraRanks([...baseRanks, ...assignedJokers.map(jk => jk.assignedCard.rank)]);
    }

    // Fallback if a Joker in the meld has no assignedCard yet: check each valid Joker placement
    const jkOpts = getJokerReplacementOptions(meld, jokerRank, jokerSuits);
    if (jkOpts.length > 0) {
      return jkOpts.some(opt => checkWithExtraRanks([...baseRanks, opt.rank]));
    }
    return checkWithExtraRanks(baseRanks);
  }

  return false;
}

function isCardGebiToTable(card, tableMelds, jokerRank, jokerSuits) {
  if (!card || !tableMelds) return false;
  const allGroups = [];
  if (Array.isArray(tableMelds)) {
    allGroups.push(...tableMelds);
  } else {
    for (const key of Object.keys(tableMelds)) {
      if (Array.isArray(tableMelds[key])) {
        allGroups.push(...tableMelds[key]);
      }
    }
  }

  for (const group of allGroups) {
    if (isCardGebiToMeld(card, group, jokerRank, jokerSuits)) {
      return true;
    }
  }
  return false;
}

function getJokerReplacementOptions(meld, jokerRank, jokerSuits) {
  if (!meld || meld.length < 3) return [];
  const isJk = (c) => isWildJoker(c, jokerRank, jokerSuits);
  const jokers = meld.filter(isJk);
  if (jokers.length !== 1) return [];

  const naturals = meld.filter(c => !isJk(c));
  if (naturals.length < 2) return [];
  const getRank = (c) => (c.isFalseJoker ? jokerRank : c.rank);

  // Case 1: Same-rank set (e.g. 7♥ 7♦ + Joker)
  const firstRank = getRank(naturals[0]);
  if (firstRank && naturals.every(c => getRank(c) === firstRank)) {
    const usedSuits = new Set(naturals.map(c => c.suit));
    const allSuits = ['♠', '♥', '♦', '♣'];
    return allSuits.filter(s => !usedSuits.has(s)).map(suit => ({ rank: firstRank, suit }));
  }

  // Case 2: Same-suit sequence (e.g. 3♥ 4♥ + Joker -> 2♥ or 5♥)
  const suit = naturals[0].suit;
  if (!naturals.every(c => c.suit === suit)) return [];

  const numToRank = (n) => {
    if (n === 1 || n === 14) return 'A';
    if (n === 11) return 'J';
    if (n === 12) return 'Q';
    if (n === 13) return 'K';
    return String(n);
  };

  const options = [];
  const seen = new Set();
  const addOpt = (rank) => {
    const key = `${rank}${suit}`;
    if (!seen.has(key)) {
      seen.add(key);
      options.push({ rank, suit });
    }
  };

  const checkOrder = (orderFn) => {
    const nums = naturals.map(c => orderFn(getRank(c))).sort((a, b) => a - b);
    for (let i = 0; i < nums.length - 1; i++) {
      if (nums[i] === nums[i + 1]) return;
    }
    const min = nums[0];
    const max = nums[nums.length - 1];
    const span = max - min + 1;
    const missing = [];
    for (let n = min; n <= max; n++) {
      if (!nums.includes(n)) missing.push(n);
    }
    if (missing.length === 1 && span === meld.length) {
      addOpt(numToRank(missing[0]));
    } else if (missing.length === 0 && span === meld.length - 1) {
      if (min - 1 >= 1) addOpt(numToRank(min - 1));
      if (max + 1 <= 14) addOpt(numToRank(max + 1));
    }
  };

  checkOrder(r => RANK_ORDER[r]);
  checkOrder(r => (r === 'A' ? 14 : RANK_ORDER[r]));
  return options;
}

function sortMeldCards(meld, jokerRank, jokerSuits) {
  if (!meld || meld.length <= 1) return meld;
  const isJk = (c) => isWildJoker(c, jokerRank, jokerSuits);
  const naturals = meld.filter(c => !isJk(c));
  if (naturals.length === 0) return meld;

  const getRank = (c) => (c.isFalseJoker ? jokerRank : c.rank);
  const firstRank = getRank(naturals[0]);
  if (firstRank && naturals.every(c => getRank(c) === firstRank)) {
    // Same-rank set: keep naturals first, sorted by suit, then any joker
    const suitOrder = { '♠': 1, '♥': 2, '♦': 3, '♣': 4 };
    const sortedNat = [...naturals].sort((a, b) => (suitOrder[a.suit] || 9) - (suitOrder[b.suit] || 9));
    const jokers = meld.filter(isJk);
    return [...sortedNat, ...jokers];
  }

  // Sequence: determine whether Ace is high (14) or low (1)
  const hasHighFace = naturals.some(c => ['10', 'J', 'Q', 'K'].includes(getRank(c)));
  const has2 = naturals.some(c => getRank(c) === '2');
  const getOrder = (rank) => (rank === 'A' && hasHighFace && !has2 ? 14 : (RANK_ORDER[rank] || 0));

  const getCardSortVal = (c) => {
    if (isJk(c)) {
      if (c.assignedCard && c.assignedCard.rank) {
        return getOrder(c.assignedCard.rank);
      }
      return 99;
    }
    return getOrder(getRank(c));
  };

  return [...meld].sort((a, b) => getCardSortVal(a) - getCardSortVal(b));
}

function isValidDubePair(c1, c2, jokerRank, jokerSuits) {
  const jk1 = isWildJoker(c1, jokerRank, jokerSuits);
  const jk2 = isWildJoker(c2, jokerRank, jokerSuits);
  if (jk1 || jk2) return true;
  const r1 = c1.isFalseJoker ? jokerRank : c1.rank;
  const r2 = c2.isFalseJoker ? jokerRank : c2.rank;
  return r1 === r2 && c1.suit === c2.suit;
}

function partitionIntoDubePairs(cards, jokerRank, jokerSuits) {
  if (cards.length === 0) return [];
  const first = cards[0];
  for (let i = 1; i < cards.length; i++) {
    if (isValidDubePair(first, cards[i], jokerRank, jokerSuits)) {
      const rest = cards.filter((_, idx) => idx !== 0 && idx !== i);
      const sub = partitionIntoDubePairs(rest, jokerRank, jokerSuits);
      if (sub) return [[first, cards[i]], ...sub];
    }
  }
  return null;
}

/**
 * Dube (ዱቤ): 1 valid Tris (3 cards) + 5 identical pairs (10 cards) = 13 cards.
 * Allowed ONLY when the player has NOT laid down any melds on the table yet.
 */
function findDubeWin(cards13, jokerRank, jokerSuits) {
  if (!cards13 || cards13.length !== 13) return null;
  const n = cards13.length;
  for (let i = 0; i < n - 2; i++) {
    for (let j = i + 1; j < n - 1; j++) {
      for (let k = j + 1; k < n; k++) {
        const tris = [cards13[i], cards13[j], cards13[k]];
        if (isValidTris(tris, jokerRank, jokerSuits)) {
          const rest = cards13.filter((_, idx) => idx !== i && idx !== j && idx !== k);
          const pairs = partitionIntoDubePairs(rest, jokerRank, jokerSuits);
          if (pairs && pairs.length === 5) {
            return { valid: true, tris, pairs };
          }
        }
      }
    }
  }
  return null;
}

function getMeldPoints(meld, jokerRank, jokerSuits) {
  if (!meld || meld.length === 0) return 0;
  const isJk = (c) => isWildJoker(c, jokerRank, jokerSuits);
  const jkOpts = getJokerReplacementOptions(meld, jokerRank, jokerSuits);
  let total = 0;
  for (const c of meld) {
    if (c.isFalseJoker) {
      total += jokerRank ? getCardPointValue(jokerRank) : (c.pointValue || 0);
    } else if (isJk(c)) {
      if (c.assignedCard && c.assignedCard.rank) {
        total += getCardPointValue(c.assignedCard.rank);
      } else if (jkOpts.length > 0) {
        total += Math.max(...jkOpts.map(o => getCardPointValue(o.rank)));
      } else {
        total += c.pointValue || 0;
      }
    } else {
      total += c.pointValue || getCardPointValue(c.rank);
    }
  }
  return total;
}

module.exports = {
  isWildJoker,
  isNaturalMeld,
  isSequenceSameSuit,
  isValidTris,
  isValidQuatris,
  calculateHandPoints,
  findHandTris,
  canDrawFromGround,
  validateConquerHand,
  isCardGebiToMeld,
  isCardGebiToTable,
  getJokerReplacementOptions,
  sortMeldCards,
  findDubeWin,
  getMeldPoints
};

