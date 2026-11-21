// test_seka_rules.js
const {
  createSekaDeck,
  isSekaJoker,
  isValidSekaTris,
  isValidSekaQuatris,
  partition10CardsIntoSekaMelds,
  validateSekaWinningHand
} = require('./engine/sekaRules');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    testsPassed++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    testsFailed++;
  }
}

console.log('--- RUNNING SEKA RULES UNIT TESTS ---');

// Test 1: Deck creation
const deck = createSekaDeck();
assert(deck.length === 54, `Deck has 54 cards (got ${deck.length})`);
const jokers = deck.filter(isSekaJoker);
assert(jokers.length === 2, `Deck has 2 wild printed jokers (got ${jokers.length})`);

// Test 2: Suited Tris (ጦር)
const validTris1 = [
  { suit: '♥', rank: '5' },
  { suit: '♥', rank: '6' },
  { suit: '♥', rank: '7' }
];
assert(isValidSekaTris(validTris1), '5♥ 6♥ 7♥ is a valid Seka Tris');

// Test 3: Ace Low & Ace High Tris
const aceLowTris = [
  { suit: '♠', rank: 'A' },
  { suit: '♠', rank: '2' },
  { suit: '♠', rank: '3' }
];
assert(isValidSekaTris(aceLowTris), 'A♠ 2♠ 3♠ is a valid Seka Tris');

const aceHighTris = [
  { suit: '♦', rank: 'Q' },
  { suit: '♦', rank: 'K' },
  { suit: '♦', rank: 'A' }
];
assert(isValidSekaTris(aceHighTris), 'Q♦ K♦ A♦ is a valid Seka Tris');

// Test 4: Same-rank set MUST BE REJECTED! (Seka rule: ጦር ብቻ)
const sameRankTris = [
  { suit: '♠', rank: '7' },
  { suit: '♥', rank: '7' },
  { suit: '♦', rank: '7' }
];
assert(!isValidSekaTris(sameRankTris), '7♠ 7♥ 7♦ is REJECTED (same rank not allowed in Seka)');

// Test 5: Mixed suits sequence MUST BE REJECTED!
const mixedSuitTris = [
  { suit: '♠', rank: '5' },
  { suit: '♥', rank: '6' },
  { suit: '♠', rank: '7' }
];
assert(!isValidSekaTris(mixedSuitTris), '5♠ 6♥ 7♠ is REJECTED (different suits)');

// Test 6: Tris with 1 Wild Joker
const trisWithJoker1 = [
  { suit: '♣', rank: '9' },
  { suit: '🃏', rank: 'JOKER', isJoker: true },
  { suit: '♣', rank: 'J' }
];
assert(isValidSekaTris(trisWithJoker1), '9♣ Joker J♣ is a valid Seka Tris');

const trisWithJoker2 = [
  { suit: '♦', rank: 'K' },
  { suit: '♦', rank: 'A' },
  { suit: '🃏', rank: 'JOKER', isJoker: true }
];
assert(isValidSekaTris(trisWithJoker2), 'K♦ A♦ Joker (as Q♦) is a valid Seka Tris');

// Test 7: Tris with 2 Jokers MUST BE REJECTED (max 1 joker per meld)
const trisWith2Jokers = [
  { suit: '♥', rank: '5' },
  { suit: '🃏', rank: 'JOKER', isJoker: true },
  { suit: '🃏', rank: 'JOKER', isJoker: true }
];
assert(!isValidSekaTris(trisWith2Jokers), 'Tris with 2 Jokers is REJECTED');

// Test 8: Suited Quatris (ጦር 4 cards)
const validQuatris1 = [
  { suit: '♦', rank: '7' },
  { suit: '♦', rank: '8' },
  { suit: '♦', rank: '9' },
  { suit: '♦', rank: '10' }
];
assert(isValidSekaQuatris(validQuatris1), '7♦ 8♦ 9♦ 10♦ is a valid Seka Quatris');

// Test 9: Same-rank Quatris MUST BE REJECTED!
const sameRankQuatris = [
  { suit: '♠', rank: '8' },
  { suit: '♥', rank: '8' },
  { suit: '♦', rank: '8' },
  { suit: '♣', rank: '8' }
];
assert(!isValidSekaQuatris(sameRankQuatris), '8♠ 8♥ 8♦ 8♣ is REJECTED (same rank not allowed)');

// Test 10: Quatris with 1 Wild Joker
const quatrisWithJoker = [
  { suit: '♠', rank: '10' },
  { suit: '♠', rank: 'J' },
  { suit: '🃏', rank: 'JOKER', isJoker: true },
  { suit: '♠', rank: 'K' }
];
assert(isValidSekaQuatris(quatrisWithJoker), '10♠ J♠ Joker K♠ is a valid Seka Quatris');

// Test 11: Seka 10-card Partition into 2 Tris + 1 Quatris
const winning10Cards = [
  // Tris 1 (3 cards)
  { id: '1', suit: '♥', rank: '4' },
  { id: '2', suit: '♥', rank: '5' },
  { id: '3', suit: '♥', rank: '6' },
  // Tris 2 (3 cards)
  { id: '4', suit: '♠', rank: '9' },
  { id: '5', suit: '🃏', rank: 'JOKER', isJoker: true },
  { id: '6', suit: '♠', rank: 'J' },
  // Quatris (4 cards)
  { id: '7', suit: '♦', rank: '7' },
  { id: '8', suit: '♦', rank: '8' },
  { id: '9', suit: '♦', rank: '9' },
  { id: '10', suit: '♦', rank: '10' }
];
const partitionRes = partition10CardsIntoSekaMelds(winning10Cards);
assert(partitionRes.valid, '10 cards successfully partition into 2 Tris + 1 Quatris');
assert(partitionRes.melds.length === 3, 'Melds contain 3 groups');

// Test 12: Seka 11-card Winning Hand (2 Tris + 1 Quatris + 1 Discard)
const hand11Cards = [
  ...winning10Cards,
  { id: '11', suit: '♣', rank: '2' } // Discard / ተጣይ
];
const winResWithDiscard = validateSekaWinningHand(hand11Cards, { id: '11' });
assert(winResWithDiscard.valid, '11 cards with specific discard validates as Seka win');
assert(winResWithDiscard.discardedCard.id === '11', 'Discarded card correctly identified as id 11');

// Test 13: Auto-detect winning discard from 11 cards
const winResAuto = validateSekaWinningHand(hand11Cards);
assert(winResAuto.valid, 'Auto-detect validates 11 cards as Seka win');
assert(winResAuto.discardedCard.id === '11', 'Auto-detect correctly finds id 11 as the winning discard');

// Test 14: Non-winning hand fails
const nonWinningHand = [
  ...winning10Cards.slice(0, 8),
  { id: '99', suit: '♣', rank: '2' },
  { id: '100', suit: '♣', rank: '9' },
  { id: '101', suit: '♦', rank: 'A' }
];
const failRes = validateSekaWinningHand(nonWinningHand);
assert(!failRes.valid, 'Non-winning hand correctly rejected');

// Test 15: SekaGameRoom Lifecycle
const { SekaGameRoom } = require('./engine/sekaGameRoom');
const walletManager = require('./engine/walletManager');

// Deposit wallets for test players
walletManager.deposit('player_1', 500);
walletManager.deposit('player_2', 500);

const room = new SekaGameRoom('test_seka_1', { id: 'player_1', name: 'Abebe' }, 100);
assert(room.status === 'WAITING', 'Room status starts as WAITING');

const joinRes = room.join({ id: 'player_2', name: 'Kebede' });
assert(joinRes.success, 'Player 2 joins successfully');
assert(room.status === 'PLAYING', 'Room transitions directly to PLAYING');
assert(room.pot === 200, `Pot is 200 ETB (got ${room.pot})`);
assert(room.creatorHand.length === 11, `Creator gets 11 cards (got ${room.creatorHand.length})`);
assert(room.joinerHand.length === 10, `Joiner gets 10 cards (got ${room.joinerHand.length})`);
assert(room.currentTurnPlayerId === 'player_1', 'Creator (Starter) has first turn');
assert(room.turnState === 'AWAITING_DISCARD', 'Starter starts in AWAITING_DISCARD');

// Test 16: Starter Discards 1st Card
const firstDiscardCard = room.creatorHand[0];
const discardRes = room.discardCard('player_1', firstDiscardCard.id);
assert(discardRes.success, 'Creator discards first card');
assert(room.creatorHand.length === 10, `Creator now has 10 cards (got ${room.creatorHand.length})`);
assert(room.discardPile.length === 1, 'Discard pile has 1 card');
assert(room.currentTurnPlayerId === 'player_2', 'Turn passed to Player 2 (Joiner)');
assert(room.turnState === 'AWAITING_DRAW', 'Player 2 is in AWAITING_DRAW');

// Test 17: Player 2 Free Ground Draw (Seka rule: freely pick from ground)
const groundCard = room.discardPile[0];
const drawGroundRes = room.drawCard('player_2', 'ground');
assert(drawGroundRes.success, 'Player 2 draws from ground freely without 41 restriction');
assert(drawGroundRes.card.id === groundCard.id, 'Drew the correct card from ground');
assert(room.joinerHand.length === 11, 'Player 2 has 11 cards after drawing');
assert(room.turnState === 'AWAITING_DISCARD', 'Player 2 is in AWAITING_DISCARD');

// Test 18: Player 2 Discard
const p2Discard = room.joinerHand[0];
const p2DiscardRes = room.discardCard('player_2', p2Discard.id);
assert(p2DiscardRes.success, 'Player 2 discards');
assert(room.joinerHand.length === 10, 'Player 2 has 10 cards');
assert(room.currentTurnPlayerId === 'player_1', 'Turn passed back to Player 1');

// Test 19: Player 1 Claims Win with 11 cards (2 Tris + 1 Quatris + 1 Discard)
room.creatorHand = [
  // Tris 1 (3♥ 4♥ 5♥)
  { id: 'w1', suit: '♥', rank: '3' },
  { id: 'w2', suit: '♥', rank: '4' },
  { id: 'w3', suit: '♥', rank: '5' },
  // Tris 2 (9♠ 10♠ J♠)
  { id: 'w4', suit: '♠', rank: '9' },
  { id: 'w5', suit: '♠', rank: '10' },
  { id: 'w6', suit: '♠', rank: 'J' },
  // Quatris (7♦ 8♦ 9♦ 10♦)
  { id: 'w7', suit: '♦', rank: '7' },
  { id: 'w8', suit: '♦', rank: '8' },
  { id: 'w9', suit: '♦', rank: '9' },
  { id: 'w10', suit: '♦', rank: '10' },
  // Discard / ተጣይ
  { id: 'w11_tetay', suit: '♣', rank: 'K' }
];
room.turnState = 'AWAITING_DISCARD';
room.currentTurnPlayerId = 'player_1';

const claimRes = room.claimWin('player_1', 'w11_tetay');
assert(claimRes.success, 'Player 1 claims win successfully');
assert(claimRes.isWin, 'Winning confirmed');
assert(room.status === 'FINISHED', 'Room status is FINISHED');
assert(room.winner.id === 'player_1', 'Player 1 is recorded as winner');

console.log(`\nResults: ${testsPassed} passed, ${testsFailed} failed.`);
process.exit(testsFailed === 0 ? 0 : 1);

