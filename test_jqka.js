const { isValidSekaQuatris, isValidSekaTris, partition10CardsIntoSekaMelds, validateSekaWinningHand } = require('./engine/sekaRules');

// Test J-Q-K-A as Quatris
const jqka = [
  { id: '1', suit: '♠', rank: 'J' },
  { id: '2', suit: '♠', rank: 'Q' },
  { id: '3', suit: '♠', rank: 'K' },
  { id: '4', suit: '♠', rank: 'A' }
];
console.log('J-Q-K-A spades Quatris:', isValidSekaQuatris(jqka));

// Test Q-K-A as Tris
const qka = [
  { suit: '♦', rank: 'Q' },
  { suit: '♦', rank: 'K' },
  { suit: '♦', rank: 'A' }
];
console.log('Q-K-A diamonds Tris:', isValidSekaTris(qka));

// Test 10-J-Q-K as Quatris
const tjqk = [
  { id: '5', suit: '♥', rank: '10' },
  { id: '6', suit: '♥', rank: 'J' },
  { id: '7', suit: '♥', rank: 'Q' },
  { id: '8', suit: '♥', rank: 'K' }
];
console.log('10-J-Q-K hearts Quatris:', isValidSekaQuatris(tjqk));

// Test winning hand with J-Q-K-A Quatris
const winHand = [
  // Tris 1: 4-5-6 hearts
  { id: 'w1', suit: '♥', rank: '4' },
  { id: 'w2', suit: '♥', rank: '5' },
  { id: 'w3', suit: '♥', rank: '6' },
  // Tris 2: 9-10-J clubs
  { id: 'w4', suit: '♣', rank: '9' },
  { id: 'w5', suit: '♣', rank: '10' },
  { id: 'w6', suit: '♣', rank: 'J' },
  // Quatris: J-Q-K-A spades
  { id: 'w7', suit: '♠', rank: 'J' },
  { id: 'w8', suit: '♠', rank: 'Q' },
  { id: 'w9', suit: '♠', rank: 'K' },
  { id: 'w10', suit: '♠', rank: 'A' },
  // Discard
  { id: 'w11', suit: '♦', rank: '3' }
];
const winRes = validateSekaWinningHand(winHand);
console.log('Winning hand with J-Q-K-A Quatris:', winRes.valid);
if (winRes.valid) {
  winRes.melds.forEach((m, i) => console.log(`  Meld ${i+1} (${m.type}):`, m.cards.map(c => c.rank + c.suit).join(' ')));
  console.log('  Discard:', winRes.discardedCard.rank + winRes.discardedCard.suit);
}
