const fs = require('fs');
const path = require('path');
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
  return card.isJoker || (state && state.jokerRank === card.rank);
}

const match = appJs.match(/function arrangeHandOptimal[\s\S]*?return finalHand;\s*\}/);
eval(match[0]);

// Scenario 1: Just 9, 10, J of clubs with other random cards
const hand1 = [
  { id: '1', suit: '♣', rank: '10', pointValue: 10 },
  { id: '2', suit: '♣', rank: 'J', pointValue: 10 },
  { id: '3', suit: '♣', rank: '9', pointValue: 9 },
  { id: '4', suit: '♦', rank: '10', pointValue: 10 },
  { id: '5', suit: '♥', rank: '10', pointValue: 10 }
];
console.log('Scenario 1 (two other 10s):', arrangeHandOptimal(hand1, {}).map(c => c.rank + c.suit).join(' '));

// Scenario 2: Two other 9s
const hand2 = [
  { id: '1', suit: '♣', rank: '10', pointValue: 10 },
  { id: '2', suit: '♣', rank: 'J', pointValue: 10 },
  { id: '3', suit: '♣', rank: '9', pointValue: 9 },
  { id: '4', suit: '♦', rank: '9', pointValue: 9 },
  { id: '5', suit: '♥', rank: '9', pointValue: 9 }
];
console.log('Scenario 2 (two other 9s):', arrangeHandOptimal(hand2, {}).map(c => c.rank + c.suit).join(' '));

// Scenario 3: J is Joker
const hand3 = [
  { id: '1', suit: '♣', rank: '10', pointValue: 10 },
  { id: '2', suit: '♣', rank: 'J', pointValue: 10, isJoker: true },
  { id: '3', suit: '♣', rank: '9', pointValue: 9 },
  { id: '4', suit: '♦', rank: '3', pointValue: 3 },
  { id: '5', suit: '♥', rank: '5', pointValue: 5 }
];
console.log('Scenario 3 (J is Joker):', arrangeHandOptimal(hand3, { jokerRank: 'J' }).map(c => c.rank + c.suit).join(' '));

// Scenario 4: 9 is Joker
const hand4 = [
  { id: '1', suit: '♣', rank: '10', pointValue: 10 },
  { id: '2', suit: '♣', rank: 'J', pointValue: 10 },
  { id: '3', suit: '♣', rank: '9', pointValue: 9, isJoker: true },
  { id: '4', suit: '♦', rank: '3', pointValue: 3 },
  { id: '5', suit: '♥', rank: '5', pointValue: 5 }
];
console.log('Scenario 4 (9 is Joker):', arrangeHandOptimal(hand4, { jokerRank: '9' }).map(c => c.rank + c.suit).join(' '));

// Scenario 5: 10 is Joker
const hand5 = [
  { id: '1', suit: '♣', rank: '10', pointValue: 10, isJoker: true },
  { id: '2', suit: '♣', rank: 'J', pointValue: 10 },
  { id: '3', suit: '♣', rank: '9', pointValue: 9 },
  { id: '4', suit: '♦', rank: '3', pointValue: 3 },
  { id: '5', suit: '♥', rank: '5', pointValue: 5 }
];
console.log('Scenario 5 (10 is Joker):', arrangeHandOptimal(hand5, { jokerRank: '10' }).map(c => c.rank + c.suit).join(' '));

