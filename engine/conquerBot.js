// engine/conquerBot.js
// Smart AI Bot logic for Ethiopian Conquer

const { getCardPointValue, RANK_VALUES } = require('./cardTypes');
const {
  isValidTris,
  isValidQuatris,
  getMeldPoints,
  findDubeWin,
  isCardGebiToMeld
} = require('./conquerRules');

function isBotJoker(card, room) {
  if (!card) return false;
  if (card.isJoker) return true;
  if (room.jokerRank && card.rank === room.jokerRank) {
    if (Array.isArray(room.jokerSuits) && room.jokerSuits.length > 0) {
      return room.jokerSuits.includes(card.suit);
    }
    return true;
  }
  return false;
}

/**
 * Greedily finds disjoint valid melds (Quatris sequences first, then Tris sets)
 * from a hand of cards.
 */
function findDisjointMelds(hand, jokerRank, jokerSuits) {
  const usedIds = new Set();
  const melds = [];

  // 1. Find pure sequences (3-4+ same suit consecutive) without consuming jokers first
  const bySuit = {};
  for (const c of hand) {
    if (c.isJoker || c.rank === jokerRank) continue;
    if (!bySuit[c.suit]) bySuit[c.suit] = [];
    bySuit[c.suit].push(c);
  }

  for (const suit of Object.keys(bySuit)) {
    const cards = bySuit[suit].sort((a, b) => (RANK_VALUES[a.rank] || 0) - (RANK_VALUES[b.rank] || 0));
    // Deduplicate ranks for sequence building
    const unique = [];
    const seenRank = new Set();
    for (const c of cards) {
      if (!seenRank.has(c.rank)) {
        seenRank.add(c.rank);
        unique.push(c);
      }
    }
    let i = 0;
    while (i < unique.length) {
      const seq = [unique[i]];
      let j = i + 1;
      while (j < unique.length && (RANK_VALUES[unique[j].rank] - RANK_VALUES[seq[seq.length - 1].rank]) === 1) {
        seq.push(unique[j]);
        j++;
      }
      if (seq.length >= 3 && isValidQuatris(seq, jokerRank, jokerSuits)) {
        melds.push(seq);
        seq.forEach(c => usedIds.add(c.id));
        i = j;
      } else {
        i++;
      }
    }
  }

  // 2. Find pure Tris (3-4 different suits, same rank) from remaining cards
  const remaining = hand.filter(c => !usedIds.has(c.id));
  const byRank = {};
  for (const c of remaining) {
    if (c.isJoker || c.rank === jokerRank) continue;
    if (!byRank[c.rank]) byRank[c.rank] = [];
    byRank[c.rank].push(c);
  }

  for (const rank of Object.keys(byRank)) {
    const group = byRank[rank];
    const uniqueSuit = [];
    const seenSuit = new Set();
    for (const c of group) {
      if (!seenSuit.has(c.suit)) {
        seenSuit.add(c.suit);
        uniqueSuit.push(c);
      }
    }
    if (uniqueSuit.length >= 3 && isValidTris(uniqueSuit.slice(0, 4), jokerRank, jokerSuits)) {
      const tris = uniqueSuit.slice(0, 4);
      melds.push(tris);
      tris.forEach(c => usedIds.add(c.id));
    }
  }

  // 3. Use remaining Jokers to complete 2-card pairs (same rank diff suit) or 2-card near-sequences
  const jokers = hand.filter(c => !usedIds.has(c.id) && (c.isJoker || c.rank === jokerRank));
  if (jokers.length > 0) {
    const remNonJokers = hand.filter(c => !usedIds.has(c.id) && !c.isJoker && c.rank !== jokerRank);
    // Try 2-card same-rank pairs + 1 joker
    const remByRank = {};
    for (const c of remNonJokers) {
      if (!remByRank[c.rank]) remByRank[c.rank] = [];
      remByRank[c.rank].push(c);
    }
    for (const rank of Object.keys(remByRank)) {
      if (jokers.length === 0) break;
      const g = remByRank[rank].filter(c => !usedIds.has(c.id));
      if (g.length >= 2 && g[0].suit !== g[1].suit) {
        const jCard = jokers[0];
        const candidate = [g[0], g[1], jCard];
        if (isValidTris(candidate, jokerRank, jokerSuits)) {
          melds.push(candidate);
          candidate.forEach(c => usedIds.add(c.id));
          jokers.shift();
        }
      }
    }
  }

  const totalPoints = melds.reduce((sum, m) => sum + getMeldPoints(m, jokerRank, jokerSuits), 0);
  const leftovers = hand.filter(c => !usedIds.has(c.id));
  return { melds, totalPoints, leftovers };
}

function chooseSmartDiscard(hand, room) {
  const nonJokers = hand.filter(c => !isBotJoker(c, room));
  if (nonJokers.length === 0) return hand[0];

  let worstCard = nonJokers[0];
  let lowestScore = Infinity;

  for (const card of nonJokers) {
    let score = 0;
    const rankVal = RANK_VALUES[card.rank] || 0;
    for (const other of hand) {
      if (other.id === card.id) continue;
      if (other.rank === card.rank && other.suit !== card.suit) {
        score += 14; // Pair / Tris potential
      } else if (other.suit === card.suit) {
        const diff = Math.abs((RANK_VALUES[other.rank] || 0) - rankVal);
        if (diff === 1) score += 14;
        else if (diff === 2) score += 6;
        else if (diff === 0) score -= 5; // Duplicate dead card
      }
    }
    // Slightly prefer shedding high-point deadwood
    score -= getCardPointValue(card) * 0.15;

    if (score < lowestScore) {
      lowestScore = score;
      worstCard = card;
    }
  }

  return worstCard;
}

function executeSmartBotDiscard(room, botId, broadcastRoomUpdate) {
  if (room.status !== 'PLAYING' || room.currentTurnPlayerId !== botId) return;
  if (room.turnState !== 'AWAITING_DISCARD') return;

  const hand = room.getHand(botId);
  const hasOpened = room.tableMelds[botId] && room.tableMelds[botId].length > 0;

  // 1. Check direct Dube Win (13 cards = 1 Tris + 5 Pairs, leaving 1 discard)
  if (!hasOpened && hand.length === 14) {
    for (let i = 0; i < hand.length; i++) {
      const candidateHand = hand.filter((_, idx) => idx !== i);
      const dube = findDubeWin(candidateHand, room.jokerRank, room.jokerSuits);
      if (dube) {
        const res = room.discardCard(botId, hand[i].id, true, null);
        if (res.success) {
          broadcastRoomUpdate(room);
          return;
        }
      }
    }
  }

  // 2. Check Direct Conquer Win (all 13 remaining cards form valid melds + 1 discard)
  if (hand.length >= 4) {
    for (let i = 0; i < hand.length; i++) {
      const candidateHand = hand.filter((_, idx) => idx !== i);
      const { melds, leftovers } = findDisjointMelds(candidateHand, room.jokerRank, room.jokerSuits);
      if (leftovers.length === 0 && melds.length > 0) {
        const res = room.discardCard(botId, hand[i].id, true, melds);
        if (res.success) {
          broadcastRoomUpdate(room);
          return;
        }
      }
    }
  }

  // 3. Open 41+ or lay down new melds (leaving at least 1 card to discard)
  const { melds, totalPoints } = findDisjointMelds(hand, room.jokerRank, room.jokerSuits);
  if (melds.length > 0) {
    const meldedCount = melds.reduce((s, m) => s + m.length, 0);
    // Leave at least 1 card in hand to discard (or if all cards meld, drop 1 card? No, leave 1 card)
    if (hand.length - meldedCount >= 1 && (hasOpened || totalPoints >= 41)) {
      const layRes = room.layDownMelds(botId, melds);
      if (layRes && layRes.success) {
        broadcastRoomUpdate(room);
      }
    }
  }

  // 4. If opened, try attaching Gebi cards onto existing table melds (keeping >= 1 card to discard)
  const afterMeldHand = room.getHand(botId);
  const nowOpened = room.tableMelds[botId] && room.tableMelds[botId].length > 0;
  if (nowOpened && afterMeldHand.length > 1) {
    for (const card of [...afterMeldHand]) {
      if (room.getHand(botId).length <= 1) break;
      let attached = false;
      for (const ownerId of Object.keys(room.tableMelds)) {
        const ownerMelds = room.tableMelds[ownerId] || [];
        for (let mIdx = 0; mIdx < ownerMelds.length; mIdx++) {
          if (isCardGebiToMeld(card, ownerMelds[mIdx], room.jokerRank, room.jokerSuits)) {
            const gRes = room.attachGebiCard(botId, ownerId, mIdx, card.id);
            if (gRes && gRes.success) {
              attached = true;
              break;
            }
          }
        }
        if (attached) break;
      }
    }
  }

  // 5. Smart Discard
  const finalHand = room.getHand(botId);
  if (finalHand.length === 0) return;
  const cardToDiscard = finalHand.length === 1 ? finalHand[0] : chooseSmartDiscard(finalHand, room);
  room.discardCard(botId, cardToDiscard.id, false);
  broadcastRoomUpdate(room);
}

function executeSmartBotTurn(room, broadcastRoomUpdate) {
  setTimeout(() => {
    if (room.status !== 'PLAYING') return;
    const botId = (room.joiner && room.joiner.id.startsWith('bot_')) ? room.joiner.id : room.creator.id;
    if (room.currentTurnPlayerId !== botId) return;

    const botHand = room.getHand(botId);

    // If Bot starts with 14 cards (AWAITING_DISCARD), run smart discard/meld immediately
    if (room.turnState === 'AWAITING_DISCARD') {
      executeSmartBotDiscard(room, botId, broadcastRoomUpdate);
      return;
    }

    // AWAITING_DRAW: Check if top ground card is useful!
    let drewFromGround = false;
    const topGround = room.discardPile.length > 0 ? room.discardPile[room.discardPile.length - 1] : null;
    const hasOpened = room.tableMelds[botId] && room.tableMelds[botId].length > 0;

    if (topGround) {
      if (hasOpened) {
        // Check if ground card is joker, forms a meld with hand, or is Gebi to table
        let wantsGround = isBotJoker(topGround, room);
        if (!wantsGround) {
          const testHand = [...botHand, topGround];
          const { melds } = findDisjointMelds(testHand, room.jokerRank, room.jokerSuits);
          wantsGround = melds.some(m => m.some(c => c.id === topGround.id));
        }
        if (!wantsGround) {
          for (const ownerId of Object.keys(room.tableMelds)) {
            for (const m of (room.tableMelds[ownerId] || [])) {
              if (isCardGebiToMeld(topGround, m, room.jokerRank, room.jokerSuits)) {
                wantsGround = true;
                break;
              }
            }
            if (wantsGround) break;
          }
        }
        if (wantsGround) {
          const gRes = room.drawCard(botId, 'ground');
          if (gRes && gRes.success) drewFromGround = true;
        }
      } else {
        // Not opened yet: can pick from ground if Joker OR if ground card lets us open 41+ immediately
        if (isBotJoker(topGround, room)) {
          const gRes = room.drawCard(botId, 'ground');
          if (gRes && gRes.success) drewFromGround = true;
        } else {
          const testHand = [...botHand, topGround];
          const { melds, totalPoints } = findDisjointMelds(testHand, room.jokerRank, room.jokerSuits);
          const usesGround = melds.some(m => m.some(c => c.id === topGround.id));
          if (usesGround && totalPoints >= 41 && testHand.length - melds.reduce((s, m) => s + m.length, 0) >= 1) {
            const gRes = room.drawCardFromGroundWithMelds(botId, melds);
            if (gRes && gRes.success) drewFromGround = true;
          }
        }
      }
    }

    if (!drewFromGround) {
      room.drawCard(botId, 'deck');
    }
    broadcastRoomUpdate(room);

    // Wait 1.2 seconds then meld / gebi / discard
    setTimeout(() => {
      executeSmartBotDiscard(room, botId, broadcastRoomUpdate);
    }, 1200);
  }, 1100);
}

module.exports = {
  executeSmartBotTurn
};
