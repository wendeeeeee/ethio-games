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
  return card.isJoker || false;
}

const { isValidTris, isValidQuatris } = require('./engine/conquerRules');
const match = appJs.match(/function findSingleBestArrangement[\s\S]*?function arrangeHandOptimal[\s\S]*?return best \? best\.arrangedCards : \(hand \|\| \[\]\);\s*\}/);
eval(match[0]);

// A realistic 14-card hand
const hand = [
  { id: 'c1', suit: '♣', rank: '10', pointValue: 10 },
  { id: 'c2', suit: '♣', rank: 'J', pointValue: 10 },
  { id: 'c3', suit: '♣', rank: '9', pointValue: 9 },
  { id: 'c4', suit: '♠', rank: '2', pointValue: 2 },
  { id: 'c5', suit: '♠', rank: '3', pointValue: 3 },
  { id: 'c6', suit: '♠', rank: '4', pointValue: 4 },
  { id: 'c7', suit: '♥', rank: '7', pointValue: 7 },
  { id: 'c8', suit: '♦', rank: '7', pointValue: 7 },
  { id: 'c9', suit: '♣', rank: '7', pointValue: 7 },
  { id: 'c10', suit: '♥', rank: 'K', pointValue: 10 },
  { id: 'c11', suit: '♦', rank: 'K', pointValue: 10 },
  { id: 'c12', suit: '♠', rank: 'A', pointValue: 11 },
  { id: 'c13', suit: '♦', rank: '5', pointValue: 5 },
  { id: 'c14', suit: '♥', rank: '9', pointValue: 9 }
];

const res = arrangeHandOptimal(hand, {});
console.log('Result:');
console.log(res.map(c => c.rank + c.suit).join(' '));

