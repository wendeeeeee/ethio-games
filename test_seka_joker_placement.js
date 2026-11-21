// test_seka_joker_placement.js
const {
  isValidSekaTris,
  isValidSekaQuatris,
  partition10CardsIntoSekaMelds,
  validateSekaWinningHand
} = require('./engine/sekaRules');
const { RANK_ORDER } = require('./engine/cardTypes');

function arrangeSekaMeld(cards) {
  if (!cards || cards.length <= 1) return cards || [];
  const jokers = cards.filter(c => c.isJoker || c.rank === 'JOKER');
  const natural = cards.filter(c => !c.isJoker && c.rank !== 'JOKER');

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

console.log('--- TEST 1: 5♥ 7♥ with Joker ---');
const t1 = arrangeSekaMeld([
  { suit: '♥', rank: '7' },
  { suit: '🃏', rank: 'JOKER', isJoker: true },
  { suit: '♥', rank: '5' }
]);
console.log('Result:', t1.map(c => `${c.rank}${c.suit}`).join(' '));

console.log('--- TEST 2: 9♠ 10♠ Q♠ with Joker (Quatris) ---');
const t2 = arrangeSekaMeld([
  { suit: '♠', rank: 'Q' },
  { suit: '♠', rank: '9' },
  { suit: '🃏', rank: 'JOKER', isJoker: true },
  { suit: '♠', rank: '10' }
]);
console.log('Result:', t2.map(c => `${c.rank}${c.suit}`).join(' '));

console.log('--- TEST 3: Q♦ A♦ with Joker ---');
const t3 = arrangeSekaMeld([
  { suit: '♦', rank: 'A' },
  { suit: '♦', rank: 'Q' },
  { suit: '🃏', rank: 'JOKER', isJoker: true }
]);
console.log('Result:', t3.map(c => `${c.rank}${c.suit}`).join(' '));

console.log('--- TEST 4: 5♥ 6♥ with Joker ---');
const t4 = arrangeSekaMeld([
  { suit: '♥', rank: '6' },
  { suit: '♥', rank: '5' },
  { suit: '🃏', rank: 'JOKER', isJoker: true }
]);
console.log('Result:', t4.map(c => `${c.rank}${c.suit}`).join(' '));

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
  const jokers = hand.filter(c => c.isJoker || c.rank === 'JOKER');
  let availableJokers = [...jokers];
  const natural = hand.filter(c => !c.isJoker && c.rank !== 'JOKER');

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
    const suitCards = bySuit[s].sort((a, b) => (RANK_ORDER[a.rank] || 0) - (RANK_ORDER[b.rank] || 0));
    let usedInSuit = new Set();

    // Check complete 3-card natural Tris in this suit first
    for (let i = 0; i <= suitCards.length - 3; i++) {
      const trio = suitCards.slice(i, i + 3);
      if (isValidSekaTris(trio) && !trio.some(c => usedInSuit.has(c.id))) {
        arrangedGroups.push(trio);
        trio.forEach(c => usedInSuit.add(c.id));
      }
    }

    // Check 2-card gap pairs with Joker (e.g. 5♥ 7♥ or 5♥ 6♥ or Q♦ A♦)
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

  // If there are still unused jokers, place them
  if (availableJokers.length > 0) {
    arrangedGroups.push(availableJokers);
  }

  return {
    arrangedCards: arrangedGroups.flat(),
    isWin: false
  };
}

console.log('\n--- TEST 5: Hand with 5♥ 7♥ and Joker plus 8♠ 9♠ 10♠ ---');
const handTest = [
  { id: '1', suit: '♠', rank: '10' },
  { id: '2', suit: '♥', rank: '7' },
  { id: '3', suit: '🃏', rank: 'JOKER', isJoker: true },
  { id: '4', suit: '♠', rank: '8' },
  { id: '5', suit: '♥', rank: '5' },
  { id: '6', suit: '♠', rank: '9' },
  { id: '7', suit: '♦', rank: 'K' }
];
const resHand = arrangeSekaHandOptimal(handTest);
console.log('Arranged Hand:', resHand.arrangedCards.map(c => `${c.rank}${c.suit}`).join(' '));

