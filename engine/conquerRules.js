// engine/conquerRules.js
const { RANK_ORDER } = require('./cardTypes');

/**
 * Checks if a group of 3 cards forms a valid Tris (Set or Sequence).
 * Enforces Rule 14: Maximum 1 Joker per Tris!
 */
function isValidTris(cards, jokerRank) {
  if (!cards || cards.length !== 3) return false;

  const jokerCount = cards.filter(c => c.rank === jokerRank || c.isJoker).length;
  // Rule 14: Cannot use 2 or more jokers in the same Tris!
  if (jokerCount > 1) return false;

  const naturalCards = cards.filter(c => c.rank !== jokerRank && !c.isJoker);

  // Case 1: Pure Tris (Set of 3 same rank, different suits)
  if (jokerCount === 0) {
    if (naturalCards[0].rank === naturalCards[1].rank && naturalCards[1].rank === naturalCards[2].rank) {
      // Must be different suits (or duplicate allowed if 2 decks, but standard Tris has different suits)
      const suits = new Set(naturalCards.map(c => c.suit));
      return suits.size >= 2; // Valid set
    }
    // Or Pure Sequence of 3 (same suit, consecutive)
    if (isSequenceSameSuit(naturalCards)) return true;
  }

  // Case 2: Tris with 1 Joker
  if (jokerCount === 1) {
    // 2 natural cards of the same rank
    if (naturalCards[0].rank === naturalCards[1].rank) {
      return true; // Joker acts as the 3rd card of that rank
    }
    // Or 2 natural cards of same suit that can form a 3-sequence with 1 joker
    if (naturalCards[0].suit === naturalCards[1].suit) {
      if (canFormSequenceWithJoker(naturalCards, 1, 3)) return true;
    }
  }

  return false;
}

/**
 * Checks if a group of 4 cards forms a valid Quatris (Set or Sequence).
 * Enforces Rule 14: Maximum 1 Joker per Quatris!
 */
function isValidQuatris(cards, jokerRank) {
  if (!cards || cards.length !== 4) return false;

  const jokerCount = cards.filter(c => c.rank === jokerRank || c.isJoker).length;
  // Rule 14: Cannot use 2 or more jokers in the same Quatris!
  if (jokerCount > 1) return false;

  const naturalCards = cards.filter(c => c.rank !== jokerRank && !c.isJoker);

  // Case 1: Pure Quatris (4 same rank or 4 sequence same suit)
  if (jokerCount === 0) {
    if (naturalCards.every(c => c.rank === naturalCards[0].rank)) {
      const suits = new Set(naturalCards.map(c => c.suit));
      return suits.size >= 3;
    }
    if (isSequenceSameSuit(naturalCards)) return true;
  }

  // Case 2: Quatris with 1 Joker
  if (jokerCount === 1) {
    // 3 natural cards of same rank
    if (naturalCards.every(c => c.rank === naturalCards[0].rank)) {
      return true;
    }
    // 3 natural cards same suit forming sequence of 4 with 1 joker
    if (naturalCards.every(c => c.suit === naturalCards[0].suit)) {
      if (canFormSequenceWithJoker(naturalCards, 1, 4)) return true;
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
function validateConquerHand(melds, gebiCard, jokerRank, baseCard) {
  if (!gebiCard) return { valid: false, message: 'You must place a final card into GEBI!' };
  if (!melds || melds.length < 3) return { valid: false, message: 'Must have at least 3 valid melds (Tris/Quatris)!' };

  let totalCardsCount = 0;
  for (const group of melds) {
    if (group.length === 3) {
      if (!isValidTris(group, jokerRank)) {
        return { valid: false, message: 'One of your 3-card groups is not a valid Tris!' };
      }
    } else if (group.length === 4) {
      if (!isValidQuatris(group, jokerRank)) {
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

module.exports = {
  isValidTris,
  isValidQuatris,
  calculateHandPoints,
  findHandTris,
  canDrawFromGround,
  validateConquerHand
};

