const fs = require('fs');
const path = require('path');
const {
  isWildJoker,
  isNaturalMeld,
  isSequenceSameSuit,
  isValidTris,
  isValidQuatris,
  calculateMeldsPoints,
  canTakeFromGround,
  validateConquerHand
} = require('./engine/conquerRules');

const appJs = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');

const RANK_VALUES = {
  'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6,
  '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13
};
function getRankNum(rank, aceHigh = false) {
  if (rank === 'A' && aceHigh) return 14;
  return RANK_VALUES[rank] || 0;
}
function isCardJoker(card, state) {
  return card.isJoker || (state && state.jokerRank === card.rank) || false;
}

// Extract findSingleBestArrangement and syncHandPreservingOrder
let currentGameState = { myHand: [] };
let playerOrderedCardIds = [];
const orderSetMatch = appJs.match(/function orderSameRankSet[\s\S]*?return cards;\s*\}/);
eval(orderSetMatch[0]);

const distMatch = appJs.match(/function getCardRankDistance[\s\S]*?return dist;\s*\}/);
eval(distMatch[0]);

const higherMatch = appJs.match(/function isCardHigherRank[\s\S]*?return getRankNum\(a\.rank\) > getRankNum\(b\.rank\);\s*\}/);
eval(higherMatch[0]);

const connMatch = appJs.match(/function getCardConnectionScore[\s\S]*?return 0;\s*\}/);
eval(connMatch[0]);

const chainMatch = appJs.match(/function buildChainsFromCards[\s\S]*?return \{ chains, singles \};\s*\}/);
eval(chainMatch[0]);

const isCardJkMatch = appJs.match(/function isCardJoker[\s\S]*?return false;\s*\}/);
eval(isCardJkMatch[0]);

const syncMatch = appJs.match(/function syncHandPreservingOrder[\s\S]*?return preserved;\s*\}/);
const bestMatch = appJs.match(/function findSingleBestArrangement[\s\S]*?function arrangeHandOptimal[\s\S]*?return best \? best\.arrangedCards : \(hand \|\| \[\]\);\s*\}/);

eval(syncMatch[0]);
eval(bestMatch[0]);

console.log('--- TEST 1: Rule verification (Tris & Quatris) ---');
const trisRun = [
  { id: '1', suit: '♥', rank: '7' },
  { id: '2', suit: '♥', rank: '5' },
  { id: '3', suit: '♥', rank: '6' }
];
console.log('7♥ 5♥ 6♥ isValidTris:', isValidTris(trisRun, null));

console.log('\n--- TEST 2: findSingleBestArrangement keeps Tris intact & ascending ---');
const handWithTris = [
  { id: '1', suit: '♥', rank: '7', pointValue: 7 },
  { id: '2', suit: '♥', rank: '5', pointValue: 5 },
  { id: '3', suit: '♥', rank: '6', pointValue: 6 },
  { id: '4', suit: '♦', rank: 'K', pointValue: 10 }
];
const res1 = findSingleBestArrangement(handWithTris, null);
const first3 = res1.arrangedCards.slice(0, 3).map(c => `${c.rank}${c.suit}`).join(' ');
console.log('Result cards:', res1.arrangedCards.map(c => `${c.rank}${c.suit}`).join(' '));
if (first3 !== '5♥ 6♥ 7♥') {
  throw new Error(`Expected 5♥ 6♥ 7♥ but got: ${first3}`);
}
console.log('PASS: Tris sorted strictly ascending 5♥ 6♥ 7♥');

console.log('\n--- TEST 3: Conquer hand with 13 melded + 1 ተጣይ card ---');
const conquerHand = [
  // Meld 1: 5♥ 6♥ 7♥
  { id: 'c1', suit: '♥', rank: '5', pointValue: 5 },
  { id: 'c2', suit: '♥', rank: '6', pointValue: 6 },
  { id: 'c3', suit: '♥', rank: '7', pointValue: 7 },
  // Meld 2: 8♠ 9♠ 10♠
  { id: 'c4', suit: '♠', rank: '8', pointValue: 8 },
  { id: 'c5', suit: '♠', rank: '9', pointValue: 9 },
  { id: 'c6', suit: '♠', rank: '10', pointValue: 10 },
  // Meld 3: Q♦ Q♣ Q♠
  { id: 'c7', suit: '♦', rank: 'Q', pointValue: 10 },
  { id: 'c8', suit: '♣', rank: 'Q', pointValue: 10 },
  { id: 'c9', suit: '♠', rank: 'Q', pointValue: 10 },
  // Meld 4: A♣ 2♣ 3♣ 4♣ (Quatris)
  { id: 'c10', suit: '♣', rank: 'A', pointValue: 11 },
  { id: 'c11', suit: '♣', rank: '2', pointValue: 2 },
  { id: 'c12', suit: '♣', rank: '3', pointValue: 3 },
  { id: 'c13', suit: '♣', rank: '4', pointValue: 4 },
  // Discard (ተጣይ): K♦
  { id: 'c14', suit: '♦', rank: 'K', pointValue: 10 }
];

const resConquer = findSingleBestArrangement(conquerHand, null);
console.log('Is conquer:', resConquer.isConquer);
console.log('Melded count:', resConquer.meldedCount);
console.log('Tetay card:', `${resConquer.tetayCard.rank}${resConquer.tetayCard.suit}`, 'isTetay:', resConquer.tetayCard.isTetay);
if (!resConquer.isConquer || resConquer.tetayCard.id !== 'c14' || !resConquer.tetayCard.isTetay) {
  throw new Error('Conquer hand arrangement failed');
}

// Check with conquerRules.validateConquerHand
const validation = validateConquerHand(resConquer.meldsCards, resConquer.tetayCard, null, null);
console.log('Rule validation valid:', validation.valid);
if (!validation.valid) {
  throw new Error(`Rule validation failed: ${validation.message}`);
}
console.log('PASS: 14-card Conquer validated by game engine!');

console.log('\n--- TEST 4: syncHandPreservingOrder preserves manual player reordering ---');
playerOrderedCardIds = ['c3', 'c1', 'c2'];
currentGameState.myHand = [
  { id: 'c3', rank: '7' },
  { id: 'c1', rank: '5' },
  { id: 'c2', rank: '6' }
];
// Incoming state after drawing a card: server sends [c1, c2, c3, newCard]
const incomingDraw = [
  { id: 'c1', rank: '5' },
  { id: 'c2', rank: '6' },
  { id: 'c3', rank: '7' },
  { id: 'newCard', rank: 'A' }
];
const syncedDraw = syncHandPreservingOrder(incomingDraw);
console.log('Synced after draw:', syncedDraw.map(c => c.id).join(' '));
if (syncedDraw[0].id !== 'c3' || syncedDraw[1].id !== 'c1' || syncedDraw[2].id !== 'c2' || syncedDraw[3].id !== 'newCard') {
  throw new Error('Manual order was not preserved on draw!');
}
console.log('PASS: Manual card order preserved on draw!');

// Incoming state after discarding c1: server sends [c2, c3, newCard]
// Player's preserved order was [c3, c1, c2, newCard], discarding c1 leaves [c3, c2, newCard]
const incomingDiscard = [
  { id: 'c2', rank: '6' },
  { id: 'c3', rank: '7' },
  { id: 'newCard', rank: 'A' }
];
const syncedDiscard = syncHandPreservingOrder(incomingDiscard);
console.log('Synced after discard:', syncedDiscard.map(c => c.id).join(' '));
if (syncedDiscard[0].id !== 'c3' || syncedDiscard[1].id !== 'c2' || syncedDiscard[2].id !== 'newCard') {
  throw new Error('Manual order was not preserved on discard!');
}
console.log('PASS: Manual card order preserved on discard (NO SCRAMBLING)!');

console.log('\n--- TEST 5: GameRoom.layDownMelds (ውረድ) ---');
const GameRoom = require('./engine/gameRoom');
const room = new GameRoom('test_wered_room', { id: 'p1', name: 'Player 1' }, 100);
room.join({ id: 'p2', name: 'Player 2' });
room.setJokerHighLow('p2', 'high');

// Give p1 specific cards
room.creatorHand = [
  { id: 'm1', rank: '10', suit: '♠', pointValue: 10 },
  { id: 'm2', rank: 'J', suit: '♠', pointValue: 10 },
  { id: 'm3', rank: 'Q', suit: '♠', pointValue: 10 },
  { id: 'm4', rank: 'K', suit: '♠', pointValue: 10 },
  { id: 'm5', rank: 'A', suit: '♠', pointValue: 11 },
  { id: 'x1', rank: '2', suit: '♥', pointValue: 2 },
  { id: 'x2', rank: '3', suit: '♥', pointValue: 3 },
  { id: 'x3', rank: '4', suit: '♥', pointValue: 4 }
];

// Test 1: Laying down valid single Tris step-by-step
const singleTris = [[
  { id: 'x1', rank: '2', suit: '♥', pointValue: 2 },
  { id: 'x2', rank: '3', suit: '♥', pointValue: 3 },
  { id: 'x3', rank: '4', suit: '♥', pointValue: 4 }
]];
const firstRes = room.layDownMelds('p1', singleTris);
if (!firstRes.success) throw new Error(`Single Tris step-by-step failed: ${firstRes.message}`);
console.log('PASS: Single Tris laid down step-by-step without blocking!');

// Test 2: Laying down another valid meld on top
const highMeld = [
  [
    { id: 'm2', rank: 'J', suit: '♠', pointValue: 10 },
    { id: 'm3', rank: 'Q', suit: '♠', pointValue: 10 },
    { id: 'm4', rank: 'K', suit: '♠', pointValue: 10 },
    { id: 'm5', rank: 'A', suit: '♠', pointValue: 11 }
  ]
];
const passRes = room.layDownMelds('p1', highMeld);
if (!passRes.success) throw new Error(`Second meld failed: ${passRes.message}`);
console.log('PASS: Second meld laid down successfully!');
if (room.tableMelds['p1'].length !== 2) throw new Error('Table melds not updated!');

console.log('\n--- TEST 6: Joker in middle of 9, J, Q forms Quatris 9-Joker-J-Q ---');
const handWith9JQ = [
  { id: 'c1', rank: '9', suit: '♠', pointValue: 9 },
  { id: 'c2', rank: 'J', suit: '♠', pointValue: 10 },
  { id: 'c3', rank: 'Q', suit: '♠', pointValue: 10 },
  { id: 'j1', rank: '6', suit: '♠', pointValue: 6, isJoker: true },
  { id: 'c4', rank: '10', suit: '♣', pointValue: 10 },
  { id: 'c5', rank: '10', suit: '♦', pointValue: 10 },
  { id: 'c6', rank: '10', suit: '♥', pointValue: 10 }
];
const testState = { jokerRank: '6', jokerSuits: ['♠'] };
const res6 = findSingleBestArrangement(handWith9JQ, testState);
const quatrisGroup = res6.meldsCards.find(m => m.length === 4);
if (!quatrisGroup) {
  throw new Error('Quatris group of 4 not found!');
}
const quatrisStr = quatrisGroup.map(c => `${c.rank}${c.suit}`).join(' ');
console.log('Quatris result:', quatrisStr);
if (quatrisStr !== '9♠ 6♠ J♠ Q♠') {
  throw new Error(`Expected '9♠ 6♠ J♠ Q♠' with Joker in the middle, but got: ${quatrisStr}`);
}
console.log('PASS: Joker successfully entered in the middle between 9 and J to form Quatris!');

console.log('\n--- TEST 7: Color sandwich in same-rank sets ---');
// Case 1: 5♦, 5♥, 5♠ (2 Reds, 1 Black) -> [5♦, 5♠, 5♥] (Black in middle!)
const set2R1B = [
  { id: '1', rank: '5', suit: '♦' },
  { id: '2', rank: '5', suit: '♥' },
  { id: '3', rank: '5', suit: '♠' }
];
const resSet1 = orderSameRankSet(set2R1B);
const strSet1 = resSet1.map(c => `${c.rank}${c.suit}`).join(' ');
console.log('2 Reds 1 Black result:', strSet1);
if (resSet1[1].suit !== '♠') {
  throw new Error(`Expected Black in middle, but got: ${strSet1}`);
}
console.log('PASS: 2 Reds 1 Black -> Black sandwiched in middle!');

// Case 2: 5♠, 5♣, 5♥ (2 Blacks, 1 Red) -> [5♠, 5♥, 5♣] (Red in middle!)
const set2B1R = [
  { id: '1', rank: '5', suit: '♠' },
  { id: '2', rank: '5', suit: '♣' },
  { id: '3', rank: '5', suit: '♥' }
];
const resSet2 = orderSameRankSet(set2B1R);
const strSet2 = resSet2.map(c => `${c.rank}${c.suit}`).join(' ');
console.log('2 Blacks 1 Red result:', strSet2);
if (resSet2[1].suit !== '♥') {
  throw new Error(`Expected Red in middle, but got: ${strSet2}`);
}
console.log('PASS: 2 Blacks 1 Red -> Red sandwiched in middle!');

console.log('\n--- TEST 8: Bridge / Connector ("አጣማሪ") Rule ---');
// User scenario: Player has Q♥ and K♥, and draws Q♠ -> Q♥ bridges Q♠ and K♥: [Q♠, Q♥, K♥]
const handAtamari = [
  { id: '1', rank: 'Q', suit: '♥', pointValue: 10 },
  { id: '2', rank: 'K', suit: '♥', pointValue: 10 },
  { id: '3', rank: 'Q', suit: '♠', pointValue: 10 }
];
const resAtamari = findSingleBestArrangement(handAtamari, null);
const strAtamari = resAtamari.arrangedCards.map(c => `${c.rank}${c.suit}`).join(' ');
console.log('Atamari result cards:', strAtamari);
if (strAtamari !== 'Q♠ Q♥ K♥' && strAtamari !== 'K♥ Q♥ Q♠') {
  throw new Error(`Expected 'Q♠ Q♥ K♥' or 'K♥ Q♥ Q♠' with Q♥ in the middle as bridge, but got: ${strAtamari}`);
}
console.log('PASS: Bridge connector successfully placed Q♥ in the middle between Q♠ (pair) and K♥ (sequence)!');

// Case 2: 10♠, J♠, J♦ -> J♠ bridges 10♠ and J♦: [10♠, J♠, J♦]
const handAtamari2 = [
  { id: '1', rank: 'J', suit: '♦', pointValue: 10 },
  { id: '2', rank: '10', suit: '♠', pointValue: 10 },
  { id: '3', rank: 'J', suit: '♠', pointValue: 10 }
];
const resAtamari2 = findSingleBestArrangement(handAtamari2, null);
const strAtamari2 = resAtamari2.arrangedCards.map(c => `${c.rank}${c.suit}`).join(' ');
console.log('Atamari 2 result cards:', strAtamari2);
if (strAtamari2 !== '10♠ J♠ J♦' && strAtamari2 !== 'J♦ J♠ 10♠') {
  throw new Error(`Expected '10♠ J♠ J♦' or 'J♦ J♠ 10♠' with J♠ in the middle as bridge, but got: ${strAtamari2}`);
}
console.log('PASS: Bridge connector successfully placed J♠ in the middle between 10♠ and J♦!');

console.log('\n--- TEST 9: General Chaining (5-card continuous unbroken chain) ---');
// User scenario: Q♥, Q♣, K♣, J♥, J♦ -> MUST arrange as: J♦ J♥ Q♥ Q♣ K♣ (or reverse)
const handChain5 = [
  { id: '1', rank: 'Q', suit: '♥', pointValue: 10 },
  { id: '2', rank: 'Q', suit: '♣', pointValue: 10 },
  { id: '3', rank: 'K', suit: '♣', pointValue: 10 },
  { id: '4', rank: 'J', suit: '♥', pointValue: 10 },
  { id: '5', rank: 'J', suit: '♦', pointValue: 10 }
];
const resChain5 = findSingleBestArrangement(handChain5, null);
const strChain5 = resChain5.arrangedCards.map(c => `${c.rank}${c.suit}`).join(' ');
console.log('5-card chain result:', strChain5);
if (strChain5 !== 'J♦ J♥ Q♥ Q♣ K♣' && strChain5 !== 'K♣ Q♣ Q♥ J♥ J♦') {
  throw new Error(`Expected unbroken chain 'J♦ J♥ Q♥ Q♣ K♣', but got: ${strChain5}`);
}
console.log('PASS: 5-card unbroken chain J♦ J♥ Q♥ Q♣ K♣ verified successfully!');

console.log('\n--- TEST 10: Ace and Queen of same suit stay together (Q♦ A♦) ---');
const handQA = [
  { id: '1', rank: 'A', suit: '♦', pointValue: 11 },
  { id: '2', rank: 'Q', suit: '♦', pointValue: 10 }
];
const resQA = findSingleBestArrangement(handQA, null);
const strQA = resQA.arrangedCards.map(c => `${c.rank}${c.suit}`).join(' ');
console.log('Q♦ A♦ result:', strQA);
if (strQA !== 'Q♦ A♦') {
  throw new Error(`Expected 'Q♦ A♦', but got: ${strQA}`);
}
console.log('PASS: Q♦ and A♦ stay together as inside straight opportunity!');

console.log('\n--- TEST 11: 2♠ 3♠ 4♠ forms complete Tris intact ---');
const hand234 = [
  { id: '1', rank: '3', suit: '♠', pointValue: 3 },
  { id: '2', rank: '4', suit: '♦', pointValue: 4 },
  { id: '3', rank: '4', suit: '♠', pointValue: 4 },
  { id: '4', rank: '3', suit: '♣', pointValue: 3 },
  { id: '5', rank: '2', suit: '♥', pointValue: 2 },
  { id: '6', rank: '2', suit: '♠', pointValue: 2 }
];
const res234 = findSingleBestArrangement(hand234, null);
const meldStr = res234.meldsCards.map(m => m.map(c => `${c.rank}${c.suit}`).join(' ')).join(' | ');
console.log('234 melds result:', meldStr);
if (!meldStr.includes('2♠ 3♠ 4♠')) {
  throw new Error(`Expected '2♠ 3♠ 4♠' to form valid Tris, but got melds: ${meldStr}`);
}
console.log('PASS: 2♠ 3♠ 4♠ forms valid pure Tris without breaking apart!');

console.log('\n--- TEST 12: 1 2 3 ጦር (A♠ 2♠ 3♠) forms pure Tris intact even with 3♦ ---');
const hand123 = [
  { id: '1', rank: 'A', suit: '♠', pointValue: 11 },
  { id: '2', rank: '2', suit: '♠', pointValue: 2 },
  { id: '3', rank: '3', suit: '♦', pointValue: 3 },
  { id: '4', rank: '3', suit: '♠', pointValue: 3 }
];
const res123 = findSingleBestArrangement(hand123, { jokerRank: '3' });
const melds123Str = res123.meldsCards.map(m => m.map(c => `${c.rank}${c.suit}`).join(' ')).join(' | ');
console.log('123 melds result:', melds123Str);
console.log('123 arranged result:', res123.arrangedCards.map(c => `${c.rank}${c.suit}`).join(' '));
if (!melds123Str.includes('A♠ 2♠ 3♠')) {
  throw new Error(`Expected 'A♠ 2♠ 3♠' pure Tris, but got: ${melds123Str}`);
}
console.log('PASS: A♠ 2♠ 3♠ kept 100% intact as pure Tris!');

console.log('\n--- TEST 13: 2♥ 4♠ 2♦ 3♠ keeps natural pairs intact rather than stranding 3♠ ---');
const hand2423 = [
  { id: '1', rank: '2', suit: '♥', pointValue: 2 },
  { id: '2', rank: '4', suit: '♠', pointValue: 4 },
  { id: '3', rank: '2', suit: '♦', pointValue: 2 },
  { id: '4', rank: '3', suit: '♠', pointValue: 3 }
];
const res2423 = findSingleBestArrangement(hand2423, { jokerRank: '4' });
const arranged2423Str = res2423.arrangedCards.map(c => `${c.rank}${c.suit}`).join(' ');
console.log('2423 arranged result:', arranged2423Str);
if (arranged2423Str !== '2♥ 2♦ 3♠ 4♠' && arranged2423Str !== '3♠ 4♠ 2♥ 2♦') {
  throw new Error(`Expected 2♥ 2♦ and 3♠ 4♠ together, but got: ${arranged2423Str}`);
}
console.log('PASS: 2♥ 2♦ and 3♠ 4♠ stay together with 0 stranded singles!');

console.log('\n--- TEST 14: K♣ is NOT a wild joker when cut is Red (jokerSuits: [♥, ♦]) ---');
const hand89K = [
  { id: '1', rank: '8', suit: '♦', pointValue: 8 },
  { id: '2', rank: '9', suit: '♦', pointValue: 9 },
  { id: '3', rank: 'K', suit: '♣', pointValue: 10 }
];
const res89K = findSingleBestArrangement(hand89K, { jokerRank: 'K', jokerSuits: ['♥', '♦'] });
const str89K = res89K.arrangedCards.map(c => `${c.rank}${c.suit}`).join(' ');
console.log('89K arranged:', str89K);
if (res89K.meldsCards.length > 0) {
  throw new Error(`Expected NO melds with K♣ since K♣ is not in jokerSuits, but got melds: ${JSON.stringify(res89K.meldsCards)}`);
}
if (str89K === '8♦ K♣ 9♦' || str89K === '9♦ K♣ 8♦') {
  throw new Error(`K♣ must NOT be placed between 8♦ and 9♦! Got: ${str89K}`);
}
console.log('PASS: K♣ correctly recognized as natural card (not wild joker) and not forced between 8♦ and 9♦!');

console.log('\n--- TEST 15: False Joker is NOT wild; only substitutes designated cut rank ---');
const falseJokerCard = { id: 'fj1', isFalseJoker: true, suit: '🃏', rank: 'FALSE', pointValue: 0 };
// Cannot form wild sequence with 8♦ and 9♦:
const falseWith89 = isValidTris([
  { id: '1', rank: '8', suit: '♦' },
  { id: '2', rank: '9', suit: '♦' },
  falseJokerCard
], 'K', ['♥', '♦']);
console.log('isValidTris([8♦, 9♦, FalseJoker]):', falseWith89);
if (falseWith89) {
  throw new Error('False Joker must NOT act as wild card to complete 8♦ 9♦!');
}
// CAN substitute designated cut rank K in a set of Kings:
const falseWithKK = isValidTris([
  { id: '1', rank: 'K', suit: '♠' },
  { id: '2', rank: 'K', suit: '♦' },
  falseJokerCard
], 'K', ['♥', '♦']);
console.log('isValidTris([K♠, K♦, FalseJoker]):', falseWithKK);
if (!falseWithKK) {
  throw new Error('False Joker must substitute designated cut rank K to form Tris of Kings!');
}
console.log('PASS: False Joker correctly validated (NOT wild, only substitutes designated cut rank)!');

console.log('\n--- TEST 16: Joker J♦ enters inside gap between 2♥ and 4♥ to form 1♥ 2♥ J♦ 4♥ Quatris ---');
const hand124JQ = [
  { id: '1', rank: 'A', suit: '♥', pointValue: 11 },
  { id: '2', rank: '2', suit: '♥', pointValue: 2 },
  { id: '3', rank: '4', suit: '♥', pointValue: 4 },
  { id: '4', rank: 'J', suit: '♦', pointValue: 10, isJoker: true, isMainJoker: true },
  { id: '5', rank: 'Q', suit: '♦', pointValue: 10 }
];
const res124JQ = findSingleBestArrangement(hand124JQ, { jokerRank: 'J', jokerSuits: ['♦'] });
const str124JQ = res124JQ.meldsCards.map(m => m.map(c => `${c.rank}${c.suit}`).join(' ')).join(' | ');
console.log('124JQ melds:', str124JQ);
console.log('124JQ arranged:', res124JQ.arrangedCards.map(c => `${c.rank}${c.suit}`).join(' '));
if (!str124JQ.includes('A♥ 2♥ J♦ 4♥')) {
  throw new Error(`Expected 'A♥ 2♥ J♦ 4♥' Quatris with Joker in the middle, but got: ${str124JQ}`);
}
console.log('PASS: Joker J♦ placed directly in the middle of 1 2 4 hearts to form Quatris!');

console.log('\n--- TEST 17: Joker J♦ enters inside gap between 2♥ and 4♥ to form 2♥ J♦ 4♥ Tris ---');
const hand24JQ = [
  { id: '1', rank: '2', suit: '♥', pointValue: 2 },
  { id: '2', rank: '4', suit: '♥', pointValue: 4 },
  { id: '3', rank: 'J', suit: '♦', pointValue: 10, isJoker: true, isMainJoker: true },
  { id: '4', rank: 'Q', suit: '♦', pointValue: 10 }
];
const res24JQ = findSingleBestArrangement(hand24JQ, { jokerRank: 'J', jokerSuits: ['♦'] });
const str24JQ = res24JQ.meldsCards.map(m => m.map(c => `${c.rank}${c.suit}`).join(' ')).join(' | ');
console.log('24JQ melds:', str24JQ);
console.log('24JQ arranged:', res24JQ.arrangedCards.map(c => `${c.rank}${c.suit}`).join(' '));
if (!str24JQ.includes('2♥ J♦ 4♥')) {
  throw new Error(`Expected '2♥ J♦ 4♥' Tris with Joker in the middle, but got: ${str24JQ}`);
}
console.log('PASS: Joker J♦ placed directly between 2 and 4 hearts to form Tris!');

console.log('\n--- TEST 18: Discarding GEBI card to ground is strictly BLOCKED ---');
const roomGebi = new GameRoom('room_gebi', { id: 'p1', name: 'Player 1', socketId: 's1' }, 50);
roomGebi.join({ id: 'p2', name: 'Player 2', socketId: 's2' });
roomGebi.jokerRank = 'K';
roomGebi.jokerSuits = ['♠', '♣'];
roomGebi.status = 'PLAYING';
roomGebi.tableMelds['p1'] = [
  [
    { id: 'm1', rank: '5', suit: '♦', pointValue: 5 },
    { id: 'm2', rank: '6', suit: '♦', pointValue: 6 },
    { id: 'm3', rank: '7', suit: '♦', pointValue: 7 }
  ]
];
// Player 2's turn to discard
roomGebi.currentTurnPlayerId = 'p2';
roomGebi.turnState = 'AWAITING_DISCARD';
roomGebi.joinerHand = [
  { id: 'c_gebi8', rank: '8', suit: '♦', pointValue: 8 },
  { id: 'c_gebi4', rank: '4', suit: '♦', pointValue: 4 },
  { id: 'c_safe', rank: '8', suit: '♣', pointValue: 8 }
];

// Attempting to discard 8♦ to ground must be rejected because it is GEBI to 5-6-7♦!
const resDiscard8 = roomGebi.discardCard('p2', 'c_gebi8', false);
console.log('Discard 8♦ result:', resDiscard8);
if (resDiscard8.success || !resDiscard8.isGebi) {
  throw new Error(`Expected discard 8♦ to be rejected as GEBI, but got: ${JSON.stringify(resDiscard8)}`);
}
// Attempting to discard 4♦ to ground must also be rejected because it is GEBI to 5-6-7♦!
const resDiscard4 = roomGebi.discardCard('p2', 'c_gebi4', false);
console.log('Discard 4♦ result:', resDiscard4);
if (resDiscard4.success || !resDiscard4.isGebi) {
  throw new Error(`Expected discard 4♦ to be rejected as GEBI, but got: ${JSON.stringify(resDiscard4)}`);
}
// Discarding unrelated 8♣ is allowed
const resDiscardSafe = roomGebi.discardCard('p2', 'c_safe', false);
console.log('Discard 8♣ result:', resDiscardSafe);
if (!resDiscardSafe.success) {
  throw new Error(`Expected discard 8♣ to succeed, but got: ${JSON.stringify(resDiscardSafe)}`);
}
console.log('PASS: Discarding GEBI cards (8♦ and 4♦) blocked, and safe card (8♣) allowed!');

console.log('\n--- TEST 19: Player drawing from ground MUST meld 41 before discarding to ground ---');
const roomGround = new GameRoom('room_ground', { id: 'p1', name: 'Player 1', socketId: 's1' }, 50);
roomGround.join({ id: 'p2', name: 'Player 2', socketId: 's2' });
roomGround.jokerRank = 'K';
roomGround.jokerSuits = ['♥', '♦'];
roomGround.status = 'PLAYING';
roomGround.isFirstDiscard = false;
roomGround.discardPile = [{ id: 'ground_c', rank: '9', suit: '♠', pointValue: 9 }];
roomGround.currentTurnPlayerId = 'p2';
roomGround.turnState = 'AWAITING_DRAW';
roomGround.joinerHand = [
  { id: 'jh1', rank: 'K', suit: '♥', pointValue: 10 },
  { id: 'jh2', rank: 'K', suit: '♦', pointValue: 10 },
  { id: 'jh3', rank: 'K', suit: '♣', pointValue: 10 },
  { id: 'jh4', rank: 'A', suit: '♠', pointValue: 11 },
  { id: 'jh5', rank: '2', suit: '♠', pointValue: 2 },
  { id: 'jh6', rank: '3', suit: '♠', pointValue: 3 },
  { id: 'discard_target', rank: '7', suit: '♣', pointValue: 7 }
];

// p2 draws 9♠ from ground
const drawRes = roomGround.drawCard('p2', 'ground');
console.log('Draw from ground result:', drawRes);
if (!drawRes.success || roomGround.mustMeld41PlayerId !== 'p2') {
  throw new Error('Expected successful ground draw with mustMeld41PlayerId = p2');
}

// Attempting to discard without melding 41 must be blocked!
const discardBeforeMeld = roomGround.discardCard('p2', 'discard_target', false);
console.log('Discard before melding 41:', discardBeforeMeld);
if (discardBeforeMeld.success || !discardBeforeMeld.mustMeld41) {
  throw new Error('Discard to ground must be BLOCKED when mustMeld41 is active!');
}

// Now p2 lays down melds >= 41 points: K♥ K♦ K♣ (30 pts) + A♠ 2♠ 3♠ (16 pts) = 46 pts
const meldsToLay = [
  [
    { id: 'jh1', rank: 'K', suit: '♥', pointValue: 10 },
    { id: 'jh2', rank: 'K', suit: '♦', pointValue: 10 },
    { id: 'jh3', rank: 'K', suit: '♣', pointValue: 10 }
  ],
  [
    { id: 'jh4', rank: 'A', suit: '♠', pointValue: 11 },
    { id: 'jh5', rank: '2', suit: '♠', pointValue: 2 },
    { id: 'jh6', rank: '3', suit: '♠', pointValue: 3 }
  ]
];
const meldRes = roomGround.layDownMelds('p2', meldsToLay);
console.log('Laying down 46 points melds:', meldRes);
if (!meldRes.success || roomGround.mustMeld41PlayerId !== null) {
  throw new Error('Laying down >= 41 points must succeed and clear mustMeld41PlayerId!');
}

// Now discarding is permitted!
const discardAfterMeld = roomGround.discardCard('p2', 'discard_target', false);
console.log('Discard after melding 41:', discardAfterMeld);
if (!discardAfterMeld.success) {
  throw new Error('Discard must be allowed once >= 41 points are melded!');
}
console.log('PASS: Drawing from ground strictly enforces >= 41 meld before discarding to ground!');

console.log('\n--- TEST 20: Attaching GEBI card to open table meld (attachGebiCard) ---');
const roomAttach = new GameRoom('room_attach', { id: 'p1', name: 'Player 1', socketId: 's1' }, 50);
roomAttach.join({ id: 'p2', name: 'Player 2', socketId: 's2' });
roomAttach.jokerRank = 'K';
roomAttach.jokerSuits = ['♥', '♦'];
roomAttach.status = 'PLAYING';
roomAttach.tableMelds['p1'] = [
  [
    { id: 'm1', rank: '5', suit: '♦', pointValue: 5 },
    { id: 'm2', rank: '6', suit: '♦', pointValue: 6 },
    { id: 'm3', rank: '7', suit: '♦', pointValue: 7 }
  ]
];
roomAttach.currentTurnPlayerId = 'p2';
roomAttach.turnState = 'AWAITING_DISCARD';
roomAttach.joinerHand = [
  { id: 'gebi_card', rank: '8', suit: '♦', pointValue: 8 },
  { id: 'other_card', rank: 'K', suit: '♠', pointValue: 10 }
];

const attachRes = roomAttach.attachGebiCard('p2', 'p1', 0, 'gebi_card');
console.log('Attach GEBI result:', attachRes);
if (!attachRes.success) {
  throw new Error(`Expected attachGebiCard to succeed, but got: ${JSON.stringify(attachRes)}`);
}
const updatedMeld = roomAttach.tableMelds['p1'][0];
console.log('Updated meld:', updatedMeld.map(c => `${c.rank}${c.suit}`).join(' '));
if (updatedMeld.length !== 4 || updatedMeld[3].rank !== '8') {
  throw new Error('Expected table meld to have 8♦ attached as 4th card!');
}
if (roomAttach.joinerHand.some(c => c.id === 'gebi_card')) {
  throw new Error('Expected 8♦ to be removed from player hand after attaching!');
}
console.log('PASS: attachGebiCard successfully attached 8♦ to 5♦ 6♦ 7♦ on table!');

console.log('\nALL 20 TESTS PASSED SUCCESSFULLY! Everything is verified.');
