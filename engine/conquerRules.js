// engine/conquerRules.js
const { RANK_ORDER } = require('./cardTypes');

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
    const cardsWithRanks = naturalCards.map(c => ({ rank: getRank(c), suit: c.suit }));
    if (isSequenceSameSuit(cardsWithRanks)) return true;
  }

  // Case 2: Tris with 1 Joker
  if (jokerCount === 1) {
    const r0 = getRank(naturalCards[0]);
    const r1 = getRank(naturalCards[1]);
    if (r0 && r0 === r1) {
      return true; // Joker acts as the 3rd card of that rank
    }
    if (naturalCards[0].suit === naturalCards[1].suit) {
      if (canFormSequenceWithJoker([
        { rank: r0, suit: naturalCards[0].suit },
        { rank: r1, suit: naturalCards[1].suit }
      ], 1, 3)) return true;
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
    const cardsWithRanks = naturalCards.map(c => ({ rank: getRank(c), suit: c.suit }));
    if (isSequenceSameSuit(cardsWithRanks)) return true;
  }

  // Case 2: Quatris with 1 Joker
  if (jokerCount === 1) {
    const r0 = getRank(naturalCards[0]);
    if (r0 && naturalCards.every(c => getRank(c) === r0)) {
      return true;
    }
    if (naturalCards.every(c => c.suit === naturalCards[0].suit)) {
      if (canFormSequenceWithJoker(naturalCards.map(c => ({ rank: getRank(c), suit: c.suit })), 1, 4)) return true;
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

  // 2. Same-suit sequence (can extend on either end)
  const isSeq = naturals.every(c => c.suit === naturals[0].suit);
  if (isSeq) {
    const suit = naturals[0].suit;
    if (card.suit !== suit) return false;

    // Rank numbers with Ace as 1
    const numsAs1 = naturals.map(c => RANK_ORDER[c.rank]).sort((a, b) => a - b);
    const min1 = numsAs1[0];
    const max1 = numsAs1[numsAs1.length - 1];
    const cardNum1 = RANK_ORDER[card.rank];

    if (cardNum1 === min1 - 1 || cardNum1 === max1 + 1) return true;

    // Rank numbers with Ace as 14 (Ace High)
    const numsAs14 = naturals.map(c => (c.rank === 'A' ? 14 : RANK_ORDER[c.rank])).sort((a, b) => a - b);
    const min14 = numsAs14[0];
    const max14 = numsAs14[numsAs14.length - 1];
    const cardNum14 = card.rank === 'A' ? 14 : RANK_ORDER[card.rank];

    if (cardNum14 === min14 - 1 || cardNum14 === max14 + 1) return true;
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
  isCardGebiToTable
};

