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

  const hasA = natural.some(c => c.rank === 'A');
  const hasHigh = natural.some(c => ['K', 'Q', 'J'].includes(c.rank));
  const hasLow = natural.some(c => ['2', '3', '4', '5'].includes(c.rank));

  if (jokers.length === 0) {
    // Ace-bridge: both high (10/J/Q/K) and low (2/3/4/5) exist with Ace -> natural run [10, J, Q, K, A, 2, 3]
    if (hasA && hasHigh && hasLow) {
      const highCards = natural.filter(c => ['10', 'J', 'Q', 'K'].includes(c.rank)).sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);
      const aCards = natural.filter(c => c.rank === 'A');
      const lowCards = natural.filter(c => !['10', 'J', 'Q', 'K', 'A'].includes(c.rank)).sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);
      return [...highCards, ...aCards, ...lowCards];
    }

    const isAceHigh = hasA && hasHigh && !hasLow;
    const rankFn = (c) => (isAceHigh && c.rank === 'A' ? 14 : RANK_ORDER[c.rank]);
    return [...natural].sort((a, b) => rankFn(a) - rankFn(b));
  }

  const joker = jokers[0];
  if (hasA && hasHigh && hasLow) {
    const highCards = natural.filter(c => ['10', 'J', 'Q', 'K'].includes(c.rank)).sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);
    const aCards = natural.filter(c => c.rank === 'A');
    const lowCards = natural.filter(c => !['10', 'J', 'Q', 'K', 'A'].includes(c.rank)).sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);
    const baseSeq = [...highCards, ...aCards, ...lowCards];
    let gapIdx = -1;
    for (let i = 0; i < baseSeq.length - 1; i++) {
      if (getSekaRankDist(baseSeq[i].rank, baseSeq[i + 1].rank) === 2) {
        gapIdx = i;
        break;
      }
    }
    if (gapIdx !== -1) {
      const res = [...baseSeq];
      res.splice(gapIdx + 1, 0, joker);
      return res;
    }
    return [...baseSeq, joker];
  }

  const isAceHigh = hasA && hasHigh && !hasLow;
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
function getSekaRankDist(r1, r2) {
  const n1 = RANK_ORDER[r1] || 0;
  const n2 = RANK_ORDER[r2] || 0;
  const direct = Math.abs(n1 - n2);
  const circular1 = Math.abs((n1 === 1 ? 14 : n1) - (n2 === 1 ? 14 : n2));
  const circular2 = Math.abs(n1 - (n2 === 1 ? 14 : n2));
  const circular3 = Math.abs((n1 === 1 ? 14 : n1) - n2);
  return Math.min(direct, circular1, circular2, circular3);
}

function arrangeSekaHandOptimal(hand) {
  if (!hand || hand.length <= 1) return { arrangedCards: hand || [], isWin: false };

  // 1. Check if winning hand
  const winCheck = validateSekaWinningHand(hand);
  if (winCheck.valid) {
    const sortedMelds = [...winCheck.melds].sort((a, b) => b.cards.length - a.cards.length);
    const arrangedMelds = sortedMelds.map(m => arrangeSekaMeld(m.cards));
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

  // 2. Arrangement during gameplay (melds -> connected pairs -> same suit -> lone singles at far right)
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

  const quatrisGroups = [];
  const trisGroups = [];
  const sameSuitGroups = [];
  const singleCards = [];
  const usedIds = new Set();
  const suitCardsMap = {};

  // Phase 1: Check natural runs & melds in each suit
  for (const s of suits) {
    const suitNatural = bySuit[s];
    if (suitNatural.length === 0) continue;

    // Standard ascending order for natural meld checks
    const rankFn = (c) => (c.rank === 'A' ? 1 : (RANK_ORDER[c.rank] || 0));
    let suitCards = [...suitNatural].sort((a, b) => rankFn(a) - rankFn(b));

    // 0a. Check 6-card natural run FIRST: produces TWO TRIS! (e.g. 1-2-3-4-5-6 or 3-4-5-6-7-8)
    for (let i = 0; i <= suitCards.length - 6; i++) {
      const run6 = suitCards.slice(i, i + 6);
      const trio1 = run6.slice(0, 3);
      const trio2 = run6.slice(3, 6);
      if (isValidSekaTris(trio1) && isValidSekaTris(trio2) && !run6.some(c => usedIds.has(c.id))) {
        trisGroups.push(arrangeSekaMeld(trio1));
        trisGroups.push(arrangeSekaMeld(trio2));
        run6.forEach(c => usedIds.add(c.id));
      }
    }

    // 0b. Check natural complete 4-card Quatris sequence (e.g. J-Q-K-A, 7-8-9-10)
    const remForQuat = suitCards.filter(c => !usedIds.has(c.id));
    for (let i = 0; i <= remForQuat.length - 4; i++) {
      const quad = remForQuat.slice(i, i + 4);
      if (isValidSekaQuatris(quad) && !quad.some(c => usedIds.has(c.id))) {
        quatrisGroups.push(arrangeSekaMeld(quad));
        quad.forEach(c => usedIds.add(c.id));
      }
    }
    // Also check Ace-high Quatris wrapping (J-Q-K then A at start of sorted array)
    const remAceHighQuat = suitCards.filter(c => !usedIds.has(c.id));
    if (remAceHighQuat.length >= 4) {
      const aceCard = remAceHighQuat.find(c => c.rank === 'A' && !usedIds.has(c.id));
      if (aceCard) {
        const highCards = remAceHighQuat.filter(c => !usedIds.has(c.id) && ['J', 'Q', 'K'].includes(c.rank));
        if (highCards.length >= 3) {
          const quad = [...highCards.slice(0, 3), aceCard];
          if (isValidSekaQuatris(quad)) {
            quatrisGroups.push(arrangeSekaMeld(quad));
            quad.forEach(c => usedIds.add(c.id));
          }
        }
      }
    }

    // 1. Check natural complete 3-card Tris in this suit
    const remForTris = suitCards.filter(c => !usedIds.has(c.id));
    for (let i = 0; i <= remForTris.length - 3; i++) {
      const trio = remForTris.slice(i, i + 3);
      if (isValidSekaTris(trio) && !trio.some(c => usedIds.has(c.id))) {
        trisGroups.push(arrangeSekaMeld(trio));
        trio.forEach(c => usedIds.add(c.id));
      }
    }
    // 1b. Check Ace-high Tris (Q-K-A)
    const remAceHigh = suitCards.filter(c => !usedIds.has(c.id));
    if (remAceHigh.length >= 3) {
      const aceCard = remAceHigh.find(c => c.rank === 'A');
      const kCard = remAceHigh.find(c => c.rank === 'K');
      const qCard = remAceHigh.find(c => c.rank === 'Q');
      if (aceCard && kCard && qCard) {
        const aceHighTrio = [qCard, kCard, aceCard];
        if (isValidSekaTris(aceHighTrio)) {
          trisGroups.push(arrangeSekaMeld(aceHighTrio));
          aceHighTrio.forEach(c => usedIds.add(c.id));
        }
      }
    }

    // Now re-sort remaining unmelded cards with Ace-bridge or Ace-High
    const remAfterNatural = suitCards.filter(c => !usedIds.has(c.id));
    const hasA = remAfterNatural.some(c => c.rank === 'A');
    const hasHighToAce = remAfterNatural.some(c => ['Q', 'K'].includes(c.rank));
    const hasLowFromAce = remAfterNatural.some(c => ['2', '3', '4'].includes(c.rank));
    if (hasA && hasHighToAce && hasLowFromAce) {
      // Ace-bridge: High -> Ace -> Low -> other mid
      const highCards = remAfterNatural.filter(c => ['10', 'J', 'Q', 'K'].includes(c.rank)).sort((a, b) => (RANK_ORDER[a.rank] - RANK_ORDER[b.rank]));
      const aCards = remAfterNatural.filter(c => c.rank === 'A');
      const lowCards = remAfterNatural.filter(c => ['2', '3', '4'].includes(c.rank)).sort((a, b) => (RANK_ORDER[a.rank] - RANK_ORDER[b.rank]));
      const otherMidCards = remAfterNatural.filter(c => !['10', 'J', 'Q', 'K', 'A', '2', '3', '4'].includes(c.rank)).sort((a, b) => (RANK_ORDER[a.rank] - RANK_ORDER[b.rank]));
      suitCardsMap[s] = [...highCards, ...aCards, ...lowCards, ...otherMidCards];
    } else if (hasA && hasHighToAce && !hasLowFromAce) {
      // Ace-High: sort with Ace as 14 so it stays adjacent to high cards (e.g. J, Q, A or 10, J, Q, A)
      const rankHighFn = (c) => (c.rank === 'A' ? 14 : (RANK_ORDER[c.rank] || 0));
      suitCardsMap[s] = [...remAfterNatural].sort((a, b) => rankHighFn(a) - rankHighFn(b));
    } else {
      suitCardsMap[s] = remAfterNatural;
    }
  }

  // Phase 2: Check 3-card gap with Joker forming Quatris across ALL suits FIRST!
  // (Takes absolute priority over using Joker for 2-card Tris in any suit, e.g. 1♦, 3♦, 4♦ + JK)
  if (availableJokers.length > 0) {
    for (const s of suits) {
      const suitCards = suitCardsMap[s] || [];
      const remForQuatrisJk = suitCards.filter(c => !usedIds.has(c.id));
      for (let i = 0; i < remForQuatrisJk.length - 2; i++) {
        for (let j = i + 1; j < remForQuatrisJk.length - 1; j++) {
          for (let k = j + 1; k < remForQuatrisJk.length; k++) {
            if (availableJokers.length === 0) break;
            const c1 = remForQuatrisJk[i], c2 = remForQuatrisJk[j], c3 = remForQuatrisJk[k];
            if (usedIds.has(c1.id) || usedIds.has(c2.id) || usedIds.has(c3.id)) continue;
            const jk = availableJokers[0];
            if (isValidSekaQuatris([c1, c2, c3, jk])) {
              quatrisGroups.push(arrangeSekaMeld([c1, c2, c3, jk]));
              usedIds.add(c1.id); usedIds.add(c2.id); usedIds.add(c3.id);
              availableJokers.shift();
            }
          }
        }
      }
    }
  }

  // Phase 3: Check 2-card gap pairs with Joker for Tris across ALL suits
  if (availableJokers.length > 0) {
    for (const s of suits) {
      const suitCards = suitCardsMap[s] || [];
      const remSuitCards = suitCards.filter(c => !usedIds.has(c.id));
      for (let i = 0; i < remSuitCards.length; i++) {
        for (let j = i + 1; j < remSuitCards.length; j++) {
          if (availableJokers.length === 0) break;
          const c1 = remSuitCards[i];
          const c2 = remSuitCards[j];
          if (usedIds.has(c1.id) || usedIds.has(c2.id)) continue;

          const jk = availableJokers[0];
          if (isValidSekaTris([c1, c2, jk])) {
            const arrangedTrio = arrangeSekaMeld([c1, c2, jk]);
            trisGroups.push(arrangedTrio);
            usedIds.add(c1.id); usedIds.add(c2.id);
            availableJokers.shift();
          }
        }
      }
    }
  }

  // Phase 4: Promote Tris to Quatris ONLY if 4th card forms a valid Seka Quatris!
  for (const s of suits) {
    const suitCards = suitCardsMap[s] || [];
    const remForQuatPromote = suitCards.filter(c => !usedIds.has(c.id));
    const suitTris = trisGroups.filter(m => m.some(c => c.suit === s && !isSekaJoker(c)));
    for (const remCard of remForQuatPromote) {
      if (usedIds.has(remCard.id)) continue;
      for (let t = 0; t < suitTris.length; t++) {
        const meld = suitTris[t];
        if (meld.length === 3 && isValidSekaQuatris([...meld, remCard])) {
          const quat = arrangeSekaMeld([...meld, remCard]);
          quatrisGroups.push(quat);
          const idx = trisGroups.indexOf(meld);
          if (idx !== -1) trisGroups.splice(idx, 1);
          suitTris.splice(t, 1);
          usedIds.add(remCard.id);
          break;
        }
      }
    }
  }

  // Phase 5: Cluster remaining cards per suit using circular proximity (dist <= 2)
  // (e.g. Q♣ A♣ 3♣ stay together; truly distant cards with dist > 2 become singles)
  for (const s of suits) {
    const suitCards = suitCardsMap[s] || [];
    const remSuit = suitCards.filter(c => !usedIds.has(c.id));
    if (remSuit.length > 0) {
      let currentCluster = [remSuit[0]];
      for (let i = 1; i < remSuit.length; i++) {
        const prev = remSuit[i - 1];
        const curr = remSuit[i];
        const dist = getSekaRankDist(prev.rank, curr.rank);
        if (dist <= 2) {
          currentCluster.push(curr);
        } else {
          if (currentCluster.length >= 2) {
            sameSuitGroups.push(currentCluster);
          } else {
            singleCards.push(currentCluster[0]);
          }
          currentCluster = [curr];
        }
      }
      if (currentCluster.length >= 2) {
        sameSuitGroups.push(currentCluster);
      } else {
        singleCards.push(currentCluster[0]);
      }
      remSuit.forEach(c => usedIds.add(c.id));
    }
  }

  // Prioritize same-suit close clusters: larger clusters first (e.g. 3 cards before 2 cards), then tighter gap
  sameSuitGroups.sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    const spanA = (RANK_ORDER[a[a.length - 1].rank] || 0) - (RANK_ORDER[a[0].rank] || 0);
    const spanB = (RANK_ORDER[b[b.length - 1].rank] || 0) - (RANK_ORDER[b[0].rank] || 0);
    return spanA - spanB;
  });

  // Assemble arranged cards:
  // Melds come FIRST (Quatris then Tris).
  // Any same-suit neighbor cards/clusters stay immediately adjacent to that suit's melds!
  const arrangedCards = [];
  const meldsToPlace = [...quatrisGroups, ...trisGroups];
  const placedClusterIdxs = new Set();
  const placedSingleIds = new Set();

  for (const meld of meldsToPlace) {
    let meldCards = [...meld];
    const meldNat = meld.find(c => !isSekaJoker(c));
    if (meldNat) {
      const meldSuit = meldNat.suit;
      // Check if any close single of this same suit connects directly (dist <= 1, e.g. K♦ connects to A♦)
      for (let i = 0; i < singleCards.length; i++) {
        const sc = singleCards[i];
        if (!placedSingleIds.has(sc.id) && sc.suit === meldSuit) {
          const meldNats = meldCards.filter(c => !isSekaJoker(c));
          if (meldNats.some(c => getSekaRankDist(c.rank, sc.rank) <= 1)) {
            meldCards = arrangeSekaMeld([...meldCards, sc]);
            placedSingleIds.add(sc.id);
          }
        }
      }
      arrangedCards.push(...meldCards);

      // Place any same-suit cluster (e.g. 5♠ 6♠ or 8♠ 9♠ pair) right next to this meld
      for (let i = 0; i < sameSuitGroups.length; i++) {
        if (!placedClusterIdxs.has(i) && sameSuitGroups[i].some(c => c.suit === meldSuit)) {
          arrangedCards.push(...sameSuitGroups[i]);
          placedClusterIdxs.add(i);
        }
      }
    } else {
      arrangedCards.push(...meldCards);
    }
  }

  // Append remaining same-suit clusters that don't belong to an existing meld
  for (let i = 0; i < sameSuitGroups.length; i++) {
    if (!placedClusterIdxs.has(i)) {
      arrangedCards.push(...sameSuitGroups[i]);
    }
  }

  // Any unused Jokers
  const unusedJokers = [...availableJokers];
  arrangedCards.push(...unusedJokers);

  // Append remaining isolated distant singles
  for (const sc of singleCards) {
    if (!placedSingleIds.has(sc.id)) {
      arrangedCards.push(sc);
    }
  }

  return {
    arrangedCards,
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
            { type: 'QUATRIS', cards: arrangeSekaMeld(quatrisCards) },
            { type: 'TRIS', cards: arrangeSekaMeld(tris1Cards) },
            { type: 'TRIS', cards: arrangeSekaMeld(tris2Cards) }
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
