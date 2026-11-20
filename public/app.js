// public/app.js

// Initialize or restore player ID
let userId = localStorage.getItem('conquer_user_id');
if (!userId) {
  userId = 'user_' + Math.floor(1000 + Math.random() * 9000);
  localStorage.setItem('conquer_user_id', userId);
}

let playerName = localStorage.getItem('conquer_user_name') || 'Player ' + userId.slice(-4);
let socket = io();
let currentRoomId = null;
let currentGameState = null;
let selectedCardId = null;
let selectedCardsSet = new Set();

// Audio Synthesizer using Web Audio API (No external sound files required)
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playBeep(freq, type = 'sine', duration = 0.1) {
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) { }
}

function playCardSound() { playBeep(440, 'triangle', 0.08); }
function playPokeSound() { playBeep(880, 'square', 0.2); }
function playWinSound() {
  playBeep(523.25, 'sine', 0.15);
  setTimeout(() => playBeep(659.25, 'sine', 0.15), 150);
  setTimeout(() => playBeep(783.99, 'sine', 0.3), 300);
}

// UI Elements
const lobbyView = document.getElementById('lobbyView');
const gameView = document.getElementById('gameView');
const playerNameInput = document.getElementById('playerNameInput');
const stakeSelect = document.getElementById('stakeSelect');
const createRoomBtn = document.getElementById('createRoomBtn');
const playBotBtn = document.getElementById('playBotBtn');
const roomsListContainer = document.getElementById('roomsListContainer');
const walletUserDisplay = document.getElementById('walletUserDisplay');
const walletBalanceDisplay = document.getElementById('walletBalanceDisplay');
const depositBtn = document.getElementById('depositBtn');

const tableIdDisplay = document.getElementById('tableIdDisplay');
const potDisplay = document.getElementById('potDisplay');
const pokeBtn = document.getElementById('pokeBtn');
const pokeTimerBanner = document.getElementById('pokeTimerBanner');
const pokeSecondsDisplay = document.getElementById('pokeSecondsDisplay');
const opponentNameDisplay = document.getElementById('opponentNameDisplay');
const opponentCardCount = document.getElementById('opponentCardCount');
const opponentCardsContainer = document.getElementById('opponentCardsContainer');

const stockDeckSlot = document.getElementById('stockDeckSlot');
const deckCount = document.getElementById('deckCount');
const drawDeckBtn = document.getElementById('drawDeckBtn');
const groundDiscardSlot = document.getElementById('groundDiscardSlot');
const groundCardContainer = document.getElementById('groundCardContainer');
const takeGroundBtn = document.getElementById('takeGroundBtn');
const baseJokerCardContainer = document.getElementById('baseJokerCardContainer');
const gebiSlot = document.getElementById('gebiSlot');

const turnIndicator = document.getElementById('turnIndicator');
const pointsDisplay = document.getElementById('pointsDisplay');
const groundEligibilityBadge = document.getElementById('groundEligibilityBadge');
const playerCardsContainer = document.getElementById('playerCardsContainer');
const discardBtn = document.getElementById('discardBtn');
const conquerBtn = document.getElementById('conquerBtn');
const smartSortBtn = document.getElementById('smartSortBtn');
const moveLeftBtn = document.getElementById('moveLeftBtn');
const moveRightBtn = document.getElementById('moveRightBtn');
const groupMeldsBtn = document.getElementById('groupMeldsBtn');
const meldGroupsContainer = document.getElementById('meldGroupsContainer');
const leaveGameBtn = document.getElementById('leaveGameBtn');

let isGroupViewActive = false;
let hasPlayedDealingAnim = false;
let isDealingInProgress = false;
let previousHandLength = 0;
let previousOpponentCardCount = 0;
let previousGroundCardId = null;
const gameLogsContainer = document.getElementById('gameLogsContainer');

const cutJokerModal = document.getElementById('cutJokerModal');
const cutHighBtn = document.getElementById('cutHighBtn');
const cutLowBtn = document.getElementById('cutLowBtn');
const revealedBaseCard = document.getElementById('revealedBaseCard');
const jokerPreviewInfo = document.getElementById('jokerPreviewInfo');
const jokerInfoBar = document.getElementById('jokerInfoBar');
const jokerInfoText = document.getElementById('jokerInfoText');
const tableMeldsArea = document.getElementById('tableMeldsArea');
const myMeldsContainer = document.getElementById('myMeldsContainer');
const opponentMeldsContainer = document.getElementById('opponentMeldsContainer');
const myMeldsLabel = document.getElementById('myMeldsLabel');
const opponentMeldsLabel = document.getElementById('opponentMeldsLabel');
const gameResultModal = document.getElementById('gameResultModal');
const resultModalTitle = document.getElementById('resultModalTitle');
const resultModalDesc = document.getElementById('resultModalDesc');
const returnToLobbyBtn = document.getElementById('returnToLobbyBtn');

// Ground 41 Meld Bar Elements
const groundMeldBar = document.getElementById('groundMeldBar');
const groundTargetCardBadge = document.getElementById('groundTargetCardBadge');
const groundMeldPointsVal = document.getElementById('groundMeldPointsVal');
const groundMeldHintText = document.getElementById('groundMeldHintText');
const confirmGroundMeldBtn = document.getElementById('confirmGroundMeldBtn');
const autoSelect41Btn = document.getElementById('autoSelect41Btn');
const forfeitGroundBtn = document.getElementById('forfeitGroundBtn');
const cancelGroundMeldBtn = document.getElementById('cancelGroundMeldBtn');

// Initial setup
playerNameInput.value = playerName;
walletUserDisplay.textContent = playerName;

playerNameInput.addEventListener('change', () => {
  playerName = playerNameInput.value || 'Player';
  localStorage.setItem('conquer_user_name', playerName);
  walletUserDisplay.textContent = playerName;
  socket.emit('register_user', { userId, name: playerName });
});

// Socket connection
socket.on('connect', () => {
  socket.emit('register_user', { userId, name: playerName });
  refreshRoomsList();
});

socket.on('wallet_update', (wallet) => {
  walletBalanceDisplay.textContent = `${wallet.balance.toLocaleString()} ETB`;
});

socket.on(`wallet_${userId}`, (wallet) => {
  walletBalanceDisplay.textContent = `${wallet.balance.toLocaleString()} ETB`;
});

socket.on('error_msg', (msg) => {
  alert(`⚠️ ${msg}`);
});

socket.on('room_created', ({ roomId }) => {
  currentRoomId = roomId;
  switchToGameView();
});

// Real-Time Game State Sync
socket.on('game_state', (state) => {
  currentGameState = state;
  currentRoomId = state.roomId;
  renderGame(state);
});

// Deposit Button
depositBtn.addEventListener('click', async () => {
  await fetch('/api/wallet/deposit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, amount: 500 })
  });
  playCardSound();
  socket.emit('register_user', { userId, name: playerName });
});

// Create Room
createRoomBtn.addEventListener('click', () => {
  const stakeAmount = Number(stakeSelect.value) || 100;
  socket.emit('create_room', { userId, name: playerName, stakeAmount });
});

// Play Against Bot
playBotBtn.addEventListener('click', () => {
  const stakeAmount = Number(stakeSelect.value) || 100;
  socket.emit('play_vs_bot', { userId, name: playerName, stakeAmount });
  switchToGameView();
});

// Fetch Active Rooms
async function refreshRoomsList() {
  try {
    const res = await fetch('/api/rooms');
    const rooms = await res.json();
    if (rooms.length === 0) {
      roomsListContainer.innerHTML = `<p style="color: #64748b; font-size: 14px;">No tables waiting. Create one or play against the AI Bot!</p>`;
      return;
    }
    roomsListContainer.innerHTML = rooms.map(r => `
      <div class="room-list-item">
        <div>
          <strong style="color: var(--primary-gold);">${r.creatorName}'s Table</strong>
          <div style="font-size: 12px; color: #94a3b8;">Stake: ${r.stakeAmount} ETB</div>
        </div>
        <button class="btn-primary" style="width: auto; padding: 6px 14px; font-size: 12px;" onclick="joinRoom('${r.roomId}')">Join Table</button>
      </div>
    `).join('');
  } catch (e) { }
}

window.joinRoom = function (roomId) {
  socket.emit('join_room', { roomId, userId, name: playerName });
  switchToGameView();
};

function switchToGameView() {
  lobbyView.style.display = 'none';
  gameView.style.display = 'block';
}

function switchToLobbyView() {
  hasPlayedDealingAnim = false;
  isDealingInProgress = false;
  previousHandLength = 0;
  previousOpponentCardCount = 0;
  previousGroundCardId = null;
  if (groundMeldBar) groundMeldBar.style.display = 'none';
  selectedCardsSet.clear();
  selectedCardId = null;
  lobbyView.style.display = 'block';
  gameView.style.display = 'none';
  cutJokerModal.style.display = 'none';
  gameResultModal.style.display = 'none';
  refreshRoomsList();
}

leaveGameBtn.addEventListener('click', () => {
  switchToLobbyView();
});

// Rule 2: High/Low Joker Selection
cutHighBtn.addEventListener('click', () => {
  if (currentRoomId) {
    playCardSound();
    socket.emit('set_joker_high_low', { roomId: currentRoomId, userId, choice: 'high' });
    cutJokerModal.style.display = 'none';
  }
});

cutLowBtn.addEventListener('click', () => {
  if (currentRoomId) {
    playCardSound();
    socket.emit('set_joker_high_low', { roomId: currentRoomId, userId, choice: 'low' });
    cutJokerModal.style.display = 'none';
  }
});

function handleDrawAction(source) {
  if (!currentGameState || currentGameState.status !== 'PLAYING') return;
  if (currentGameState.currentTurnPlayerId !== userId) return alert('Not your turn!');
  if (currentGameState.turnState !== 'AWAITING_DRAW') return alert('Already drew card! Discard one now.');

  if (source === 'deck') {
    if (groundMeldBar) groundMeldBar.style.display = 'none';
    playCardSound();
    socket.emit('draw_card', { roomId: currentRoomId, userId, source: 'deck' });
    return;
  }

  if (source === 'ground') {
    if (!currentGameState.topGroundCard) return;
    if (currentGameState.isFirstDiscard) return; // Silent if first discard

    const topGround = currentGameState.topGroundCard;

    // Rule 6: If top ground card is a Joker, player can pick it directly without needing 41
    if (topGround.isJoker || topGround.rank === currentGameState.jokerRank) {
      if (groundMeldBar) groundMeldBar.style.display = 'none';
      playCardSound();
      socket.emit('draw_card', { roomId: currentRoomId, userId, source: 'ground' });
      return;
    }

    // Open Ground 41 Meld Bar so user can add more melds to reach 41!
    openGroundMeldBar();
    return;
  }
}

// Open Ground Meld Mode
function openGroundMeldBar() {
  if (!currentGameState || !groundMeldBar) return;
  groundMeldBar.style.display = 'flex';
  const topGround = currentGameState.topGroundCard;
  if (topGround) {
    groundTargetCardBadge.textContent = `ካርታ: [ ${topGround.rank}${topGround.suit} ]`;
  }
  updateGroundMeldBar();
}

// Live update points and hint in Ground Meld Bar as cards are selected
function updateGroundMeldBar() {
  if (!groundMeldBar || groundMeldBar.style.display === 'none') return;
  if (!currentGameState || !currentGameState.myHand) return;

  const selectedCards = currentGameState.myHand.filter(c => selectedCardsSet.has(c.id));
  const jokerRank = currentGameState.jokerRank;

  // Attempt to partition selected cards into valid melds
  const validPartition = partitionIntoValidMelds(selectedCards, jokerRank);
  
  let totalPts = 0;
  selectedCards.forEach(c => { totalPts += c.pointValue || 0; });

  groundMeldPointsVal.textContent = totalPts;

  if (selectedCards.length === 0) {
    groundMeldHintText.textContent = '👉 ከመሬት ለማንሳት 41 የሚሞሉትን ካርታዎች (Melds) ከእጅህ ምረጥ!';
    groundMeldHintText.style.color = '#f5b041';
    confirmGroundMeldBtn.disabled = true;
    confirmGroundMeldBtn.style.opacity = '0.5';
  } else if (!validPartition) {
    groundMeldHintText.textContent = `⚠️ የተመረጡት ካርታዎች (${selectedCards.length}) ትክክለኛ ትሪስ (Meld) አልሰሩም! 3 ወይም 4 የሚሆኑ ተመሳሳይ ወይም ተከታታይ ካርታዎችን ምረጥ!`;
    groundMeldHintText.style.color = '#f87171';
    confirmGroundMeldBtn.disabled = true;
    confirmGroundMeldBtn.style.opacity = '0.5';
  } else if (totalPts < 41) {
    // Exactly what user specified: "777 kehone sidemer 21 selhone lela endichemir yederegal"
    const meldNames = validPartition.map(m => m.map(c => c.rank + c.suit).join('-')).join(' + ');
    groundMeldHintText.textContent = `⚠️ ${totalPts} ነጥብ ብቻ ነው (${meldNames})! 41 አልሞላም — እባክህ ሌላ ትሪስ (Meld) ጨምር!`;
    groundMeldHintText.style.color = '#f87171';
    confirmGroundMeldBtn.disabled = true;
    confirmGroundMeldBtn.style.opacity = '0.5';
  } else {
    // Reached 41!
    const meldNames = validPartition.map(m => m.map(c => c.rank + c.suit).join('-')).join(' + ');
    groundMeldHintText.textContent = `✅ ${totalPts} ነጥብ ሞልቷል (${meldNames})! አውርደህ ከመሬት ማንሳት ትችላለህ!`;
    groundMeldHintText.style.color = '#4ade80';
    confirmGroundMeldBtn.disabled = false;
    confirmGroundMeldBtn.style.opacity = '1';
  }
}

// Confirm Ground Meld and Lay Down (kalew yawerdal)
confirmGroundMeldBtn.addEventListener('click', () => {
  if (!currentGameState || !currentGameState.myHand) return;
  const selectedCards = currentGameState.myHand.filter(c => selectedCardsSet.has(c.id));
  const validPartition = partitionIntoValidMelds(selectedCards, currentGameState.jokerRank);

  let totalPts = 0;
  selectedCards.forEach(c => { totalPts += c.pointValue || 0; });

  if (!validPartition || totalPts < 41) {
    // If player insists on confirming with < 41: they forfeit (kelelw gin yeshenefal)
    socket.emit('forfeit_ground_fail', { roomId: currentRoomId, userId });
    groundMeldBar.style.display = 'none';
    selectedCardsSet.clear();
    selectedCardId = null;
    return;
  }

  playCardSound();
  socket.emit('draw_ground_with_melds', {
    roomId: currentRoomId,
    userId,
    melds: validPartition
  });

  groundMeldBar.style.display = 'none';
  selectedCardsSet.clear();
  selectedCardId = null;
  renderPlayerHand(currentGameState.myHand);
});

// Auto-Select 41 Helper
autoSelect41Btn.addEventListener('click', () => {
  if (!currentGameState || !currentGameState.myHand) return;
  const foundMelds = find41MeldsCombination(currentGameState.myHand, currentGameState.jokerRank);
  if (foundMelds && foundMelds.length > 0) {
    playCardSound();
    selectedCardsSet.clear();
    selectedCardId = null;
    foundMelds.flat().forEach(c => selectedCardsSet.add(c.id));
    renderPlayerHand(currentGameState.myHand);
    updateGroundMeldBar();
  } else {
    groundMeldHintText.textContent = '❌ በእጅህ ውስጥ 41 የሚሞላ የትሪስ ጥምረት የለም!';
    groundMeldHintText.style.color = '#ef4444';
  }
});

// Forfeit Ground Draw (kelelw gin yeshenefal)
forfeitGroundBtn.addEventListener('click', () => {
  if (!currentRoomId) return;
  if (confirm('41 ማውረድ ካልቻልክ ጨዋታውን ትሸነፋለህ! እጅ መስጠት ትፈልጋለህ?')) {
    socket.emit('forfeit_ground_fail', { roomId: currentRoomId, userId });
    groundMeldBar.style.display = 'none';
    selectedCardsSet.clear();
    selectedCardId = null;
  }
});

// Cancel Ground Draw
cancelGroundMeldBtn.addEventListener('click', () => {
  if (groundMeldBar) groundMeldBar.style.display = 'none';
  selectedCardsSet.clear();
  selectedCardId = null;
  if (currentGameState && currentGameState.myHand) {
    renderPlayerHand(currentGameState.myHand);
  }
});

// Draw Card (Stock deck) - Both Slot & Button
stockDeckSlot.addEventListener('click', (e) => {
  if (e.target !== drawDeckBtn) handleDrawAction('deck');
});
drawDeckBtn.addEventListener('click', () => handleDrawAction('deck'));

// Draw Card (Ground / Meret) - Both Slot & Button
groundDiscardSlot.addEventListener('click', (e) => {
  if (e.target !== takeGroundBtn) handleDrawAction('ground');
});
takeGroundBtn.addEventListener('click', () => handleDrawAction('ground'));

// Discard Selected Card to Ground
discardBtn.addEventListener('click', () => {
  if (!selectedCardId && selectedCardsSet.size === 0) return alert('ከእጅህ አንድ የሚጣል ካርታ ምረጥ!');
  if (!currentGameState || currentGameState.turnState !== 'AWAITING_DISCARD') {
    return alert('ካርታ ከመጣልህ በፊት መጀመሪያ ካርታ መሳብ አለብህ!');
  }

  const cardToDiscard = selectedCardId || Array.from(selectedCardsSet)[0];
  playCardSound();
  socket.emit('discard_card', {
    roomId: currentRoomId,
    userId,
    cardId: cardToDiscard,
    toGebi: false
  });
  selectedCardsSet.clear();
  selectedCardId = null;
  updateTakeGroundButton();
});

// Discard to GEBI / Conquer (Rule 5 & 12)
gebiSlot.addEventListener('click', () => {
  triggerConquer();
});
conquerBtn.addEventListener('click', () => {
  triggerConquer();
});

function triggerConquer() {
  if (!selectedCardId) return alert('Select your final winning card to drop into GEBI!');
  if (!currentGameState || currentGameState.currentTurnPlayerId !== userId) return alert('Not your turn!');

  // Simple auto-partition of remaining 13 cards into melds for validation
  const remainingHand = currentGameState.myHand.filter(c => c.id !== selectedCardId);
  const melds = autoGroupHandIntoMelds(remainingHand);

  socket.emit('discard_card', {
    roomId: currentRoomId,
    userId,
    cardId: selectedCardId,
    toGebi: true,
    melds
  });
}

// Rule 8: Poke Button
pokeBtn.addEventListener('click', () => {
  if (!currentRoomId) return;
  playPokeSound();
  socket.emit('poke_player', { roomId: currentRoomId, userId });
});

// Move Selected Card Left
moveLeftBtn.addEventListener('click', () => {
  if (!selectedCardId || !currentGameState || !currentGameState.myHand) return;
  const idx = currentGameState.myHand.findIndex(c => c.id === selectedCardId);
  if (idx > 0) {
    const temp = currentGameState.myHand[idx];
    currentGameState.myHand[idx] = currentGameState.myHand[idx - 1];
    currentGameState.myHand[idx - 1] = temp;
    playCardSound();
    renderPlayerHand(currentGameState.myHand);
  }
});

// Move Selected Card Right
moveRightBtn.addEventListener('click', () => {
  if (!selectedCardId || !currentGameState || !currentGameState.myHand) return;
  const idx = currentGameState.myHand.findIndex(c => c.id === selectedCardId);
  if (idx !== -1 && idx < currentGameState.myHand.length - 1) {
    const temp = currentGameState.myHand[idx];
    currentGameState.myHand[idx] = currentGameState.myHand[idx + 1];
    currentGameState.myHand[idx + 1] = temp;
    playCardSound();
    renderPlayerHand(currentGameState.myHand);
  }
});

// Toggle Groups View
groupMeldsBtn.addEventListener('click', () => {
  isGroupViewActive = !isGroupViewActive;
  groupMeldsBtn.textContent = isGroupViewActive ? '🃏 View in Single Line' : '🗂️ View in Groups';
  groupMeldsBtn.style.background = isGroupViewActive ? '#38bdf8' : 'rgba(15, 23, 42, 0.85)';
  groupMeldsBtn.style.color = isGroupViewActive ? '#000' : '#fff';
  renderPlayerHand(currentGameState.myHand);
});

// Rank ordering maps
const RANK_VALUES = {
  'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6,
  '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13
};

const RANK_ORDER = {
  'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6,
  '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13
};

function isSequenceSameSuit(cards) {
  if (!cards || cards.length < 3) return false;
  const suit = cards[0].suit;
  if (!cards.every(c => c.suit === suit)) return false;

  const isConsecutive = (numbers) => {
    for (let i = 0; i < numbers.length - 1; i++) {
      if (numbers[i + 1] - numbers[i] !== 1) return false;
    }
    return true;
  };

  const orderAAs1 = cards.map(c => RANK_ORDER[c.rank]).sort((a, b) => a - b);
  if (isConsecutive(orderAAs1)) return true;

  const orderAAs14 = cards.map(c => (c.rank === 'A' ? 14 : RANK_ORDER[c.rank])).sort((a, b) => a - b);
  if (isConsecutive(orderAAs14)) return true;

  return false;
}

function canFormSequenceWithJoker(naturalCards, jokerCount, targetLength) {
  const suit = naturalCards[0].suit;
  if (!naturalCards.every(c => c.suit === suit)) return false;

  const testSequence = (orderMap) => {
    const nums = naturalCards.map(c => orderMap(c.rank)).sort((a, b) => a - b);
    for (let i = 0; i < nums.length - 1; i++) {
      if (nums[i] === nums[i + 1]) return false;
    }
    const span = nums[nums.length - 1] - nums[0] + 1;
    const missing = span - nums.length;
    return span <= targetLength && missing <= jokerCount;
  };

  const as1 = testSequence(r => RANK_ORDER[r]);
  const as14 = testSequence(r => (r === 'A' ? 14 : RANK_ORDER[r]));
  return as1 || as14;
}

function isValidTris(cards, jokerRank) {
  if (!cards || cards.length !== 3) return false;
  const jokerCount = cards.filter(c => c.rank === jokerRank || c.isJoker).length;
  if (jokerCount > 1) return false;
  const naturalCards = cards.filter(c => c.rank !== jokerRank && !c.isJoker);

  if (jokerCount === 0) {
    if (naturalCards[0].rank === naturalCards[1].rank && naturalCards[1].rank === naturalCards[2].rank) {
      const suits = new Set(naturalCards.map(c => c.suit));
      return suits.size >= 2;
    }
    if (isSequenceSameSuit(naturalCards)) return true;
  }

  if (jokerCount === 1) {
    if (naturalCards[0].rank === naturalCards[1].rank) return true;
    if (naturalCards[0].suit === naturalCards[1].suit) {
      if (canFormSequenceWithJoker(naturalCards, 1, 3)) return true;
    }
  }
  return false;
}

function isValidQuatris(cards, jokerRank) {
  if (!cards || cards.length !== 4) return false;
  const jokerCount = cards.filter(c => c.rank === jokerRank || c.isJoker).length;
  if (jokerCount > 1) return false;
  const naturalCards = cards.filter(c => c.rank !== jokerRank && !c.isJoker);

  if (jokerCount === 0) {
    if (naturalCards.every(c => c.rank === naturalCards[0].rank)) {
      const suits = new Set(naturalCards.map(c => c.suit));
      return suits.size >= 3;
    }
    if (isSequenceSameSuit(naturalCards)) return true;
  }

  if (jokerCount === 1) {
    if (naturalCards.every(c => c.rank === naturalCards[0].rank)) return true;
    if (naturalCards.every(c => c.suit === naturalCards[0].suit)) {
      if (canFormSequenceWithJoker(naturalCards, 1, 4)) return true;
    }
  }
  return false;
}

// Partitions a set of selected cards (e.g. 6 or 7 cards) into valid disjoint Tris / Quatris melds
function partitionIntoValidMelds(cards, jokerRank) {
  if (!cards || cards.length < 3) return null;
  if (cards.length === 3 && isValidTris(cards, jokerRank)) return [cards];
  if (cards.length === 4 && isValidQuatris(cards, jokerRank)) return [cards];
  if (cards.length === 6) {
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 5; j++) {
        for (let k = j + 1; k < 6; k++) {
          const m1 = [cards[i], cards[j], cards[k]];
          const m2 = cards.filter((_, idx) => idx !== i && idx !== j && idx !== k);
          if (isValidTris(m1, jokerRank) && isValidTris(m2, jokerRank)) {
            return [m1, m2];
          }
        }
      }
    }
  }
  if (cards.length === 7) {
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        for (let k = j + 1; k < cards.length; k++) {
          for (let l = k + 1; l < cards.length; l++) {
            const m1 = [cards[i], cards[j], cards[k], cards[l]];
            const m2 = cards.filter((_, idx) => idx !== i && idx !== j && idx !== k && idx !== l);
            if ((isValidQuatris(m1, jokerRank) && isValidTris(m2, jokerRank)) ||
                (isValidTris(m1, jokerRank) && isValidQuatris(m2, jokerRank))) {
              return [m1, m2];
            }
          }
        }
      }
    }
  }
  if (cards.length === 8) {
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        for (let k = j + 1; k < cards.length; k++) {
          for (let l = k + 1; l < cards.length; l++) {
            const m1 = [cards[i], cards[j], cards[k], cards[l]];
            const m2 = cards.filter((_, idx) => idx !== i && idx !== j && idx !== k && idx !== l);
            if (isValidQuatris(m1, jokerRank) && isValidQuatris(m2, jokerRank)) {
              return [m1, m2];
            }
          }
        }
      }
    }
  }
  return null;
}

// Finds any combination of Tris/Quatris in hand that sum to >= 41 points
function find41MeldsCombination(hand, jokerRank) {
  if (!hand || hand.length < 3) return null;
  const n = hand.length;
  const candidateMelds = [];

  for (let i = 0; i < n - 3; i++) {
    for (let j = i + 1; j < n - 2; j++) {
      for (let k = j + 1; k < n - 1; k++) {
        for (let l = k + 1; l < n; l++) {
          const group = [hand[i], hand[j], hand[k], hand[l]];
          if (isValidQuatris(group, jokerRank)) {
            let pts = 0;
            group.forEach(c => { pts += c.pointValue || 0; });
            candidateMelds.push({ cards: group, points: pts });
          }
        }
      }
    }
  }

  for (let i = 0; i < n - 2; i++) {
    for (let j = i + 1; j < n - 1; j++) {
      for (let k = j + 1; k < n; k++) {
        const group = [hand[i], hand[j], hand[k]];
        if (isValidTris(group, jokerRank)) {
          let pts = 0;
          group.forEach(c => { pts += c.pointValue || 0; });
          candidateMelds.push({ cards: group, points: pts });
        }
      }
    }
  }

  for (const m of candidateMelds) {
    if (m.points >= 41) return [m.cards];
  }

  for (let i = 0; i < candidateMelds.length; i++) {
    for (let j = i + 1; j < candidateMelds.length; j++) {
      const m1 = candidateMelds[i];
      const m2 = candidateMelds[j];
      const ids1 = new Set(m1.cards.map(c => c.id));
      const isDisjoint = m2.cards.every(c => !ids1.has(c.id));
      if (isDisjoint && (m1.points + m2.points >= 41)) {
        return [m1.cards, m2.cards];
      }
    }
  }

  for (let i = 0; i < candidateMelds.length; i++) {
    for (let j = i + 1; j < candidateMelds.length; j++) {
      for (let k = j + 1; k < candidateMelds.length; k++) {
        const m1 = candidateMelds[i];
        const m2 = candidateMelds[j];
        const m3 = candidateMelds[k];
        const ids1 = new Set(m1.cards.map(c => c.id));
        const ids2 = new Set([...ids1, ...m2.cards.map(c => c.id)]);
        const isDisjoint = m2.cards.every(c => !ids1.has(c.id)) && m3.cards.every(c => !ids2.has(c.id));
        if (isDisjoint && (m1.points + m2.points + m3.points >= 41)) {
          return [m1.cards, m2.cards, m3.cards];
        }
      }
    }
  }

  return null;
}

function getRankNum(rank, aceHigh = false) {
  if (rank === 'A' && aceHigh) return 14;
  return RANK_VALUES[rank] || 0;
}

// Check if a card acts as a Joker
function isCardJoker(card, state) {
  if (!card) return false;
  if (card.isJoker || card.isMainJoker || card.isFalseJoker) return true;
  if (state && state.jokerRank && card.rank === state.jokerRank) {
    if (!state.jokerSuits || state.jokerSuits.includes(card.suit)) return true;
  }
  return false;
}

let isAutoSortActive = true;

// Single Smart "ደርድር" (Arrange Hand) Button
smartSortBtn.addEventListener('click', () => {
  if (!currentGameState || !currentGameState.myHand || currentGameState.myHand.length === 0) return;
  playCardSound();
  isAutoSortActive = true;
  currentGameState.myHand = arrangeHandOptimal(currentGameState.myHand, currentGameState);
  renderPlayerHand(currentGameState.myHand);
});

/**
 * Optimal Conquer Hand Arranger:
 * Arranges all possible melds, pairs, and connected cards at once:
 * 1. Pure 4-card Sequences & Sets (Runs & Groups) [Score: 1000 + points]
 * 2. Pure 3-card Sequences & Sets (Runs & Groups) [Score: 800 + points]
 * 3. 3-card Melds completed with Jokers [Score: 500 + points] (Pure melds NEVER broken!)
 * 4. 2-card Pairs (same rank or consecutive suit) [Score: 70 / 65]
 * 5. Connects related singletons directly to adjacent pairs (e.g. Q♣ + Q♦ + J♦ kept together)
 * 6. Groups remaining single cards by Suit & Rank
 * 7. Places Jokers in the top advantage positions (first slot or highest pair)
 * 8. Tags the first card of each group with isGroupStart = true for visual spacing
 */
function arrangeHandOptimal(hand, state) {
  if (!hand || hand.length <= 1) return hand;

  const jokers = hand.filter(c => isCardJoker(c, state));
  const naturals = hand.filter(c => !isCardJoker(c, state));
  const suits = ['♠', '♥', '♣', '♦'];

  // 1. Identify all candidate full 3 or 4 card melds
  const candidateMelds = [];

  // 1a. Pure sequences of 3 or 4 same suit (Highest Priority)
  for (const suit of suits) {
    const suitCards = naturals
      .filter(c => c.suit === suit)
      .sort((a, b) => getRankNum(a.rank) - getRankNum(b.rank));

    // Pure runs of length 4 and 3 (Ace Low)
    for (let len = 4; len >= 3; len--) {
      for (let i = 0; i <= suitCards.length - len; i++) {
        const slice = suitCards.slice(i, i + len);
        let valid = true;
        let points = 0;
        for (let k = 0; k < len - 1; k++) {
          if (getRankNum(slice[k + 1].rank) !== getRankNum(slice[k].rank) + 1) {
            valid = false;
            break;
          }
        }
        if (valid) {
          slice.forEach(c => { points += c.pointValue || 0; });
          candidateMelds.push({
            cards: slice,
            score: (len === 4 ? 1000 : 800) + points,
            type: 'seq'
          });
        }
      }
    }

    // High Ace sequences (e.g. 10-J-Q-K-A, J-Q-K-A, Q-K-A)
    const highSuitCards = naturals
      .filter(c => c.suit === suit)
      .sort((a, b) => getRankNum(a.rank, true) - getRankNum(b.rank, true));

    for (let len = 4; len >= 3; len--) {
      for (let i = 0; i <= highSuitCards.length - len; i++) {
        const slice = highSuitCards.slice(i, i + len);
        let valid = true;
        let points = 0;
        for (let k = 0; k < len - 1; k++) {
          if (getRankNum(slice[k + 1].rank, true) !== getRankNum(slice[k].rank, true) + 1) {
            valid = false;
            break;
          }
        }
        if (valid) {
          slice.forEach(c => { points += c.pointValue || 0; });
          candidateMelds.push({
            cards: slice,
            score: (len === 4 ? 1000 : 800) + points,
            type: 'seq'
          });
        }
      }
    }
  }

  // 1b. Pure sets of 3 or 4 same rank
  const rankGroups = new Map();
  naturals.forEach(c => {
    if (!rankGroups.has(c.rank)) rankGroups.set(c.rank, []);
    rankGroups.get(c.rank).push(c);
  });

  rankGroups.forEach((cards) => {
    const uniqueSuits = [];
    const seen = new Set();
    cards.forEach(c => {
      if (!seen.has(c.suit)) {
        seen.add(c.suit);
        uniqueSuits.push(c);
      }
    });
    if (uniqueSuits.length >= 3) {
      let points = 0;
      uniqueSuits.forEach(c => { points += c.pointValue || 0; });
      const len = Math.min(uniqueSuits.length, 4);
      candidateMelds.push({
        cards: uniqueSuits.slice(0, 4),
        score: (len === 4 ? 1000 : 800) + points,
        type: 'set'
      });
    }
  });

  // 1c. 3-card melds using 1 Joker (Score ~500, BELOW pure melds so pure runs like 9-10-J are never broken!)
  if (jokers.length > 0) {
    for (const suit of suits) {
      const suitCards = naturals
        .filter(c => c.suit === suit)
        .sort((a, b) => getRankNum(a.rank) - getRankNum(b.rank));

      for (let i = 0; i < suitCards.length - 1; i++) {
        const c1 = suitCards[i];
        const c2 = suitCards[i + 1];
        const diff = getRankNum(c2.rank) - getRankNum(c1.rank);
        const cardPoints = (c1.pointValue || 0) + (c2.pointValue || 0);

        if (diff === 1) {
          candidateMelds.push({
            cards: [c1, c2],
            needJoker: true,
            score: 500 + cardPoints,
            type: 'joker_seq'
          });
        } else if (diff === 2) {
          candidateMelds.push({
            cards: [c1, c2],
            needJoker: true,
            isSplit: true,
            score: 480 + cardPoints,
            type: 'joker_seq'
          });
        }
      }
    }

    rankGroups.forEach((cards) => {
      if (cards.length >= 2 && cards[0].suit !== cards[1].suit) {
        const cardPoints = (cards[0].pointValue || 0) + (cards[1].pointValue || 0);
        candidateMelds.push({
          cards: [cards[0], cards[1]],
          needJoker: true,
          score: 500 + cardPoints,
          type: 'joker_set'
        });
      }
    });
  }

  // Pick disjoint candidate melds with highest score
  candidateMelds.sort((a, b) => b.score - a.score);
  const chosenMelds = [];
  const usedIds = new Set();
  let remainingJokers = [...jokers];

  for (const cand of candidateMelds) {
    const canUseNaturals = cand.cards.every(c => !usedIds.has(c.id));
    const canUseJoker = !cand.needJoker || remainingJokers.length > 0;
    if (canUseNaturals && canUseJoker) {
      cand.cards.forEach(c => usedIds.add(c.id));
      let meldGroup = [...cand.cards];
      if (cand.needJoker) {
        const jk = remainingJokers.shift();
        if (cand.isSplit) {
          meldGroup = [cand.cards[0], jk, cand.cards[1]];
        } else {
          meldGroup.push(jk);
        }
      }
      chosenMelds.push(meldGroup);
    }
  }

  let unmelded = naturals.filter(c => !usedIds.has(c.id));

  // 2. Identify candidate Pairs among unmelded cards
  const candidatePairs = [];
  for (let i = 0; i < unmelded.length; i++) {
    for (let j = i + 1; j < unmelded.length; j++) {
      const a = unmelded[i];
      const b = unmelded[j];
      if (a.rank === b.rank) {
        candidatePairs.push({ a, b, score: 70, type: 'rank' });
      } else if (a.suit === b.suit && Math.abs(getRankNum(a.rank) - getRankNum(b.rank)) === 1) {
        candidatePairs.push({ a, b, score: 65, type: 'suited' });
      } else if (a.suit === b.suit && Math.abs(getRankNum(a.rank) - getRankNum(b.rank)) === 2) {
        candidatePairs.push({ a, b, score: 35, type: 'gap' });
      }
    }
  }
  candidatePairs.sort((x, y) => y.score - x.score);

  const chosenPairs = [];
  const usedInPairs = new Set();
  for (const p of candidatePairs) {
    if (!usedInPairs.has(p.a.id) && !usedInPairs.has(p.b.id)) {
      usedInPairs.add(p.a.id);
      usedInPairs.add(p.b.id);
      chosenPairs.push([p.a, p.b]);
    }
  }

  let singletons = unmelded.filter(c => !usedInPairs.has(c.id));

  // 3. ATTACHMENT: Connect any related singleton directly to adjacent pair!
  // E.g. J♦ attaches directly next to [Q♣, Q♦] => [Q♣, Q♦, J♦]
  const attachedSingletons = new Set();
  for (const group of chosenPairs) {
    for (let k = 0; k < singletons.length; k++) {
      const s = singletons[k];
      if (attachedSingletons.has(s.id)) continue;

      const connIndex = group.findIndex(c => {
        if (c.rank === s.rank) return true;
        if (c.suit === s.suit && Math.abs(getRankNum(c.rank) - getRankNum(s.rank)) === 1) return true;
        return false;
      });

      if (connIndex !== -1) {
        const matchingCard = group[connIndex];
        if (connIndex === 0) {
          if (getRankNum(s.rank) < getRankNum(matchingCard.rank)) {
            group.unshift(s);
          } else {
            group.splice(1, 0, s);
          }
        } else {
          if (getRankNum(s.rank) > getRankNum(matchingCard.rank)) {
            group.push(s);
          } else {
            group.splice(connIndex, 0, s);
          }
        }
        attachedSingletons.add(s.id);
      }
    }
  }

  singletons = singletons.filter(s => !attachedSingletons.has(s.id));

  // 4. Sort remaining unattached singletons by Suit then Rank
  const suitOrder = { '♠': 1, '♥': 2, '♣': 3, '♦': 4 };
  singletons.sort((a, b) => {
    if (suitOrder[a.suit] !== suitOrder[b.suit]) {
      return (suitOrder[a.suit] || 0) - (suitOrder[b.suit] || 0);
    }
    return getRankNum(a.rank) - getRankNum(b.rank);
  });

  // 5. Place Jokers in the top possible place for maximum user advantage:
  // If an unused Joker exists, pair it with the highest-value single card (e.g. Ace, King, Queen)
  if (remainingJokers.length > 0 && singletons.length > 0) {
    singletons.sort((a, b) => (b.pointValue || 0) - (a.pointValue || 0));
    const bestCard = singletons.shift();
    const jk = remainingJokers.shift();
    chosenPairs.unshift([bestCard, jk]);
  }

  // 6. Build logical groups for clear visual organization
  const logicalGroups = [];
  if (remainingJokers.length > 0) {
    logicalGroups.push({ name: '⭐ Joker', cards: remainingJokers });
  }
  chosenMelds.forEach((m, idx) => {
    logicalGroups.push({ name: `Meld ${idx + 1} (${m.length})`, cards: m });
  });
  chosenPairs.forEach((p, idx) => {
    logicalGroups.push({ name: `Pair (${p.length})`, cards: p });
  });
  if (singletons.length > 0) {
    logicalGroups.push({ name: `Cards (${singletons.length})`, cards: singletons });
  }

  // Assemble finalHand and mark isGroupStart for visual margin separation
  const finalHand = [];
  logicalGroups.forEach((group, gIdx) => {
    group.cards.forEach((card, cIdx) => {
      card.isGroupStart = (cIdx === 0 && gIdx > 0);
      finalHand.push(card);
    });
  });

  if (state) {
    state._lastLogicalGroups = logicalGroups;
  }

  return finalHand;
}

// Main Game Renderer
function renderGame(state) {
  tableIdDisplay.textContent = `#${state.roomId.replace('room_', '').replace('bot_', 'BOT-')}`;
  potDisplay.textContent = `POT: ${state.pot} ETB`;
  deckCount.textContent = state.deckCardCount;

  // Turn status
  const isMyTurn = state.currentTurnPlayerId === userId;
  turnIndicator.textContent = isMyTurn ? 'YOUR TURN' : (state.opponent ? `${state.opponent.name}'s Turn` : 'Waiting for Player...');
  turnIndicator.style.color = isMyTurn ? '#4ade80' : '#f5b041';

  // Rule 2: Cut Joker modal for Joiner — show 28th card + High/Low buttons
  if (state.status === 'CUTTING_JOKER' && state.joiner && state.joiner.id === userId && state.baseCard) {
    cutJokerModal.style.display = 'flex';
    // Display the revealed 28th card
    revealedBaseCard.innerHTML = createCardHTML(state.baseCard, false, true);

    // Calculate what High and Low would produce
    const rankOrder = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const baseRankIdx = rankOrder.indexOf(state.baseCard.rank);
    const highRank = baseRankIdx < rankOrder.length - 1 ? rankOrder[baseRankIdx + 1] : rankOrder[0];
    const lowRank = baseRankIdx > 0 ? rankOrder[baseRankIdx - 1] : rankOrder[rankOrder.length - 1];
    const colorSuits = (state.baseCard.suit === '♣' || state.baseCard.suit === '♠') ? '♣ ♠' : '♥ ♦';

    jokerPreviewInfo.innerHTML = `
      <span style="color: #4ade80;">⬆️ High → <strong>${highRank}${colorSuits.split(' ')[0]}</strong> & <strong>${highRank}${colorSuits.split(' ')[1]}</strong> become Jokers</span>
      <br>
      <span style="color: #f97316;">⬇️ Low → <strong>${lowRank}${colorSuits.split(' ')[0]}</strong> & <strong>${lowRank}${colorSuits.split(' ')[1]}</strong> become Jokers</span>
    `;
  } else if (state.status !== 'CUTTING_JOKER') {
    cutJokerModal.style.display = 'none';
  }

  // Joker Info Bar (if present)
  if (jokerInfoBar) {
    if (state.jokerRank && state.jokerSuits && state.status === 'PLAYING') {
      jokerInfoBar.style.display = 'flex';
      jokerInfoText.innerHTML = `${state.jokerRank}${state.jokerSuits[0]} & ${state.jokerRank}${state.jokerSuits[1]} ⭐`;
    } else {
      jokerInfoBar.style.display = 'none';
    }
  }

  // Opponent display
  opponentNameDisplay.textContent = state.opponent ? state.opponent.name : 'Waiting...';
  opponentCardCount.textContent = state.opponentHandCount || 13;
  const isInitialDeal = !hasPlayedDealingAnim && state.status === 'PLAYING';
  renderOpponentCards(state.opponentHandCount || 13, isInitialDeal);

  // Center Field: Base Joker Card (Rule 3)
  if (state.jokerCard) {
    baseJokerCardContainer.innerHTML = createCardHTML(state.jokerCard, false, true);
  }

  // Discard Pile (Meret)
  if (state.topGroundCard) {
    const isNewGround = previousGroundCardId !== state.topGroundCard.id;
    previousGroundCardId = state.topGroundCard.id;
    const arrivalClass = isNewGround ? 'discard-arrival' : '';
    groundCardContainer.innerHTML = createCardHTML(state.topGroundCard, false, false, 1, arrivalClass);
  } else {
    groundCardContainer.innerHTML = `<div class="card" style="border: 2px dashed #94a3b8; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 12px;">Empty</div>`;
  }

  // Ground Draw button status: Always clickable on your turn if ground has a card (Don't reveal locked status)
  const hasGroundCard = !!state.topGroundCard;
  const canDrawNow = isMyTurn && state.turnState === 'AWAITING_DRAW';
  takeGroundBtn.disabled = !canDrawNow || !hasGroundCard;
  takeGroundBtn.textContent = '📥 Take Ground';
  if (canDrawNow && hasGroundCard) {
    groundCardContainer.querySelector('.card')?.classList.add('ground-unlocked-glow');
  } else {
    groundCardContainer.querySelector('.card')?.classList.remove('ground-unlocked-glow');
  }

  // Draw Deck button status
  drawDeckBtn.disabled = !isMyTurn || state.turnState !== 'AWAITING_DRAW';

  // Rule 8: Poke Status & Timer
  if (state.pokeState.active) {
    pokeTimerBanner.style.display = 'block';
    pokeSecondsDisplay.textContent = state.pokeState.secondsLeft;
    pokeBtn.disabled = true;
  } else {
    pokeTimerBanner.style.display = 'none';
    pokeBtn.disabled = isMyTurn || state.status !== 'PLAYING';
  }

  // Hand Points Display (Do not show Ground Locked indicator — player must calculate themselves)
  pointsDisplay.textContent = state.points || 0;
  if (groundEligibilityBadge) {
    groundEligibilityBadge.style.display = 'none';
  }

  // Ensure hand is arranged optimally with every state update
  if (state.status === 'PLAYING' && state.myHand && isAutoSortActive) {
    state.myHand = arrangeHandOptimal(state.myHand, state);
  }

  // Render player cards
  renderPlayerHand(state.myHand);

  // Render logs
  if (gameLogsContainer && state.logs && state.logs.length > 0) {
    gameLogsContainer.innerHTML = state.logs.map(l => `<div class="log-entry">${l}</div>`).join('');
  }

  // Render Table Melds
  if (tableMeldsArea) {
    renderTableMelds(state);
  }

  // Game Result Modal
  if (state.status === 'FINISHED') {
    if (groundMeldBar) groundMeldBar.style.display = 'none';
    const iWon = state.winner === userId;
    resultModalTitle.textContent = iWon ? '🏆 YOU WON!' : '❌ DEFEAT!';
    resultModalTitle.style.color = iWon ? '#4ade80' : '#ef4444';
    resultModalDesc.textContent = state.winReason || (iWon ? `You conquered and claimed ${state.pot} ETB!` : 'Better luck next time!');
    gameResultModal.style.display = 'flex';
    if (iWon) playWinSound();
  }
}

returnToLobbyBtn.addEventListener('click', () => {
  switchToLobbyView();
});

function renderOpponentCards(count, isInitialDeal = false) {
  const isSingleDraw = count === previousOpponentCardCount + 1 && previousOpponentCardCount > 0;
  previousOpponentCardCount = count;

  let html = '';
  for (let i = 0; i < Math.min(count, 14); i++) {
    let animClass = '';
    let delayStyle = '';

    if (isInitialDeal) {
      animClass = 'deal-anim';
      delayStyle = `style="animation-delay: ${i * 75}ms;"`;
    } else if (isSingleDraw && i === count - 1) {
      animClass = 'draw-anim';
    }

    html += `<div class="card-back ${animClass}" ${delayStyle}></div>`;
  }
  opponentCardsContainer.innerHTML = html;
}

let draggedCardId = null;

function renderPlayerHand(hand) {
  if (!hand) return;

  // Dealing motion: First deal cards one-by-one face down (showing only back)
  const isInitialDeal = !hasPlayedDealingAnim && currentGameState && currentGameState.status === 'PLAYING';
  if (isInitialDeal) {
    hasPlayedDealingAnim = true;
    runDealingSequence(hand);
    return;
  }

  // If initial dealing animation is currently in progress, wait until it finishes
  if (isDealingInProgress) return;

  // Check if a single card was just drawn during play
  const isSingleDraw = hand.length === previousHandLength + 1;
  previousHandLength = hand.length;

  // Whenever a new card arrives, automatically integrate and re-arrange the entire hand!
  if (isSingleDraw && isAutoSortActive) {
    hand = arrangeHandOptimal(hand, currentGameState);
    currentGameState.myHand = hand;
  }

  // Update Move button enabled states
  const selectedIdx = hand.findIndex(c => c.id === selectedCardId);
  moveLeftBtn.disabled = selectedIdx <= 0;
  moveRightBtn.disabled = selectedIdx === -1 || selectedIdx >= hand.length - 1;

  if (isGroupViewActive) {
    playerCardsContainer.style.display = 'none';
    meldGroupsContainer.style.display = 'flex';

    const groups = (currentGameState && currentGameState._lastLogicalGroups && currentGameState._lastLogicalGroups.length > 0)
      ? currentGameState._lastLogicalGroups
      : [
        { name: 'Group 1', cards: hand.slice(0, 4) },
        { name: 'Group 2', cards: hand.slice(4, 7) },
        { name: 'Group 3', cards: hand.slice(7, 10) },
        { name: 'Group 4', cards: hand.slice(10, 14) }
      ];

    meldGroupsContainer.innerHTML = groups.map((g, gIdx) => `
      <div class="meld-group-box">
        <div class="meld-group-label">${g.name}</div>
        <div style="display: flex; gap: 4px;">
          ${g.cards.map(c => createCardHTML(c, selectedCardsSet.has(c.id) || c.id === selectedCardId, false)).join('')}
        </div>
      </div>
    `).join('');

  } else {
    meldGroupsContainer.style.display = 'none';
    playerCardsContainer.style.display = 'flex';

    playerCardsContainer.innerHTML = hand.map((card, idx) => {
      const isSelected = selectedCardsSet.has(card.id) || card.id === selectedCardId;
      let animClass = '';
      if (isSingleDraw && idx === hand.length - 1) {
        animClass = 'drawn-anim';
      }
      return createCardHTML(card, isSelected, false, idx + 1, animClass);
    }).join('');
  }

  updateTakeGroundButton();
  bindCardInteractions(hand);
}

function updateTakeGroundButton() {
  if (!takeGroundBtn || !currentGameState) return;
  const selectedCards = (currentGameState.myHand || []).filter(c => selectedCardsSet.has(c.id));
  let points = 0;
  selectedCards.forEach(c => { points += c.pointValue || 0; });

  if (selectedCards.length > 0) {
    takeGroundBtn.textContent = `📥 አውርድና አንሳ (${points} ነጥብ)`;
  } else {
    takeGroundBtn.textContent = '📥 ከመሬት አንሳ';
  }
}

// Deal cards one-by-one face down, then flip to reveal once finished!
function runDealingSequence(hand) {
  isDealingInProgress = true;
  playerCardsContainer.innerHTML = '';
  playerCardsContainer.style.display = 'flex';
  meldGroupsContainer.style.display = 'none';

  hand.forEach((card, idx) => {
    setTimeout(() => {
      const cardEl = document.createElement('div');
      cardEl.className = 'card face-down dealing-anim';
      cardEl.setAttribute('data-id', card.id);
      cardEl.style.zIndex = idx + 1;
      playerCardsContainer.appendChild(cardEl);
      playCardSound();

      // Once all cards have been dealt face-down:
      if (idx === hand.length - 1) {
        setTimeout(() => {
          flipHandCardsToFaceUp(hand);
        }, 350);
      }
    }, idx * 80);
  });
}

function flipHandCardsToFaceUp(hand) {
  const cardElements = playerCardsContainer.querySelectorAll('.card');
  cardElements.forEach((cardEl, idx) => {
    setTimeout(() => {
      const card = hand[idx];
      const isRed = card.suit === '♥' || card.suit === '♦';
      const colorClass = isRed ? 'red' : 'black';
      let starHTML = '';
      if (card.isMainJoker) {
        starHTML = `<div class="card-joker-star">⭐</div>`;
      } else if (card.isFalseJoker) {
        starHTML = `<div class="card-joker-star false-joker-star">🃏</div>`;
      } else if (card.isJoker) {
        starHTML = `<div class="card-joker-star">⭐</div>`;
      }

      cardEl.className = `card ${colorClass} flip-reveal`;
      cardEl.innerHTML = `
        ${starHTML}
        <div class="card-corner top-left">
          <div class="corner-rank">${card.rank}</div>
          <div class="corner-suit">${card.suit}</div>
        </div>
        <div class="card-center-suit">${card.suit}</div>
        <div class="card-corner bottom-right">
          <div class="corner-rank">${card.rank}</div>
          <div class="corner-suit">${card.suit}</div>
        </div>
      `;
      playCardSound();

      // All cards flipped and revealed!
      if (idx === hand.length - 1) {
        setTimeout(() => {
          isDealingInProgress = false;
          bindCardInteractions(hand);
        }, 200);
      }
    }, idx * 45); // Cascading flip wave
  });
}

function bindCardInteractions(hand) {
  const activeContainer = isGroupViewActive ? meldGroupsContainer : playerCardsContainer;
  const cardElements = activeContainer.querySelectorAll('.card');

  cardElements.forEach(cardEl => {
    cardEl.draggable = true;

    // Click to select/deselect
    cardEl.addEventListener('click', () => {
      const cId = cardEl.getAttribute('data-id');
      if (selectedCardsSet.has(cId)) {
        selectedCardsSet.delete(cId);
        if (selectedCardId === cId) {
          selectedCardId = selectedCardsSet.size > 0 ? Array.from(selectedCardsSet)[selectedCardsSet.size - 1] : null;
        }
      } else {
        selectedCardsSet.add(cId);
        selectedCardId = cId;
      }
      playCardSound();
      updateTakeGroundButton();
      updateGroundMeldBar();
      renderPlayerHand(currentGameState.myHand);
    });

    // Drag Start
    cardEl.addEventListener('dragstart', (e) => {
      draggedCardId = cardEl.getAttribute('data-id');
      cardEl.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedCardId);
    });

    // Drag End
    cardEl.addEventListener('dragend', () => {
      cardEl.classList.remove('dragging');
      document.querySelectorAll('.card').forEach(c => c.classList.remove('drag-over'));
    });

    // Drag Over
    cardEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      cardEl.classList.add('drag-over');
    });

    // Drag Leave
    cardEl.addEventListener('dragleave', () => {
      cardEl.classList.remove('drag-over');
    });

    // Drop on another card to reorder
    cardEl.addEventListener('drop', (e) => {
      e.preventDefault();
      cardEl.classList.remove('drag-over');
      const targetCardId = cardEl.getAttribute('data-id');
      if (!draggedCardId || draggedCardId === targetCardId) return;

      const fromIndex = currentGameState.myHand.findIndex(c => c.id === draggedCardId);
      const toIndex = currentGameState.myHand.findIndex(c => c.id === targetCardId);

      if (fromIndex !== -1 && toIndex !== -1) {
        const [movedCard] = currentGameState.myHand.splice(fromIndex, 1);
        currentGameState.myHand.splice(toIndex, 0, movedCard);
        playCardSound();
        renderPlayerHand(currentGameState.myHand);
      }
    });
  });
}

function createCardHTML(card, isSelected = false, isBaseJoker = false, zIndex = 1, animClass = '', animDelay = '') {
  const isRed = card.suit === '♥' || card.suit === '♦';
  const colorClass = isRed ? 'red' : 'black';
  const selectedClass = isSelected ? 'selected' : '';
  const groupStartClass = card.isGroupStart ? 'group-start' : '';
  const delayStyle = animDelay ? `animation-delay: ${animDelay};` : '';

  // Rule 3: Golden Star on Main Jokers, 🃏 on False Jokers
  let starHTML = '';
  if (card.isMainJoker) {
    starHTML = `<div class="card-joker-star">⭐</div>`;
  } else if (card.isFalseJoker) {
    starHTML = `<div class="card-joker-star false-joker-star">🃏</div>`;
  } else if (card.isJoker) {
    starHTML = `<div class="card-joker-star">⭐</div>`;
  }
  const baseBadge = isBaseJoker ? `<div class="card-base-badge">BASE ⭐</div>` : '';

  return `
    <div class="card ${colorClass} ${selectedClass} ${groupStartClass} ${animClass}" data-id="${card.id}" style="z-index: ${zIndex}; ${delayStyle}">
      ${starHTML}
      <div class="card-corner top-left">
        <div class="corner-rank">${card.rank}</div>
        <div class="corner-suit">${card.suit}</div>
      </div>
      <div class="card-center-suit">${card.suit}</div>
      <div class="card-corner bottom-right">
        <div class="corner-rank">${card.rank}</div>
        <div class="corner-suit">${card.suit}</div>
      </div>
      ${baseBadge}
    </div>
  `;
}

// Helper: groups 13 cards into 4+3+3+3 or 4+4+3 for conquer check
function autoGroupHandIntoMelds(cards) {
  if (cards.length !== 13) return [cards];
  return [
    cards.slice(0, 4),
    cards.slice(4, 7),
    cards.slice(7, 10),
    cards.slice(10, 13)
  ];
}



// Render Table Melds — cards players have laid face-up on the table (for 41 ground draw)
function renderTableMelds(state) {
  if (!state.tableMelds || !tableMeldsArea) return;

  const myId = userId;
  const oppId = state.opponent ? state.opponent.id : null;
  const myMelds = state.tableMelds[myId] || [];
  const oppMelds = oppId ? (state.tableMelds[oppId] || []) : [];

  const myMeldsBox = document.getElementById('myMeldsBox');
  const opponentMeldsBox = document.getElementById('opponentMeldsBox');

  if (myMelds.length === 0 && oppMelds.length === 0) {
    tableMeldsArea.style.display = 'none';
    return;
  }

  tableMeldsArea.style.display = 'block';

  if (myMeldsBox) {
    if (myMelds.length > 0) {
      myMeldsBox.style.display = 'block';
      myMeldsLabel.textContent = `የወረዱ ካርታዎችህ (${myMelds.length} ግሩፕ)`;
      myMeldsContainer.innerHTML = myMelds.map(group => `
        <div class="table-meld-group">
          ${group.map(c => createMiniCardHTML(c)).join('')}
        </div>
      `).join('');
    } else {
      myMeldsBox.style.display = 'none';
    }
  }

  if (opponentMeldsBox) {
    if (oppMelds.length > 0) {
      opponentMeldsBox.style.display = 'block';
      opponentMeldsLabel.textContent = `${state.opponent ? state.opponent.name : 'ተቃራኒ'} የወረዱ (${oppMelds.length} ግሩፕ)`;
      opponentMeldsContainer.innerHTML = oppMelds.map(group => `
        <div class="table-meld-group">
          ${group.map(c => createMiniCardHTML(c)).join('')}
        </div>
      `).join('');
    } else {
      opponentMeldsBox.style.display = 'none';
    }
  }
}

// Mini card for table melds (smaller display)
function createMiniCardHTML(card) {
  const isRed = card.suit === '♥' || card.suit === '♦';
  const colorClass = isRed ? 'red' : 'black';
  const jokerBadge = card.isMainJoker ? '⭐' : (card.isFalseJoker ? '🃏' : '');

  return `
    <div class="mini-card ${colorClass}">
      <span>${card.rank}${card.suit}</span>
      ${jokerBadge ? `<span class="mini-joker-badge">${jokerBadge}</span>` : ''}
    </div>
  `;
}
