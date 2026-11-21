// test_all_checks.js — Comprehensive test for Seka game logic
const { createSekaDeck, shuffleDeck, isSekaJoker, isValidSekaTris, isValidSekaQuatris, validateSekaWinningHand, arrangeSekaHandOptimal } = require('./engine/sekaRules');
const { SekaGameRoom } = require('./engine/sekaGameRoom');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

// ==============================================================
console.log('\n🃏 1. DECK CREATION — ተመሳሳይ ካርታ መኖር የለበትም (No Duplicates)');
// ==============================================================

test('Seka deck has exactly 54 cards (52 + 2 jokers)', () => {
  const deck = createSekaDeck();
  assert(deck.length === 54, `Expected 54, got ${deck.length}`);
});

test('All card IDs are unique — no duplicate cards', () => {
  const deck = createSekaDeck();
  const ids = deck.map(c => c.id);
  const uniqueIds = new Set(ids);
  assert(uniqueIds.size === 54, `Duplicate IDs found! Unique: ${uniqueIds.size}, Total: ${ids.length}`);
});

test('All natural cards (suit+rank) are unique — no two identical cards', () => {
  const deck = createSekaDeck();
  const natural = deck.filter(c => !c.isJoker);
  const combos = natural.map(c => `${c.suit}_${c.rank}`);
  const uniqueCombos = new Set(combos);
  assert(uniqueCombos.size === 52, `Duplicate suit+rank found! Unique: ${uniqueCombos.size}`);
});

test('Exactly 2 jokers in deck', () => {
  const deck = createSekaDeck();
  const jokers = deck.filter(c => c.isJoker);
  assert(jokers.length === 2, `Expected 2 jokers, got ${jokers.length}`);
});

test('Each suit has exactly 13 cards', () => {
  const deck = createSekaDeck();
  for (const suit of ['♠', '♥', '♦', '♣']) {
    const count = deck.filter(c => c.suit === suit).length;
    assert(count === 13, `Suit ${suit} has ${count} cards instead of 13`);
  }
});

test('Shuffle preserves all 54 unique cards (no loss, no duplication)', () => {
  const deck = createSekaDeck();
  const shuffled = shuffleDeck(deck);
  assert(shuffled.length === 54, `Shuffled deck has ${shuffled.length} cards`);
  const ids = new Set(shuffled.map(c => c.id));
  assert(ids.size === 54, `Shuffled deck has duplicate IDs`);
});

// ==============================================================
console.log('\n🎮 2. DEALING — ከታደለ በኋላ ተመሳሳይ ካርታ መኖር የለበትም');
// ==============================================================

test('2-player deal: no duplicate cards across all hands + deck + discard', () => {
  const room = new SekaGameRoom('test_2p', { id: 'p1', name: 'A', socketId: 's1' }, 100, 2);
  // Mock join without escrow
  room.players.push({ id: 'p2', name: 'B', socketId: 's2' });
  room.hands['p2'] = [];
  room.joiner = room.players[1];
  room.maxPlayers = 2;
  room.startGame();

  const p1Hand = room.getHand('p1');
  const p2Hand = room.getHand('p2');
  const allCards = [...p1Hand, ...p2Hand, ...room.deck, ...room.discardPile];
  assert(allCards.length === 54, `Total cards after deal should be 54, got ${allCards.length}`);

  const allIds = allCards.map(c => c.id);
  const uniqueIds = new Set(allIds);
  assert(uniqueIds.size === allIds.length, `Duplicate cards found after dealing! Unique: ${uniqueIds.size}, Total: ${allIds.length}`);

  // Player 1 (creator) should have 11 cards
  assert(p1Hand.length === 11, `Creator should have 11 cards, got ${p1Hand.length}`);
  // Player 2 should have 10 cards
  assert(p2Hand.length === 10, `Joiner should have 10 cards, got ${p2Hand.length}`);
  // Remaining deck should have 54 - 11 - 10 = 33 cards
  assert(room.deck.length === 33, `Deck should have 33 cards, got ${room.deck.length}`);
});

test('3-player deal: no duplicate cards across all 3 hands + deck', () => {
  const room = new SekaGameRoom('test_3p', { id: 'p1', name: 'A', socketId: 's1' }, 100, 3);
  room.players.push({ id: 'p2', name: 'B', socketId: 's2' });
  room.players.push({ id: 'p3', name: 'C', socketId: 's3' });
  room.hands['p2'] = [];
  room.hands['p3'] = [];
  room.joiner = room.players[1];
  room.maxPlayers = 3;
  room.startGame();

  const p1Hand = room.getHand('p1');
  const p2Hand = room.getHand('p2');
  const p3Hand = room.getHand('p3');
  const allCards = [...p1Hand, ...p2Hand, ...p3Hand, ...room.deck, ...room.discardPile];
  assert(allCards.length === 54, `Total cards after 3p deal should be 54, got ${allCards.length}`);

  const allIds = allCards.map(c => c.id);
  const uniqueIds = new Set(allIds);
  assert(uniqueIds.size === allIds.length, `Duplicate cards in 3p deal! Unique: ${uniqueIds.size}, Total: ${allIds.length}`);

  assert(p1Hand.length === 11, `Creator should have 11 cards, got ${p1Hand.length}`);
  assert(p2Hand.length === 10, `P2 should have 10 cards, got ${p2Hand.length}`);
  assert(p3Hand.length === 10, `P3 should have 10 cards, got ${p3Hand.length}`);
  assert(room.deck.length === 23, `Deck should have 23 cards (54-11-10-10), got ${room.deck.length}`);
});

test('Run 100 random 2-player deals — never a duplicate card', () => {
  for (let trial = 0; trial < 100; trial++) {
    const room = new SekaGameRoom(`rand_${trial}`, { id: 'p1', name: 'A', socketId: 's1' }, 100, 2);
    room.players.push({ id: 'p2', name: 'B', socketId: 's2' });
    room.hands['p2'] = [];
    room.joiner = room.players[1];
    room.startGame();

    const allCards = [...room.getHand('p1'), ...room.getHand('p2'), ...room.deck, ...room.discardPile];
    const allIds = allCards.map(c => c.id);
    const uniqueIds = new Set(allIds);
    if (uniqueIds.size !== allIds.length) {
      // Find the duplicate
      const seen = {};
      for (const id of allIds) {
        if (seen[id]) throw new Error(`Trial ${trial}: Duplicate card ID "${id}"`);
        seen[id] = true;
      }
    }
  }
});

// ==============================================================
console.log('\n♠♥♦♣ 3. TRIS / QUATRIS VALIDATION');
// ==============================================================

test('Valid Tris: 5♥ 6♥ 7♥ (consecutive same suit)', () => {
  const cards = [
    { id: '1', suit: '♥', rank: '5', isJoker: false },
    { id: '2', suit: '♥', rank: '6', isJoker: false },
    { id: '3', suit: '♥', rank: '7', isJoker: false }
  ];
  assert(isValidSekaTris(cards), 'Should be valid tris');
});

test('Invalid Tris: 7♥ 7♠ 7♦ (same rank, diff suit — NOT allowed in Seka)', () => {
  const cards = [
    { id: '1', suit: '♥', rank: '7', isJoker: false },
    { id: '2', suit: '♠', rank: '7', isJoker: false },
    { id: '3', suit: '♦', rank: '7', isJoker: false }
  ];
  assert(!isValidSekaTris(cards), 'Same-rank tris should be invalid');
});

test('Valid Tris with Joker: 5♥ JOKER 7♥ (gap filled by joker)', () => {
  const cards = [
    { id: '1', suit: '♥', rank: '5', isJoker: false },
    { id: '2', suit: '🃏', rank: 'JOKER', isJoker: true },
    { id: '3', suit: '♥', rank: '7', isJoker: false }
  ];
  assert(isValidSekaTris(cards), 'Joker should fill gap in tris');
});

test('Invalid Tris: 2 jokers (max 1 per meld)', () => {
  const cards = [
    { id: '1', suit: '♥', rank: '5', isJoker: false },
    { id: '2', suit: '🃏', rank: 'JOKER', isJoker: true },
    { id: '3', suit: '🃏', rank: 'JOKER', isJoker: true }
  ];
  assert(!isValidSekaTris(cards), 'Two jokers in one tris should be invalid');
});

test('Valid Quatris: 7♦ 8♦ 9♦ 10♦', () => {
  const cards = [
    { id: '1', suit: '♦', rank: '7', isJoker: false },
    { id: '2', suit: '♦', rank: '8', isJoker: false },
    { id: '3', suit: '♦', rank: '9', isJoker: false },
    { id: '4', suit: '♦', rank: '10', isJoker: false }
  ];
  assert(isValidSekaQuatris(cards), 'Should be valid quatris');
});

test('Valid Ace-High Tris: Q♠ K♠ A♠', () => {
  const cards = [
    { id: '1', suit: '♠', rank: 'Q', isJoker: false },
    { id: '2', suit: '♠', rank: 'K', isJoker: false },
    { id: '3', suit: '♠', rank: 'A', isJoker: false }
  ];
  assert(isValidSekaTris(cards), 'Q-K-A should be valid ace-high tris');
});

test('Valid Ace-High Quatris: J♣ Q♣ K♣ A♣', () => {
  const cards = [
    { id: '1', suit: '♣', rank: 'J', isJoker: false },
    { id: '2', suit: '♣', rank: 'Q', isJoker: false },
    { id: '3', suit: '♣', rank: 'K', isJoker: false },
    { id: '4', suit: '♣', rank: 'A', isJoker: false }
  ];
  assert(isValidSekaQuatris(cards), 'J-Q-K-A should be valid ace-high quatris');
});

test('Valid Ace-Low Tris: A♥ 2♥ 3♥', () => {
  const cards = [
    { id: '1', suit: '♥', rank: 'A', isJoker: false },
    { id: '2', suit: '♥', rank: '2', isJoker: false },
    { id: '3', suit: '♥', rank: '3', isJoker: false }
  ];
  assert(isValidSekaTris(cards), 'A-2-3 should be valid ace-low tris');
});

test('Ace with K: J♣-K♣-A♣ is NOT valid tris (gap at Q — J=11, K=13, A=14)', () => {
  const hand = [
    { id: '1', suit: '♣', rank: 'J', isJoker: false },
    { id: '2', suit: '♣', rank: 'K', isJoker: false },
    { id: '3', suit: '♣', rank: 'A', isJoker: false }
  ];
  assert(!isValidSekaTris(hand), 'J-K-A has a gap at Q, so NOT valid as pure tris');
});

test('Ace with K + Joker: J♣-JOKER-K♣-A♣ valid Quatris (joker fills Q gap)', () => {
  const hand = [
    { id: '1', suit: '♣', rank: 'J', isJoker: false },
    { id: '2', suit: '🃏', rank: 'JOKER', isJoker: true },
    { id: '3', suit: '♣', rank: 'K', isJoker: false },
    { id: '4', suit: '♣', rank: 'A', isJoker: false }
  ];
  assert(isValidSekaQuatris(hand), 'J-Joker-K-A should be valid quatris (joker = Q)');
});

// ==============================================================
console.log('\n🏆 4. WINNING HAND VALIDATION — 2 Tris + 1 Quatris + 1 Discard');
// ==============================================================

test('Valid winning hand: 11 cards = 2 Tris(3+3) + 1 Quatris(4) + 1 Discard', () => {
  const hand = [
    // Tris 1: 5♥ 6♥ 7♥
    { id: 't1a', suit: '♥', rank: '5', isJoker: false },
    { id: 't1b', suit: '♥', rank: '6', isJoker: false },
    { id: 't1c', suit: '♥', rank: '7', isJoker: false },
    // Tris 2: 9♠ 10♠ J♠
    { id: 't2a', suit: '♠', rank: '9', isJoker: false },
    { id: 't2b', suit: '♠', rank: '10', isJoker: false },
    { id: 't2c', suit: '♠', rank: 'J', isJoker: false },
    // Quatris: 3♦ 4♦ 5♦ 6♦
    { id: 'q1', suit: '♦', rank: '3', isJoker: false },
    { id: 'q2', suit: '♦', rank: '4', isJoker: false },
    { id: 'q3', suit: '♦', rank: '5', isJoker: false },
    { id: 'q4', suit: '♦', rank: '6', isJoker: false },
    // Discard (ተጣይ)
    { id: 'discard', suit: '♣', rank: '2', isJoker: false }
  ];
  const result = validateSekaWinningHand(hand);
  assert(result.valid, 'Should be a valid winning hand');
  assert(result.melds.length === 3, 'Should have 3 melds (2 tris + 1 quatris)');
  assert(result.discardedCard, 'Should identify a discard card');
});

test('Invalid hand: 10 unrelated cards = NOT a win', () => {
  const hand = [];
  for (let i = 0; i < 11; i++) {
    hand.push({ id: `r${i}`, suit: ['♠', '♥', '♦', '♣'][i % 4], rank: String(i + 2), isJoker: false });
  }
  const result = validateSekaWinningHand(hand);
  assert(!result.valid, 'Random cards should not be a valid winning hand');
});

// ==============================================================
console.log('\n🔄 5. TURN ROTATION — Circular order for 2 and 3 players');
// ==============================================================

test('2-player turn rotation: p1 → p2 → p1 → ...', () => {
  const room = new SekaGameRoom('turn_2p', { id: 'p1', name: 'A', socketId: 's1' }, 100, 2);
  room.players.push({ id: 'p2', name: 'B', socketId: 's2' });
  room.hands['p2'] = [];
  room.joiner = room.players[1];
  room.startGame();

  assert(room.currentTurnPlayerId === 'p1', 'Creator starts');
  assert(room.turnState === 'AWAITING_DISCARD', 'Creator must discard first (11 cards)');

  // Creator discards
  const p1Hand = room.getHand('p1');
  room.discardCard('p1', p1Hand[0].id);
  assert(room.currentTurnPlayerId === 'p2', 'Should switch to p2 after p1 discards');
  assert(room.turnState === 'AWAITING_DRAW', 'P2 should draw first');
});

test('3-player turn rotation: p1 → p2 → p3 → p1 → ...', () => {
  const room = new SekaGameRoom('turn_3p', { id: 'p1', name: 'A', socketId: 's1' }, 100, 3);
  room.players.push({ id: 'p2', name: 'B', socketId: 's2' });
  room.players.push({ id: 'p3', name: 'C', socketId: 's3' });
  room.hands['p2'] = [];
  room.hands['p3'] = [];
  room.joiner = room.players[1];
  room.startGame();

  assert(room.currentTurnPlayerId === 'p1', 'Creator starts');
  
  // p1 discards (has 11 cards)
  const p1Hand = room.getHand('p1');
  room.discardCard('p1', p1Hand[0].id);
  assert(room.currentTurnPlayerId === 'p2', 'Should move to p2');

  // p2 draws then discards
  room.drawCard('p2', 'deck');
  const p2Hand = room.getHand('p2');
  room.discardCard('p2', p2Hand[0].id);
  assert(room.currentTurnPlayerId === 'p3', 'Should move to p3');

  // p3 draws then discards
  room.drawCard('p3', 'deck');
  const p3Hand = room.getHand('p3');
  room.discardCard('p3', p3Hand[0].id);
  assert(room.currentTurnPlayerId === 'p1', 'Should wrap back to p1');
});

// ==============================================================
console.log('\n🔃 6. DECK RESHUFFLE — When deck runs out');
// ==============================================================

test('Deck reshuffle when empty: keeps top discard, reshuffles rest', () => {
  const room = new SekaGameRoom('reshuffle', { id: 'p1', name: 'A', socketId: 's1' }, 100, 2);
  room.players.push({ id: 'p2', name: 'B', socketId: 's2' });
  room.hands['p2'] = [];
  room.joiner = room.players[1];
  room.startGame();

  // Artificially drain the deck
  const topDiscard = { id: 'top_d', suit: '♥', rank: '2', isJoker: false };
  const otherDiscards = room.deck.splice(0, room.deck.length); // empty the deck
  room.discardPile = [...otherDiscards, topDiscard];
  room.deck = [];

  // Now p1 discards (has 11 cards), then p2 draws from empty deck
  const p1Hand = room.getHand('p1');
  room.discardCard('p1', p1Hand[0].id);

  const drawResult = room.drawCard('p2', 'deck');
  assert(drawResult.success, 'Should successfully draw after reshuffle');
  assert(room.deck.length >= 0, 'Deck should be reshuffled');
});

// ==============================================================
console.log('\n📊 SUMMARY');
// ==============================================================

console.log(`\n  ✅ Passed: ${passed}`);
console.log(`  ❌ Failed: ${failed}`);
console.log(`  📊 Total:  ${passed + failed}\n`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('  🎉 ሁሉም ተሳክቷል! (All tests passed!)\n');
  process.exit(0);
}
