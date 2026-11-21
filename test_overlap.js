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

const { isValidTris, isValidQuatris } = require('./engine/conquerRules');
const match = appJs.match(/function findSingleBestArrangement[\s\S]*?function arrangeHandOptimal[\s\S]*?return best \? best\.arrangedCards : \(hand \|\| \[\]\);\s*\}/);
eval(match[0]);

// Scenario A: 8, 9, 10, J of clubs
const handA = [
  { id: '1', suit: '♣', rank: '8', pointValue: 8 },
  { id: '2', suit: '♣', rank: '9', pointValue: 9 },
  { id: '3', suit: '♣', rank: '10', pointValue: 10 },
  { id: '4', suit: '♣', rank: 'J', pointValue: 10 },
  { id: '5', suit: '♥', rank: '2', pointValue: 2 }
];
console.log('Scenario A (8, 9, 10, J of clubs):', arrangeHandOptimal(handA, {}).map(c => c.rank + c.suit).join(' '));

// Scenario B: What if user had 9♣, 10♣, J♣, but also Q♣?
const handB = [
  { id: '1', suit: '♣', rank: '9', pointValue: 9 },
  { id: '2', suit: '♣', rank: '10', pointValue: 10 },
  { id: '3', suit: '♣', rank: 'J', pointValue: 10 },
  { id: '4', suit: '♣', rank: 'Q', pointValue: 10 },
  { id: '5', suit: '♥', rank: '2', pointValue: 2 }
];
console.log('Scenario B (9, 10, J, Q of clubs):', arrangeHandOptimal(handB, {}).map(c => c.rank + c.suit).join(' '));

// Scenario C: What if user had 9♣, 10♣, J♣, and J♦?
const handC = [
  { id: '1', suit: '♣', rank: '9', pointValue: 9 },
  { id: '2', suit: '♣', rank: '10', pointValue: 10 },
  { id: '3', suit: '♣', rank: 'J', pointValue: 10 },
  { id: '4', suit: '♦', rank: 'J', pointValue: 10 },
  { id: '5', suit: '♥', rank: '2', pointValue: 2 }
];
console.log('Scenario C (9♣, 10♣, J♣, J♦):', arrangeHandOptimal(handC, {}).map(c => c.rank + c.suit).join(' '));

