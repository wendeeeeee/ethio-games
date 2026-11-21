// engine/sekaRules.js
const { SUITS, SUIT_NAMES, SUIT_COLORS, RANKS, RANK_ORDER, shuffleDeck } = require('./cardTypes');

/**
 * Creates a standard Seka deck:
 * 52 standard cards + 2 Printed Wild Jokers = 54 cards total.
 * In Seka, jokers are wild jokers with no blind-cut or naming.
 */
function createSekaDeck() {
  const deck = [];
  let id = 1;

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        id: `seka_${suit}_${rank}_${id++}`,
        suit,
        rank,
        suitName: SUIT_NAMES[suit],
        color: SUIT_COLORS[suit],
        isJoker: false
      });
    }
  }

  // 2 Wild Jokers
  deck.push({
    id: `seka_joker_red_${id++}`,
    suit: '🃏',
    rank: 'JOKER',
    suitName: 'joker',
    color: 'red',
    isJoker: true
  });

  deck.push({
    id: `seka_joker_black_${id++}`,
    suit: '🃏',
    rank: 'JOKER',
    suitName: 'joker',
    color: 'black',
    isJoker: true
  });

  return deck;
}

/**
 * Checks if a card is a wild joker in Seka
 */
function isSekaJoker(card) {
  if (!card) return false;
  return card.isJoker === true || card.rank === 'JOKER' || card.suit === '🃏';
}

/**
 * Helper: checks if an array of numbers are consecutive (step = 1)
 */
function isConsecutive(numbers) {
  for (let i = 0; i < numbers.length - 1; i++) {
    if (numbers[i + 1] - numbers[i] !== 1) return false;
  }
  return true;
}

/**
 * Helper: checks if natural cards of the same suit can form a consecutive sequence with wild jokers.
 * Target length is cards.length (natural + jokers).
 */
function canFormSuitedSequenceWithJokers(naturalCards, jokerCount, targetLength) {
  if (naturalCards.length === 0) return false;
  const suit = naturalCards[0].suit;
  if (!naturalCards.every(c => c.suit === suit)) return false;

  const testSequence = (rankMap) => {
    const nums = naturalCards.map(c => rankMap(c.rank)).sort((a, b) => a - b);
    // Check for duplicates in natural cards
    for (let i = 0; i < nums.length - 1; i++) {
      if (nums[i] === nums[i + 1]) return false;
    }
    const span = nums[nums.length - 1] - nums[0] + 1;
    const missing = span - nums.length;
    return span <= targetLength && missing <= jokerCount;
  };

  // Ace low (A = 1)
  const aceAs1 = testSequence(r => RANK_ORDER[r]);
  if (aceAs1) return true;

  // Ace high (A = 14)
  const aceAs14 = testSequence(r => (r === 'A' ? 14 : RANK_ORDER[r]));
  if (aceAs14) return true;

  return false;
}

/**
 * Validates a Seka Tris (exactly 3 cards).
 * Rule: MUST be a suited sequence (ጦር) - e.g. 5♥ 6♥ 7♥ or 5♥ Joker 7♥.
 * Sets of same rank (e.g. 7-7-7) are STRICTLY REJECTED!
 * Max 1 Joker per Tris.
 */
function isValidSekaTris(cards) {
  if (!cards || cards.length !== 3) return false;

  const jokers = cards.filter(isSekaJoker);
  const natural = cards.filter(c => !isSekaJoker(c));

  // Max 1 joker per Tris
  if (jokers.length > 1) return false;

  // Case 1: Pure natural sequence (0 jokers)
  if (jokers.length === 0) {
    const suit = natural[0].suit;
    if (!natural.every(c => c.suit === suit)) return false;

    // Check Ace as 1
    const order1 = natural.map(c => RANK_ORDER[c.rank]).sort((a, b) => a - b);
    if (isConsecutive(order1)) return true;

    // Check Ace as 14
    const order14 = natural.map(c => (c.rank === 'A' ? 14 : RANK_ORDER[c.rank])).sort((a, b) => a - b);
    if (isConsecutive(order14)) return true;

    return false;
  }

  // Case 2: 1 Joker + 2 natural cards of the same suit
  if (jokers.length === 1) {
    return canFormSuitedSequenceWithJokers(natural, 1, 3);
  }

  return false;
}

/**
 * Validates a Seka Quatris (exactly 4 cards).
 * Rule: MUST be a suited sequence (ጦር) - e.g. 7♦ 8♦ 9♦ 10♦ or 7♦ Joker 9♦ 10♦.
 * Sets of same rank (e.g. 7-7-7-7) are STRICTLY REJECTED!
 * Max 1 Joker per Quatris.
 */
function isValidSekaQuatris(cards) {
  if (!cards || cards.length !== 4) return false;

  const jokers = cards.filter(isSekaJoker);
  const natural = cards.filter(c => !isSekaJoker(c));

  // Max 1 joker per Quatris
  if (jokers.length > 1) return false;

  // Case 1: Pure natural sequence (0 jokers)
  if (jokers.length === 0) {
    const suit = natural[0].suit;
    if (!natural.every(c => c.suit === suit)) return false;

    // Check Ace as 1
    const order1 = natural.map(c => RANK_ORDER[c.rank]).sort((a, b) => a - b);
    if (isConsecutive(order1)) return true;

    // Check Ace as 14
    const order14 = natural.map(c => (c.rank === 'A' ? 14 : RANK_ORDER[c.rank])).sort((a, b) => a - b);
    if (isConsecutive(order14)) return true;

    return false;
  }

  // Case 2: 1 Joker + 3 natural cards of the same suit
  if (jokers.length === 1) {
    return canFormSuitedSequenceWithJokers(natural, 1, 4);
  }

  return false;
}

/**
 * Arranges a single Seka suited sequence meld (Tris or Quatris)
 * in ascending order, placing wild jokers in the exact gap or flank.
 */
function arrangeSekaMeld(cards) {
  if (!cards || cards.length <= 1) return cards || [];
  const jokers = cards.filter(isSekaJoker);
  const natural = cards.filter(c => !isSekaJoker(c));

  if (jokers.length === 0) {
    const hasA = natural.some(c => c.rank === 'A');
    const hasKOrQ = natural.some(c => c.rank === 'K' || c.rank === 'Q');
    const isAceHigh = hasA && hasKOrQ;
    const rankFn = (c) => (isAceHigh && c.rank === 'A' ? 14 : RANK_ORDER[c.rank]);
    return [...natural].sort((a, b) => rankFn(a) - rankFn(b));
  }

  const joker = jokers[0];
  const hasA = natural.some(c => c.rank === 'A');
  const hasKOrQ = natural.some(c => c.rank === 'K' || c.rank === 'Q');
  const isAceHigh = hasA && hasKOrQ;
  const rankFn = (c) => (isAceHigh && c.rank === 'A' ? 14 : RANK_ORDER[c.rank]);
  const sortedNatural = [...natural].sort((a, b) => rankFn(a) - rankFn(b));

  let gapIndex = -1;
  for (let i = 0; i < sortedNatural.length - 1; i++) {
    const diff = rankFn(sortedNatural[i + 1]) - rankFn(sortedNatural[i]);
    if (diff === 2) {
      gapIndex = i;
      break;
    }
  }

  if (gapIndex !== -1) {
    const result = [...sortedNatural];
    result.splice(gapIndex + 1, 0, joker);
    return result;
  }

  const highest = rankFn(sortedNatural[sortedNatural.length - 1]);
  if (highest >= 13) {
    return [joker, ...sortedNatural];
  }

  return [...sortedNatural, joker];
}

/**
 * Intelligently arranges a full Seka hand:
 * - Detects winning combination (2 Tris + 1 Quatris + 1 Discard)
 * - Or groups suited sequences (ጦር) putting Jokers in exact spots
 * - Groups remaining cards by suit in numerical order
 */
function arrangeSekaHandOptimal(hand) {
  if (!hand || hand.length <= 1) return { arrangedCards: hand || [], isWin: false };

  // 1. Check if winning hand
  const winCheck = validateSekaWinningHand(hand);
  if (winCheck.valid) {
    const arrangedMelds = winCheck.melds.map(m => arrangeSekaMeld(m.cards));
    const flatMelds = arrangedMelds.flat();
    const result = [...flatMelds];
    if (winCheck.discardedCard) {
      result.push({ ...winCheck.discardedCard, isTetay: true });
    }
    return {
      arrangedCards: result,
      isWin: true,
      melds: arrangedMelds,
      discardedCard: winCheck.discardedCard
    };
  }

  // 2. Partial arrangement during gameplay
  const jokers = hand.filter(isSekaJoker);
  let availableJokers = [...jokers];
  const natural = hand.filter(c => !isSekaJoker(c));

  // Group natural cards by suit
  const suits = ['♠', '♥', '♦', '♣'];
  const bySuit = {};
  suits.forEach(s => bySuit[s] = []);
  natural.forEach(c => {
    if (bySuit[c.suit]) bySuit[c.suit].push(c);
  });

  const arrangedGroups = [];

  // In each suit, find complete sequences or gap pairs that need Joker
  for (const s of suits) {
    const suitNatural = bySuit[s];
    const hasA = suitNatural.some(c => c.rank === 'A');
    const hasHigh = suitNatural.some(c => ['K', 'Q', 'J', '10'].includes(c.rank));
    const hasLow = suitNatural.some(c => ['2', '3', '4', '5'].includes(c.rank));
    const isAceHigh = hasA && hasHigh && !hasLow;
    const rankFn = (c) => (isAceHigh && c.rank === 'A' ? 14 : (RANK_ORDER[c.rank] || 0));

    const suitCards = suitNatural.sort((a, b) => rankFn(a) - rankFn(b));
    let usedInSuit = new Set();

    // 0. Check natural complete 4-card Quatris sequence FIRST (e.g. J-Q-K-A, 7-8-9-10)
    for (let i = 0; i <= suitCards.length - 4; i++) {
      const quad = suitCards.slice(i, i + 4);
      if (isValidSekaQuatris(quad) && !quad.some(c => usedInSuit.has(c.id))) {
        arrangedGroups.push(arrangeSekaMeld(quad));
        quad.forEach(c => usedInSuit.add(c.id));
      }
    }
    // Also check Ace-high Quatris wrapping (J-Q-K then A at start of sorted array)
    if (suitCards.length >= 4) {
      const aceCard = suitCards.find(c => c.rank === 'A' && !usedInSuit.has(c.id));
      if (aceCard) {
        const highCards = suitCards.filter(c => !usedInSuit.has(c.id) && ['J', 'Q', 'K'].includes(c.rank));
        if (highCards.length >= 3) {
          const quad = [...highCards.slice(0, 3), aceCard];
          if (isValidSekaQuatris(quad)) {
            arrangedGroups.push(arrangeSekaMeld(quad));
            quad.forEach(c => usedInSuit.add(c.id));
          }
        }
      }
    }

    // 1. Check natural complete 3-card Tris in this suit
    const remForTris = suitCards.filter(c => !usedInSuit.has(c.id));
    for (let i = 0; i <= remForTris.length - 3; i++) {
      const trio = remForTris.slice(i, i + 3);
      if (isValidSekaTris(trio) && !trio.some(c => usedInSuit.has(c.id))) {
        arrangedGroups.push(arrangeSekaMeld(trio));
        trio.forEach(c => usedInSuit.add(c.id));
      }
    }
    // 1b. Check Ace-high Tris (Q-K-A) that may not be caught by consecutive slicing
    if (remForTris.length >= 3) {
      const aceCard = remForTris.find(c => c.rank === 'A' && !usedInSuit.has(c.id));
      if (aceCard) {
        const kCard = remForTris.find(c => c.rank === 'K' && !usedInSuit.has(c.id));
        const qCard = remForTris.find(c => c.rank === 'Q' && !usedInSuit.has(c.id));
        if (kCard && qCard) {
          const aceHighTrio = [qCard, kCard, aceCard];
          if (isValidSekaTris(aceHighTrio)) {
            arrangedGroups.push(arrangeSekaMeld(aceHighTrio));
            aceHighTrio.forEach(c => usedInSuit.add(c.id));
          }
        }
      }
    }

    // 2. Check 3-card gap with Joker forming Quatris
    if (availableJokers.length > 0) {
      const remForQuatrisJk = suitCards.filter(c => !usedInSuit.has(c.id));
      for (let i = 0; i < remForQuatrisJk.length - 2; i++) {
        for (let j = i + 1; j < remForQuatrisJk.length - 1; j++) {
          for (let k = j + 1; k < remForQuatrisJk.length; k++) {
            if (availableJokers.length === 0) break;
            const c1 = remForQuatrisJk[i], c2 = remForQuatrisJk[j], c3 = remForQuatrisJk[k];
            if (usedInSuit.has(c1.id) || usedInSuit.has(c2.id) || usedInSuit.has(c3.id)) continue;
            const jk = availableJokers[0];
            if (isValidSekaQuatris([c1, c2, c3, jk])) {
              arrangedGroups.push(arrangeSekaMeld([c1, c2, c3, jk]));
              usedInSuit.add(c1.id); usedInSuit.add(c2.id); usedInSuit.add(c3.id);
              availableJokers.shift();
            }
          }
        }
      }
    }

    // 3. Check 2-card gap pairs with Joker for Tris
    if (availableJokers.length > 0) {
      const remSuitCards = suitCards.filter(c => !usedInSuit.has(c.id));
      for (let i = 0; i < remSuitCards.length; i++) {
        for (let j = i + 1; j < remSuitCards.length; j++) {
          if (availableJokers.length === 0) break;
          const c1 = remSuitCards[i];
          const c2 = remSuitCards[j];
          if (usedInSuit.has(c1.id) || usedInSuit.has(c2.id)) continue;

          // Test if c1, c2, joker form valid Tris
          const jk = availableJokers[0];
          if (isValidSekaTris([c1, c2, jk])) {
            const arrangedTrio = arrangeSekaMeld([c1, c2, jk]);
            arrangedGroups.push(arrangedTrio);
            usedInSuit.add(c1.id);
            usedInSuit.add(c2.id);
            availableJokers.shift(); // Joker used
          }
        }
      }
    }

    // Remaining natural cards in this suit
    const leftoverSuit = suitCards.filter(c => !usedInSuit.has(c.id));
    if (leftoverSuit.length > 0) {
      arrangedGroups.push(leftoverSuit);
    }
  }

  // If there are still unused jokers: NEVER place them consecutively (ተከታታይ ጆከር ማድረግ አይቻልም)!
  if (availableJokers.length === 1) {
    arrangedGroups.push([availableJokers[0]]);
  } else if (availableJokers.length > 1) {
    // If 2 jokers are unused, separate them so they are never side-by-side
    if (arrangedGroups.length >= 2) {
      arrangedGroups[0].push(availableJokers[0]);
      arrangedGroups[arrangedGroups.length - 1].push(availableJokers[1]);
    } else {
      arrangedGroups.unshift([availableJokers[0]]);
      arrangedGroups.push([availableJokers[1]]);
    }
  }

  return {
    arrangedCards: arrangedGroups.flat(),
    isWin: false
  };
}

/**
 * Validates if 10 cards can be partitioned into:
 * 2 Seka Tris (3 cards each) and 1 Seka Quatris (4 cards).
 * Returns { valid: true, melds: [tris1, tris2, quatris] } or { valid: false }.
 */
function partition10CardsIntoSekaMelds(cards) {
  if (!cards || cards.length !== 10) return { valid: false };

  // Helper combinations: generate all combinations of size k from array
  function getCombinations(arr, k) {
    const result = [];
    function backtrack(start, current) {
      if (current.length === k) {
        result.push([...current]);
        return;
      }
      for (let i = start; i < arr.length; i++) {
        current.push(arr[i]);
        backtrack(i + 1, current);
        current.pop();
      }
    }
    backtrack(0, []);
    return result;
  }

  // 1. Pick 4 cards for Quatris (10 choose 4 = 210 combinations)
  const indices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const quatrisIndexCombos = getCombinations(indices, 4);

  for (const qIndices of quatrisIndexCombos) {
    const qIndexSet = new Set(qIndices);
    const quatrisCards = qIndices.map(i => cards[i]);

    if (!isValidSekaQuatris(quatrisCards)) continue;

    // Remaining 6 cards
    const remainingIndices = indices.filter(i => !qIndexSet.has(i));
    const remCombos = getCombinations(remainingIndices, 3);

    for (const t1Indices of remCombos) {
      const t1Set = new Set(t1Indices);
      const t2Indices = remainingIndices.filter(i => !t1Set.has(i));

      const tris1Cards = t1Indices.map(i => cards[i]);
      const tris2Cards = t2Indices.map(i => cards[i]);

      if (isValidSekaTris(tris1Cards) && isValidSekaTris(tris2Cards)) {
        return {
          valid: true,
          melds: [
            { type: 'TRIS', cards: arrangeSekaMeld(tris1Cards) },
            { type: 'TRIS', cards: arrangeSekaMeld(tris2Cards) },
            { type: 'QUATRIS', cards: arrangeSekaMeld(quatrisCards) }
          ]
        };
      }
    }
  }

  return { valid: false };
}

/**
 * Validates a winning hand in Seka:
 * Hand contains 11 cards.
 * If discardedCard is passed: remaining 10 cards must partition into 2 Tris + 1 Quatris.
 * If discardedCard is NOT passed: checks if ANY of the 11 cards can serve as the discard (ተጣይ)
 * leaving 10 cards that partition into 2 Tris + 1 Quatris.
 */
function validateSekaWinningHand(hand, discardedCard = null) {
  if (!hand || (hand.length !== 10 && hand.length !== 11)) {
    return { valid: false, message: 'Invalid card count for winning check' };
  }

  // If hand is 10 cards, check directly
  if (hand.length === 10) {
    const partition = partition10CardsIntoSekaMelds(hand);
    if (partition.valid) {
      return {
        valid: true,
        melds: partition.melds,
        discardedCard: null
      };
    }
    return { valid: false, message: 'Cards do not form 2 Tris and 1 Quatris' };
  }

  // Hand is 11 cards
  if (discardedCard) {
    const discardId = String(discardedCard.id || discardedCard);
    const remCards = hand.filter(c => String(c.id) !== discardId);
    if (remCards.length !== 10) {
      return { valid: false, message: 'Could not isolate 10 cards with specified discard' };
    }
    const partition = partition10CardsIntoSekaMelds(remCards);
    if (partition.valid) {
      const discCardObj = hand.find(c => String(c.id) === discardId);
      return {
        valid: true,
        melds: partition.melds,
        discardedCard: discCardObj
      };
    }
    return { valid: false, message: 'Remaining 10 cards do not form 2 Tris and 1 Quatris' };
  }

  // Check all possible 11 cards as discard
  for (let i = 0; i < hand.length; i++) {
    const testDiscard = hand[i];
    const remCards = hand.filter((_, idx) => idx !== i);
    const partition = partition10CardsIntoSekaMelds(remCards);
    if (partition.valid) {
      return {
        valid: true,
        melds: partition.melds,
        discardedCard: testDiscard
      };
    }
  }

  return { valid: false, message: 'Hand does not have a valid Seka win (2 Tris + 1 Quatris + 1 Discard)' };
}

module.exports = {
  createSekaDeck,
  isSekaJoker,
  isValidSekaTris,
  isValidSekaQuatris,
  arrangeSekaMeld,
  arrangeSekaHandOptimal,
  partition10CardsIntoSekaMelds,
  validateSekaWinningHand,
  shuffleDeck
};
