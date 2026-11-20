const fs = require('fs');
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

const path = require('path');
const appJs = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
const match = appJs.match(/function arrangeHandOptimal[\s\S]*?return finalHand;\s*\}/);
eval(match[0]);

const hand = [
  { id: '1', suit: '♣', rank: '10' },
  { id: '2', suit: '♣', rank: 'J' },
  { id: '3', suit: '♣', rank: '9' },
  { id: '4', suit: '♦', rank: '2' },
  { id: '5', suit: '♥', rank: '5' }
];

const res = arrangeHandOptimal(hand, {});
console.log('Result:', res.map(c => c.rank + c.suit).join(' '));

