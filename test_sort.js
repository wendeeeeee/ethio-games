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

// Test 2: Two Jokers in hand must NEVER be placed consecutively! (ተከታታይ ጆከር ማድረግ አይቻልም)
const handWith2Jokers = [
  { id: 'j1', suit: '🃏', rank: 'JOKER', isJoker: true },
  { id: 'j2', suit: '🃏', rank: 'JOKER', isJoker: true },
  { id: 'c1', suit: '♠', rank: '2' },
  { id: 'c2', suit: '♠', rank: '5' },
  { id: 'c3', suit: '♥', rank: '8' },
  { id: 'c4', suit: '♥', rank: 'K' },
  { id: 'c5', suit: '♦', rank: '4' },
  { id: 'c6', suit: '♦', rank: '9' },
  { id: 'c7', suit: '♣', rank: '3' },
  { id: 'c8', suit: '♣', rank: '10' }
];

const r2 = arrangeSekaHandOptimal(handWith2Jokers);
const j1Idx = r2.arrangedCards.findIndex(c => c.id === 'j1');
const j2Idx = r2.arrangedCards.findIndex(c => c.id === 'j2');
console.log('2 Jokers positions:', j1Idx, j2Idx);
if (Math.abs(j1Idx - j2Idx) > 1) {
  console.log('✅ PASS: 2 Jokers are NOT consecutive! (separated by other cards)');
} else {
  console.log('❌ FAIL: 2 Jokers are consecutive!');
}

