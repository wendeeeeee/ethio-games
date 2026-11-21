// engine/cardTypes.js

const SUITS = ['♠', '♥', '♦', '♣'];
const SUIT_NAMES = {
  '♠': 'spades',
  '♥': 'hearts',
  '♦': 'diamonds',
  '♣': 'clubs'
};
const SUIT_COLORS = {
  '♠': 'black',
  '♥': 'red',
  '♦': 'red',
  '♣': 'black'
};

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

// Base point values for reaching 41
function getCardPointValue(rank) {
  if (rank === 'A') return 11;
  if (['K', 'Q', 'J', '10'].includes(rank)) return 10;
  return parseInt(rank, 10);
}

// Numerical order for sequences
const RANK_ORDER = {
  'A': 1, // Can also be high (14) in sequences like 10-J-Q-K-A
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  'J': 11,
  'Q': 12,
  'K': 13
};

// 54-Card Deck for 2 Players: 52 standard cards (26 Black, 26 Red) + 2 Printed False Jokers = 54 cards
function createConquerDeck(playerCount = 2) {
  const deck = [];
  let id = 1;

  // 52 standard cards (4 suits * 13 ranks)
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        id: `card_${suit}_${rank}_${id++}`,
        suit,
        rank,
        suitName: SUIT_NAMES[suit],
        color: SUIT_COLORS[suit],
        pointValue: getCardPointValue(rank),
        isJoker: false,
        isBase: false,
        isFalseJoker: false
      });
    }
  }

  // 2 Printed False Jokers (1 Black, 1 Red) = Exactly 54 cards
  // Rule: False Joker is NOT a wild joker! It only substitutes for the designated cut rank!
  deck.push({
    id: `card_false_joker_1_${id++}`,
    suit: '🃏',
    rank: 'FALSE',
    suitName: 'joker',
    color: 'black',
    pointValue: 0,
    isJoker: false,
    isBase: false,
    isFalseJoker: true
  });

  deck.push({
    id: `card_false_joker_2_${id++}`,
    suit: '🃏',
    rank: 'FALSE',
    suitName: 'joker',
    color: 'red',
    pointValue: 0,
    isJoker: false,
    isBase: false,
    isFalseJoker: true
  });

  return deck; // 54 cards total!
}

// Fisher-Yates Shuffle
function shuffleDeck(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function getNextRank(rank) {
  const idx = RANKS.indexOf(rank);
  if (idx === -1) return '2';
  return RANKS[(idx + 1) % RANKS.length];
}

function getPrevRank(rank) {
  const idx = RANKS.indexOf(rank);
  if (idx === -1) return 'K';
  return RANKS[(idx - 1 + RANKS.length) % RANKS.length];
}

module.exports = {
  SUITS,
  SUIT_NAMES,
  SUIT_COLORS,
  RANKS,
  RANK_ORDER,
  getCardPointValue,
  getNextRank,
  getPrevRank,
  createConquerDeck,
  shuffleDeck
};

