const { arrangeSekaHandOptimal } = require('./engine/sekaRules');

// Scenario: User has Q♦, Joker, A♦ then drew K♦
// Sort should produce: Q♦ K♦ A♦ (natural Tris) with Joker freed
const hand = [
  { id: 'q', suit: '♦', rank: 'Q' },
  { id: 'jk', suit: '🃏', rank: 'JOKER', isJoker: true },
  { id: 'a', suit: '♦', rank: 'A' },
  { id: 'k', suit: '♦', rank: 'K' },
  { id: 'x1', suit: '♠', rank: '3' },
  { id: 'x2', suit: '♠', rank: '7' },
  { id: 'x3', suit: '♥', rank: '5' },
  { id: 'x4', suit: '♥', rank: '9' },
  { id: 'x5', suit: '♣', rank: '2' },
  { id: 'x6', suit: '♣', rank: '8' }
];

const r = arrangeSekaHandOptimal(hand);
const display = r.arrangedCards.map(c => (c.isJoker ? '🃏' : c.rank + c.suit)).join(' ');
console.log('After sort:', display);

// Check that Q♦ K♦ A♦ are consecutive and Joker is separate
const qIdx = r.arrangedCards.findIndex(c => c.id === 'q');
const kIdx = r.arrangedCards.findIndex(c => c.id === 'k');
const aIdx = r.arrangedCards.findIndex(c => c.id === 'a');
const jkIdx = r.arrangedCards.findIndex(c => c.id === 'jk');

console.log('Q♦ at:', qIdx, 'K♦ at:', kIdx, 'A♦ at:', aIdx, '🃏 at:', jkIdx);

if (kIdx === qIdx + 1 && aIdx === kIdx + 1) {
  console.log('✅ PASS: Q♦ K♦ A♦ are consecutive! K♦ correctly replaced Joker position!');
} else {
  console.log('❌ FAIL: Q♦ K♦ A♦ are NOT consecutive!');
}

if (jkIdx !== qIdx + 1 && jkIdx !== kIdx + 1) {
  console.log('✅ PASS: Joker is freed (not stuck between Q♦ and A♦)!');
} else {
  console.log('❌ FAIL: Joker is still between Q♦ and A♦!');
}

// Test 3: User scenario - 1 flower (A♣), J flower (J♣), K flower (K♣)
console.log('\n--- Test 3: Without Joker: A♣, J♣, K♣ ---');
const handUserNoJk = [
  { id: 'a_c', suit: '♣', rank: 'A' },
  { id: 'j_c', suit: '♣', rank: 'J' },
  { id: 'k_c', suit: '♣', rank: 'K' },
  { id: 's2', suit: '♠', rank: '2' },
  { id: 's3', suit: '♠', rank: '3' },
  { id: 's4', suit: '♠', rank: '4' },
  { id: 'h5', suit: '♥', rank: '5' },
  { id: 'h6', suit: '♥', rank: '6' },
  { id: 'h7', suit: '♥', rank: '7' },
  { id: 'd9', suit: '♦', rank: '9' }
];
const r3 = arrangeSekaHandOptimal(handUserNoJk);
console.log('Result 3 (no joker):', r3.arrangedCards.map(c => c.rank + c.suit).join(' '));

console.log('\n--- Test User Hand: A♣, J♣, K♣, Joker ---');
const { isValidSekaQuatris, arrangeSekaMeld } = require('./engine/sekaRules');
const quatrisCards = [
  { id: 'j_c', suit: '♣', rank: 'J' },
  { id: 'k_c', suit: '♣', rank: 'K' },
  { id: 'a_c', suit: '♣', rank: 'A' },
  { id: 'jk', suit: '🃏', rank: 'JOKER', isJoker: true }
];
console.log('Is valid Quatris [J, K, A, Joker]?', isValidSekaQuatris(quatrisCards));
console.log('Arranged Quatris:', arrangeSekaMeld(quatrisCards).map(c => c.isJoker ? '🃏' : c.rank + c.suit).join(' '));





