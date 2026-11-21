// public/app.js

// Initialize or restore player ID
let userId = localStorage.getItem('conquer_user_id');
if (!userId) {
  userId = 'user_' + Math.floor(1000 + Math.random() * 9000);
  localStorage.setItem('conquer_user_id', userId);
}

let playerName = localStorage.getItem('conquer_user_name') || 'Player ' + userId.slice(-4);
let userPhone = localStorage.getItem('conquer_user_phone') || '';
let isUserRegistered = localStorage.getItem('conquer_user_registered') === 'true';
let socket = io();
let currentRoomId = null;
let currentGameState = null;
let selectedCardId = null;
let selectedCardsSet = new Set();
let playerOrderedCardIds = [];
let draggedCardId = null;
let dragJustEndedTime = 0;

// -------------------------------------------------------------
// AUDIO ENGINE (Web Audio API - Realistic Card & Casino Sound Design)
// -------------------------------------------------------------
let soundEnabled = localStorage.getItem('conquer_sound_enabled') !== 'false';
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function updateSoundButtons() {
  const btns = [document.getElementById('soundToggleBtn'), document.getElementById('soundToggleBtnTable')];
  btns.forEach(btn => {
    if (btn) {
      btn.textContent = soundEnabled ? '🔊' : '🔇';
      btn.setAttribute('title', soundEnabled ? 'Mute Sound (ድምፅ አጥፋ)' : 'Unmute Sound (ድምፅ አብራ)');
      btn.classList.toggle('muted', !soundEnabled);
    }
  });
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem('conquer_sound_enabled', soundEnabled);
  updateSoundButtons();
  if (soundEnabled) {
    playCardSound();
  }
}

// 1. Realistic Tactile Card Snap / Placement on Felt Table
function playCardSound() {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Filtered noise burst for paper friction and snap
    const bufferSize = Math.floor(ctx.sampleRate * 0.045);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.25));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, now);
    filter.Q.setValueAtTime(1.8, now);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.12, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(now);

    // Subtle table-thud body tone
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.035);
    oscGain.gain.setValueAtTime(0.08, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.035);
  } catch (e) { }
}

// 2. Card Draw / Slide Sound (Soft card sliding from deck)
function playDrawSound() {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const dur = 0.07;
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.sin((i / bufferSize) * Math.PI);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1600, now);
    filter.frequency.linearRampToValueAtTime(800, now + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
  } catch (e) { }
}

// 3. Gentle Wooden Bell / Marimba Tap for Poke & Turn alert
function playPokeSound() {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Double chime tap (warm 587Hz D5 and 880Hz A5)
    [
      { f: 587.33, t: 0, dur: 0.12, vol: 0.15 },
      { f: 880.00, t: 0.09, dur: 0.18, vol: 0.18 }
    ].forEach(note => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(note.f, now + note.t);
      gain.gain.setValueAtTime(note.vol, now + note.t);
      gain.gain.exponentialRampToValueAtTime(0.001, now + note.t + note.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + note.t);
      osc.stop(now + note.t + note.dur);
    });
  } catch (e) { }
}

// 4. Celebratory Triumphant Winner Chime (Warm C-Major chord cascade)
function playWinSound() {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const notes = [
      { f: 523.25, t: 0, dur: 0.3, vol: 0.15 },     // C5
      { f: 659.25, t: 0.12, dur: 0.35, vol: 0.15 },  // E5
      { f: 783.99, t: 0.24, dur: 0.4, vol: 0.18 },   // G5
      { f: 1046.50, t: 0.36, dur: 0.6, vol: 0.22 }  // C6
    ];
    notes.forEach(note => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(note.f, now + note.t);
      gain.gain.setValueAtTime(note.vol, now + note.t);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.t + note.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + note.t);
      osc.stop(now + note.t + note.dur);
    });
  } catch (e) { }
}

const soundToggleBtn = document.getElementById('soundToggleBtn');
const soundToggleBtnTable = document.getElementById('soundToggleBtnTable');
if (soundToggleBtn) soundToggleBtn.addEventListener('click', toggleSound);
if (soundToggleBtnTable) soundToggleBtnTable.addEventListener('click', toggleSound);
updateSoundButtons();

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
const deckJokerCallBadge = document.getElementById('deckJokerCallBadge');
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
const cutSameBtn = document.getElementById('cutSameBtn');
const cutGonBtn = document.getElementById('cutGonBtn');
const waitingJokerModal = document.getElementById('waitingJokerModal');
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

// Ground 41 Meld Bar & Wered Elements
const groundMeldBar = document.getElementById('groundMeldBar');
const groundMeldTitle = document.getElementById('groundMeldTitle');
const groundTargetCardBadge = document.getElementById('groundTargetCardBadge');
const groundMeldPointsVal = document.getElementById('groundMeldPointsVal');
const groundMeldHintText = document.getElementById('groundMeldHintText');
const confirmGroundMeldBtn = document.getElementById('confirmGroundMeldBtn');
const forfeitGroundBtn = document.getElementById('forfeitGroundBtn');
const cancelGroundMeldBtn = document.getElementById('cancelGroundMeldBtn');
const weredBtn = document.getElementById('weredBtn');
let currentMeldBarMode = 'ground'; // 'ground' or 'wered'

// Initial setup
if (playerNameInput) playerNameInput.value = playerName;
if (walletUserDisplay) walletUserDisplay.textContent = playerName;
const initialSekaNameInput = document.getElementById('sekaPlayerNameInput');
if (initialSekaNameInput) initialSekaNameInput.value = playerName;

// -------------------------------------------------------------
// USER REGISTRATION & PROFILE MODAL LOGIC
// -------------------------------------------------------------
const registerModal = document.getElementById('registerModal');
const openProfileBtn = document.getElementById('openProfileBtn');
const closeRegModalBtn = document.getElementById('closeRegModalBtn');
const registerForm = document.getElementById('registerForm');
const regNameInput = document.getElementById('regNameInput');
const regPhoneInput = document.getElementById('regPhoneInput');
const regErrorMsg = document.getElementById('regErrorMsg');
const submitRegBtn = document.getElementById('submitRegBtn');

function openRegistrationModal() {
  if (!registerModal) return;
  regNameInput.value = (playerName && !playerName.startsWith('Player user_')) ? playerName : '';
  regPhoneInput.value = userPhone || '';
  if (regErrorMsg) {
    regErrorMsg.style.display = 'none';
    regErrorMsg.textContent = '';
  }
  registerModal.style.display = 'flex';
  setTimeout(() => {
    if (!regNameInput.value) {
      regNameInput.focus();
    } else if (regPhoneInput) {
      regPhoneInput.focus();
    }
  }, 100);
}

function closeRegistrationModal() {
  if (!registerModal) return;
  registerModal.style.display = 'none';
}

if (openProfileBtn) {
  openProfileBtn.addEventListener('click', openRegistrationModal);
}

if (closeRegModalBtn) {
  closeRegModalBtn.addEventListener('click', closeRegistrationModal);
}

if (registerModal) {
  registerModal.addEventListener('click', (e) => {
    if (e.target === registerModal && isUserRegistered) {
      closeRegistrationModal();
    }
  });
}

function normalizeEthPhone(phoneStr) {
  if (!phoneStr) return '';
  let cleaned = phoneStr.replace(/[\s\-\(\)]/g, '');
  if (cleaned.startsWith('+251')) {
    cleaned = '0' + cleaned.slice(4);
  } else if (cleaned.startsWith('251')) {
    cleaned = '0' + cleaned.slice(3);
  }
  return cleaned;
}

function validateRegistration(name, phone) {
  if (!name || name.trim().length < 2) {
    return { valid: false, message: 'እባክዎ ትክክለኛ ስም ያስገቡ (ቢያንስ 2 ፊደል) / Please enter a valid name' };
  }
  const cleanPhone = normalizeEthPhone(phone);
  // Ethiopian mobile numbers: 09XXXXXXXX or 07XXXXXXXX (10 digits)
  const ethRegex = /^0(9|7)\d{8}$/;
  if (!ethRegex.test(cleanPhone)) {
    return { valid: false, message: 'እባክዎ ትክክለኛ የኢትዮጵያ ስልክ ቁጥር ያስገቡ (उदा. 0912345678 ወይም 0712345678)' };
  }
  return { valid: true, cleanName: name.trim(), cleanPhone };
}

if (registerForm) {
  registerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const valResult = validateRegistration(regNameInput.value, regPhoneInput.value);
    if (!valResult.valid) {
      if (regErrorMsg) {
        regErrorMsg.textContent = valResult.message;
        regErrorMsg.style.display = 'block';
      }
      return;
    }

    playerName = valResult.cleanName;
    userPhone = valResult.cleanPhone;
    isUserRegistered = true;

    localStorage.setItem('conquer_user_registered', 'true');
    localStorage.setItem('conquer_user_name', playerName);
    localStorage.setItem('conquer_user_phone', userPhone);

    // Update UI elements
    if (walletUserDisplay) walletUserDisplay.textContent = playerName;
    if (playerNameInput) playerNameInput.value = playerName;
    const sNameInp = document.getElementById('sekaPlayerNameInput');
    if (sNameInp) sNameInp.value = playerName;

    // Notify backend
    socket.emit('register_user', { userId, name: playerName, phone: userPhone });
    fetch('/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, name: playerName, phone: userPhone })
    }).catch(() => { });

    playCardSound();
    closeRegistrationModal();

    showSortToast(`🎉 እንኳን ደህና መጡ ${playerName}! 1,000 ETB ቦነስ ተሰጥቷል።`);
  });
}

// Auto-prompt registration on first visit if not registered
if (!isUserRegistered) {
  setTimeout(openRegistrationModal, 600);
}

if (playerNameInput) {
  playerNameInput.addEventListener('change', () => {
    playerName = playerNameInput.value || 'Player';
    localStorage.setItem('conquer_user_name', playerName);
    if (walletUserDisplay) walletUserDisplay.textContent = playerName;
    const sNameInp = document.getElementById('sekaPlayerNameInput');
    if (sNameInp) sNameInp.value = playerName;
    socket.emit('register_user', { userId, name: playerName, phone: userPhone });
  });
}

const initialSekaInput = document.getElementById('sekaPlayerNameInput');
if (initialSekaInput) {
  initialSekaInput.addEventListener('change', () => {
    playerName = initialSekaInput.value || 'Player';
    localStorage.setItem('conquer_user_name', playerName);
    if (walletUserDisplay) walletUserDisplay.textContent = playerName;
    if (playerNameInput) playerNameInput.value = playerName;
    socket.emit('register_user', { userId, name: playerName, phone: userPhone });
  });
}

// Socket connection
socket.on('connect', () => {
  socket.emit('register_user', { userId, name: playerName, phone: userPhone });
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

socket.on('room_expired', ({ message }) => {
  closeWaitingForOpponentModal();
  alert(message || '⏳ ጨዋታው በ1 ደቂቃ ውስጥ ተጋጣሚ ስላልገባ ፈርሷል (Game expired)');
  switchToLobbyView();
  refreshRoomsList();
  refreshSekaRoomsList();
});

socket.on('rooms_updated', () => {
  refreshRoomsList();
  refreshSekaRoomsList();
});

socket.on('room_created', ({ roomId }) => {
  currentRoomId = roomId;
  switchToGameView();
});

// Real-Time Game State Sync (Conquer)
socket.on('game_state', (state) => {
  if (state.roomId !== currentRoomId) {
    playerOrderedCardIds = [];
    currentRoomId = state.roomId;
  }
  if (state.status === 'PLAYING' && state.myHand) {
    state.myHand = syncHandPreservingOrder(state.myHand);
  }
  currentGameState = state;
  renderGame(state);
});

// -------------------------------------------------------------
// WAITING FOR OPPONENT / SEARCHING FOR PLAYERS MODAL LOGIC
// -------------------------------------------------------------
let waitingCountdownTimer = null;
let currentWaitingRoomId = null;

function showWaitingForOpponentModal(roomId, expiresAt, stakeAmount) {
  currentWaitingRoomId = roomId;
  const modal = document.getElementById('waitingForOpponentModal');
  const tableIdEl = document.getElementById('waitingTableId');
  const stakeEl = document.getElementById('waitingTableStake');
  const countdownEl = document.getElementById('waitingCountdownText');

  if (tableIdEl) tableIdEl.textContent = '#' + roomId.replace(/^seka_/, '');
  if (stakeEl && stakeAmount) stakeEl.textContent = stakeAmount + ' ETB';
  if (modal) modal.style.display = 'flex';

  if (waitingCountdownTimer) clearInterval(waitingCountdownTimer);
  const targetEnd = expiresAt || (Date.now() + 60 * 1000);

  function updateTimer() {
    const remaining = Math.max(0, Math.round((targetEnd - Date.now()) / 1000));
    if (countdownEl) countdownEl.textContent = `⏳ ${remaining}s ይቀራል`;
    if (remaining <= 0) {
      clearInterval(waitingCountdownTimer);
      waitingCountdownTimer = null;
    }
  }
  updateTimer();
  waitingCountdownTimer = setInterval(updateTimer, 1000);
}

function closeWaitingForOpponentModal() {
  if (waitingCountdownTimer) {
    clearInterval(waitingCountdownTimer);
    waitingCountdownTimer = null;
  }
  currentWaitingRoomId = null;
  const modal = document.getElementById('waitingForOpponentModal');
  if (modal) modal.style.display = 'none';
}

const cancelWaitingRoomBtn = document.getElementById('cancelWaitingRoomBtn');
if (cancelWaitingRoomBtn) {
  cancelWaitingRoomBtn.addEventListener('click', () => {
    if (currentWaitingRoomId) {
      socket.emit('leave_seka_room', { roomId: currentWaitingRoomId, userId });
    }
    closeWaitingForOpponentModal();
    playCardSound();
    showSortToast('ጠረጴዛው ተሰርዟል፤ ውርርድዎ ተመልሷል');
    refreshSekaRoomsList();
  });
}

// Real-Time Game State Sync (Seka)
socket.on('seka_room_created', ({ roomId, expiresAt, isBot, stakeAmount }) => {
  currentRoomId = roomId;
  if (isBot) {
    switchToGameView();
  } else {
    // Creator waits in lobby until another player joins (game MUST NOT start until opponent arrives)
    const sekaStakeSelect = document.getElementById('sekaStakeSelect');
    const stake = stakeAmount || (sekaStakeSelect ? Number(sekaStakeSelect.value) : 100);
    showWaitingForOpponentModal(roomId, expiresAt, stake);
    refreshSekaRoomsList();
  }
});

socket.on('seka_game_state', (state) => {
  if (state.roomId !== currentRoomId) {
    playerOrderedCardIds = [];
    currentRoomId = state.roomId;
  }
  // The game ONLY starts when status becomes PLAYING!
  if (state.status === 'PLAYING') {
    closeWaitingForOpponentModal();
    if (gameView.style.display === 'none') {
      switchToGameView();
    }
  }
  if (state.status === 'PLAYING' && state.myHand) {
    state.myHand = syncHandPreservingOrder(state.myHand);
  }
  currentGameState = state;
  renderGame(state);
});

// Game Selector (Home Page: Conquer Coming Soon vs Seka Play Now)
const homeGameSelectView = document.getElementById('homeGameSelectView');
const homeConquerBtn = document.getElementById('homeConquerBtn');
const homeSekaBtn = document.getElementById('homeSekaBtn');
const backToHomeBtn = document.getElementById('backToHomeBtn');
const sekaLobbySection = document.getElementById('sekaLobbySection');
const createSekaRoomBtn = document.getElementById('createSekaRoomBtn');
const playSekaBotBtn = document.getElementById('playSekaBotBtn');
const conquerComingSoonModal = document.getElementById('conquerComingSoonModal');
const goToSekaFromModalBtn = document.getElementById('goToSekaFromModalBtn');
const closeConquerModalBtn = document.getElementById('closeConquerModalBtn');

if (homeSekaBtn) {
  homeSekaBtn.addEventListener('click', () => {
    playCardSound();
    if (homeGameSelectView) homeGameSelectView.style.display = 'none';
    if (sekaLobbySection) sekaLobbySection.style.display = 'block';
    refreshSekaRoomsList();
  });
}

if (homeConquerBtn) {
  homeConquerBtn.addEventListener('click', () => {
    playCardSound();
    if (conquerComingSoonModal) {
      conquerComingSoonModal.style.display = 'flex';
    } else {
      showSortToast('👑 የኮንከር (Conquer) ጨዋታ በቅርቡ ይጠብቁ! (Coming Soon)');
    }
  });
}

if (closeConquerModalBtn && conquerComingSoonModal) {
  closeConquerModalBtn.addEventListener('click', () => {
    conquerComingSoonModal.style.display = 'none';
  });
}

if (goToSekaFromModalBtn && conquerComingSoonModal) {
  goToSekaFromModalBtn.addEventListener('click', () => {
    conquerComingSoonModal.style.display = 'none';
    if (homeGameSelectView) homeGameSelectView.style.display = 'none';
    if (sekaLobbySection) sekaLobbySection.style.display = 'block';
    refreshSekaRoomsList();
  });
}

if (backToHomeBtn) {
  backToHomeBtn.addEventListener('click', () => {
    playCardSound();
    if (sekaLobbySection) sekaLobbySection.style.display = 'none';
    if (homeGameSelectView) homeGameSelectView.style.display = 'flex';
  });
}

// Create Seka Room
if (createSekaRoomBtn) {
  createSekaRoomBtn.addEventListener('click', () => {
    const sekaNameInput = document.getElementById('sekaPlayerNameInput');
    const sekaStakeSelect = document.getElementById('sekaStakeSelect');
    const sekaPlayersSelect = document.getElementById('sekaPlayersSelect');
    const sName = sekaNameInput && sekaNameInput.value ? sekaNameInput.value : playerName;
    const stakeAmount = sekaStakeSelect ? Number(sekaStakeSelect.value) : 100;
    const maxPlayers = sekaPlayersSelect ? (Number(sekaPlayersSelect.value) === 3 ? 3 : 2) : 2;
    playCardSound();
    socket.emit('create_seka_room', { userId, name: sName, stakeAmount, maxPlayers });
  });
}

// Play Seka vs Bot
if (playSekaBotBtn) {
  playSekaBotBtn.addEventListener('click', () => {
    const sekaNameInput = document.getElementById('sekaPlayerNameInput');
    const sekaStakeSelect = document.getElementById('sekaStakeSelect');
    const sName = sekaNameInput && sekaNameInput.value ? sekaNameInput.value : playerName;
    const stakeAmount = sekaStakeSelect ? Number(sekaStakeSelect.value) : 100;
    playCardSound();
    socket.emit('play_seka_bot', { userId, name: sName, stakeAmount });
  });
}

// Deposit Button
if (depositBtn) {
  depositBtn.addEventListener('click', async () => {
    await fetch('/api/wallet/deposit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, amount: 500 })
    });
    playCardSound();
    socket.emit('register_user', { userId, name: playerName, phone: userPhone });
  });
}

// Create Room (Conquer)
if (createRoomBtn) {
  createRoomBtn.addEventListener('click', () => {
    const stakeAmount = Number(stakeSelect?.value) || 100;
    socket.emit('create_room', { userId, name: playerName, stakeAmount });
  });
}

// Play Against Bot (Conquer)
if (playBotBtn) {
  playBotBtn.addEventListener('click', () => {
    const stakeAmount = Number(stakeSelect?.value) || 100;
    socket.emit('play_vs_bot', { userId, name: playerName, stakeAmount });
    switchToGameView();
  });
}

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
          <div style="font-size: 12px; color: #94a3b8;">Stake: ${r.stakeAmount} ETB ${r.expiresIn ? `| <span style="color: #f59e0b;">⏳ ${r.expiresIn}s ይቀራል</span>` : ''}</div>
        </div>
        <button class="btn-primary" style="width: auto; padding: 6px 14px; font-size: 12px;" onclick="joinRoom('${r.roomId}')">Join Table</button>
      </div>
    `).join('');
  } catch (e) { }
  refreshSekaRoomsList();
}

async function refreshSekaRoomsList() {
  try {
    const res = await fetch('/api/seka/rooms');
    const rooms = await res.json();
    const sekaContainer = document.getElementById('sekaRoomsListContainer');
    if (!sekaContainer) return;
    if (rooms.length === 0) {
      sekaContainer.innerHTML = `<p style="color: #64748b; font-size: 14px;">በአሁኑ ሰዓት ክፍት የሴካ ጠረጴዛ የለም። አዲስ ጠረጴዛ ይፍጠሩ ወይም ከAI Bot ጋር ይጫወቱ!</p>`;
      return;
    }
    sekaContainer.innerHTML = rooms.map(r => `
      <div class="room-list-item">
        <div>
          <strong style="color: #f59e0b;">🃏 ${r.creatorName}'s Seka Table</strong>
          <div style="font-size: 12px; color: #94a3b8;">Stake: ${r.stakeAmount} ETB | ${r.playersCount || 1}/${r.maxPlayers || 2} ተጫዋቾች ${r.expiresIn ? `| <span style="color: #f59e0b;">⏳ ${r.expiresIn}s ይቀራል</span>` : ''}</div>
        </div>
        <button class="btn-primary" style="width: auto; padding: 6px 14px; font-size: 12px; background: linear-gradient(135deg, #f59e0b, #d97706); border-color: #fbbf24;" onclick="joinSekaRoom('${r.roomId}')">ጠረጴዛ ተቀላቀል</button>
      </div>
    `).join('');
  } catch (e) { }
}

window.joinRoom = function (roomId) {
  socket.emit('join_room', { roomId, userId, name: playerName });
  switchToGameView();
};

window.joinSekaRoom = function (roomId) {
  const sekaNameInput = document.getElementById('sekaPlayerNameInput');
  const sName = sekaNameInput && sekaNameInput.value ? sekaNameInput.value : playerName;
  currentRoomId = roomId;
  playCardSound();
  socket.emit('join_seka_room', { roomId, userId, name: sName });
};

function switchToGameView() {
  document.documentElement.classList.add('in-game');
  document.body.classList.add('in-game');
  hasPlayedDealingAnim = false;
  isDealingInProgress = false;
  previousHandLength = 0;
  previousOpponentCardCount = 0;
  previousGroundCardId = null;
  playerOrderedCardIds = [];
  selectedCardsSet.clear();
  selectedCardId = null;
  lobbyView.style.display = 'none';
  gameView.style.display = 'block';
}

function switchToLobbyView() {
  document.documentElement.classList.remove('in-game');
  document.body.classList.remove('in-game');
  hasPlayedDealingAnim = false;
  isDealingInProgress = false;
  previousHandLength = 0;
  previousOpponentCardCount = 0;
  previousGroundCardId = null;
  playerOrderedCardIds = [];
  if (baseJokerCardContainer) {
    baseJokerCardContainer.style.display = 'none';
    baseJokerCardContainer.innerHTML = '';
  }
  if (deckJokerCallBadge) {
    deckJokerCallBadge.style.display = 'none';
    deckJokerCallBadge.innerHTML = '';
  }
  if (groundMeldBar) groundMeldBar.style.display = 'none';
  selectedCardsSet.clear();
  selectedCardId = null;
  lobbyView.style.display = 'block';
  gameView.style.display = 'none';
  if (homeGameSelectView) homeGameSelectView.style.display = 'flex';
  if (sekaLobbySection) sekaLobbySection.style.display = 'none';
  cutJokerModal.style.display = 'none';
  if (waitingJokerModal) waitingJokerModal.style.display = 'none';
  closeWaitingForOpponentModal();
  gameResultModal.style.display = 'none';
  const winningHandDisplay = document.getElementById('winningHandDisplay');
  if (winningHandDisplay) winningHandDisplay.style.display = 'none';
  refreshRoomsList();
  refreshSekaRoomsList();
}

leaveGameBtn.addEventListener('click', () => {
  if (currentGameState && currentGameState.gameType === 'SEKA') {
    socket.emit('leave_seka_room', { roomId: currentRoomId, userId });
  }
  switchToLobbyView();
});

// Rule 2: Blind Cut Joker Selection (Joiner calls before dealing)
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

cutSameBtn.addEventListener('click', () => {
  if (currentRoomId) {
    playCardSound();
    socket.emit('set_joker_high_low', { roomId: currentRoomId, userId, choice: 'same' });
    cutJokerModal.style.display = 'none';
  }
});

cutGonBtn.addEventListener('click', () => {
  if (currentRoomId) {
    playCardSound();
    socket.emit('set_joker_high_low', { roomId: currentRoomId, userId, choice: 'gon' });
    cutJokerModal.style.display = 'none';
  }
});

function handleDrawAction(source) {
  if (!currentGameState || currentGameState.status !== 'PLAYING') return;
  if (currentGameState.currentTurnPlayerId !== userId) return alert('Not your turn!');
  if (currentGameState.turnState !== 'AWAITING_DRAW') return alert('Already drew card! Discard one now.');

  if (currentGameState.gameType === 'SEKA') {
    playDrawSound();
    socket.emit('draw_seka_card', { roomId: currentRoomId, userId, source });
    return;
  }

  if (source === 'deck') {
    if (groundMeldBar) groundMeldBar.style.display = 'none';
    playDrawSound();
    socket.emit('draw_card', { roomId: currentRoomId, userId, source: 'deck' });
    return;
  }

  if (source === 'ground') {
    if (!currentGameState.topGroundCard) return;
    if (currentGameState.isFirstDiscard) {
      showSortToast('⚠️ የመጀመሪያው ካርታ ከመሬት አይነሳም!');
      return;
    }

    // Direct draw from ground as requested: "so useru siyanes mnm atebelew yansa gin 41 mewred alebet gebak"
    playDrawSound();
    currentGameState.mustMeld41 = true;
    socket.emit('draw_card', { roomId: currentRoomId, userId, source: 'ground' });
    return;
  }
}

// Open Ground Meld Mode
function openGroundMeldBar() {
  if (!currentGameState || !groundMeldBar) return;
  currentMeldBarMode = 'ground';
  groundMeldBar.style.display = 'flex';
  const topGround = currentGameState.topGroundCard;
  if (groundMeldTitle) {
    groundMeldTitle.textContent = '📥 ከመሬት ለማንሳት 41 ማውረድ አለብህ';
  }
  if (topGround && groundTargetCardBadge) {
    groundTargetCardBadge.textContent = `ካርታ: [ ${topGround.rank}${topGround.suit} ]`;
  }
  if (forfeitGroundBtn) {
    forfeitGroundBtn.style.display = 'inline-block';
  }
  updateGroundMeldBar();
}

// Open Wered (Meld to table) Mode
function openWeredMeldBar() {
  if (!currentGameState || !groundMeldBar) return;
  currentMeldBarMode = 'wered';
  groundMeldBar.style.display = 'flex';
  const hasAlreadyOpened = currentGameState.tableMelds && currentGameState.tableMelds[userId] && currentGameState.tableMelds[userId].length > 0;

  if (groundMeldTitle) {
    groundMeldTitle.textContent = hasAlreadyOpened ? '📥 ካርታዎችን ወደ ጠረጴዛ አውርድ' : '📥 ለመውረድ ቢያንስ 41 ነጥብ ትሪስ ምረጥ';
  }
  if (groundTargetCardBadge) {
    groundTargetCardBadge.textContent = hasAlreadyOpened ? 'ሜልድ' : 'መጀመሪያ ማውረድ (41+)';
  }
  if (forfeitGroundBtn) {
    forfeitGroundBtn.style.display = 'none'; // Only applies when taking from ground
  }
  updateGroundMeldBar();
}

function handleWeredAction() {
  if (!currentGameState || currentGameState.status !== 'PLAYING') return;
  if (currentGameState.currentTurnPlayerId !== userId) {
    return alert('የአንተ ተራ አይደለም!');
  }

  const selectedCards = (currentGameState.myHand || []).filter(c =>
    selectedCardsSet.has(String(c.id)) || selectedCardsSet.has(c.id)
  );

  // If cards are already selected, try to meld them directly
  if (selectedCards.length >= 3) {
    const validPartition = partitionIntoValidMelds(
      selectedCards,
      currentGameState.jokerRank,
      currentGameState.jokerSuits
    );
    if (!validPartition) {
      const cardNames = selectedCards.map(c => `${c.rank}${c.suit}`).join(' ');
      return alert(`የመረጥካቸው ካርታዎች [ ${cardNames} ] ትክክለኛ ትሪስ (Meld) አልሰሩም!\nተመሳሳይ ቁጥር (ለምሳሌ 7♥ 7♦ 7♠) ወይም ተከታታይ ካርታዎች (ለምሳሌ 5♥ 6♥ 7♥) መሆን አለባቸው።`);
    }

    let totalPts = 0;
    selectedCards.forEach(c => { totalPts += c.pointValue || 0; });

    // Direct meld execution!
    executeMeldDown(validPartition, totalPts);
    return;
  }

  showSortToast('👉 ለማውረድ ቢያንስ 1 ትሪስ (3 ካርታ) መርጠህ "ውረድ" ን ተጫን!');
}

function executeMeldDown(melds, totalPts) {
  playCardSound();
  const meldedCardIds = new Set(melds.flat().map(c => c.id));

  // Optimistically remove melded cards so hand does not scramble
  playerOrderedCardIds = playerOrderedCardIds.filter(id => !meldedCardIds.has(id));
  if (currentGameState && currentGameState.myHand) {
    currentGameState.myHand = currentGameState.myHand.filter(c => !meldedCardIds.has(c.id));
    renderPlayerHand(currentGameState.myHand);
  }

  socket.emit('lay_down_melds', {
    roomId: currentRoomId,
    userId,
    melds
  });

  selectedCardsSet.clear();
  selectedCardId = null;
  if (groundMeldBar) groundMeldBar.style.display = 'none';

  showSortToast(`📥 ${totalPts} ነጥብ ወረደ!`);
}

if (weredBtn) {
  weredBtn.addEventListener('click', handleWeredAction);
}

// Live update points and hint in Ground Meld Bar as cards are selected
function updateGroundMeldBar() {
  if (!groundMeldBar || groundMeldBar.style.display === 'none') return;
  if (!currentGameState || !currentGameState.myHand) return;

  const selectedCards = currentGameState.myHand.filter(c => selectedCardsSet.has(c.id));
  const jokerRank = currentGameState.jokerRank;
  const hasAlreadyOpened = currentGameState.tableMelds && currentGameState.tableMelds[userId] && currentGameState.tableMelds[userId].length > 0;

  // Attempt to partition selected cards into valid melds
  const validPartition = partitionIntoValidMelds(selectedCards, jokerRank);

  let totalPts = 0;
  selectedCards.forEach(c => { totalPts += c.pointValue || 0; });

  groundMeldPointsVal.textContent = totalPts;

  if (selectedCards.length === 0) {
    if (currentMeldBarMode === 'wered') {
      groundMeldHintText.textContent = hasAlreadyOpened
        ? '👉 ወደ ጠረጴዛ ለማውረድ የሚሆኑ ትሪሶችን ከእጅህ ምረጥ!'
        : '👉 ለመጀመሪያ ጊዜ ለመውረድ 41 የሚሞሉትን ካርታዎች ከእጅህ ምረጥ!';
    } else {
      groundMeldHintText.textContent = '👉 ከመሬት ለማንሳት 41 የሚሞሉትን ካርታዎች (Melds) ከእጅህ ምረጥ!';
    }
    groundMeldHintText.style.color = '#f5b041';
    confirmGroundMeldBtn.disabled = true;
    confirmGroundMeldBtn.style.opacity = '0.5';
    confirmGroundMeldBtn.textContent = currentMeldBarMode === 'wered' ? '✅ አውርድ' : '✅ 41 ሞልቷል - አውርድና አንሳ';
  } else if (!validPartition) {
    const isMultipleJokers = selectedCards.filter(c => isWildJoker(c, currentGameState.jokerRank, currentGameState.jokerSuits) || isSekaWildJoker(c)).length > 1;
    if (isMultipleJokers) {
      groundMeldHintText.textContent = `⚠️ ተከታታይ ጆከር ማድረግ አይቻልም! በአንድ ሜልድ ውስጥ ከአንድ ጆከር በላይ መጠቀም አይቻልም!`;
    } else {
      groundMeldHintText.textContent = `⚠️ የተመረጡት ካርታዎች (${selectedCards.length}) ትክክለኛ ትሪስ (Meld) አልሰሩም! 3 ወይም 4 የሚሆኑ ተመሳሳይ ወይም ተከታታይ ካርታዎችን ምረጥ!`;
    }
    groundMeldHintText.style.color = '#f87171';
    confirmGroundMeldBtn.disabled = true;
    confirmGroundMeldBtn.style.opacity = '0.5';
    confirmGroundMeldBtn.textContent = currentMeldBarMode === 'wered' ? '✅ አውርድ' : '✅ 41 ሞልቷል - አውርድና አንሳ';
  } else if (!hasAlreadyOpened && totalPts < 41) {
    const meldNames = validPartition.map(m => m.map(c => c.rank + c.suit).join('-')).join(' + ');
    groundMeldHintText.textContent = `⚠️ ${totalPts} ነጥብ ብቻ ነው (${meldNames})! 41 አልሞላም — እባክህ ሌላ ትሪስ (Meld) ጨምር!`;
    groundMeldHintText.style.color = '#f87171';
    confirmGroundMeldBtn.disabled = true;
    confirmGroundMeldBtn.style.opacity = '0.5';
    confirmGroundMeldBtn.textContent = currentMeldBarMode === 'wered' ? '✅ አውርድ' : '✅ 41 ሞልቷል - አውርድና አንሳ';
  } else {
    // Reached 41 or has already opened!
    const meldNames = validPartition.map(m => m.map(c => c.rank + c.suit).join('-')).join(' + ');
    if (currentMeldBarMode === 'wered') {
      groundMeldHintText.textContent = `✅ ${totalPts} ነጥብ (${meldNames})! አሁን ወደ ጠረጴዛ ማውረድ ትችላለህ!`;
      confirmGroundMeldBtn.textContent = '✅ አውርድ (ወደ ጠረጴዛ)';
    } else {
      groundMeldHintText.textContent = `✅ ${totalPts} ነጥብ ሞልቷል (${meldNames})! አውርደህ ከመሬት ማንሳት ትችላለህ!`;
      confirmGroundMeldBtn.textContent = '✅ 41 ሞልቷል - አውርድና አንሳ';
    }
    groundMeldHintText.style.color = '#4ade80';
    confirmGroundMeldBtn.disabled = false;
    confirmGroundMeldBtn.style.opacity = '1';
  }
}

// Confirm Ground Meld or Wered Lay Down
confirmGroundMeldBtn.addEventListener('click', () => {
  if (!currentGameState || !currentGameState.myHand) return;
  const selectedCards = currentGameState.myHand.filter(c => selectedCardsSet.has(c.id));
  const validPartition = partitionIntoValidMelds(selectedCards, currentGameState.jokerRank);

  let totalPts = 0;
  selectedCards.forEach(c => { totalPts += c.pointValue || 0; });

  const hasAlreadyOpened = currentGameState.tableMelds && currentGameState.tableMelds[userId] && currentGameState.tableMelds[userId].length > 0;

  if (currentMeldBarMode === 'wered') {
    if (!validPartition || (!hasAlreadyOpened && totalPts < 41)) {
      return alert('ያልተሟላ ወይም ከ41 ነጥብ በታች የሆነ ሜልድ ነው!');
    }
    executeMeldDown(validPartition, totalPts);
    return;
  }

  if (!validPartition || totalPts < 41) {
    // If player insists on confirming with < 41 when drawing from ground: they forfeit (kelelw gin yeshenefal)
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

// Discard Selected Card to Ground (መሬት ጣል)
discardBtn.addEventListener('click', () => {
  if (!selectedCardId && selectedCardsSet.size === 0) return alert('ከእጅህ አንድ የሚጣል ካርታ ምረጥ!');
  if (!currentGameState || currentGameState.turnState !== 'AWAITING_DISCARD') {
    return alert('ካርታ ከመጣልህ በፊት መጀመሪያ ካርታ መሳብ አለብህ!');
  }

  // Handle Seka Discard
  if (currentGameState.gameType === 'SEKA') {
    const cardToDiscard = selectedCardId || Array.from(selectedCardsSet)[0];
    if (!cardToDiscard) return alert('ከእጅህ አንድ የሚጣል ካርታ ምረጥ!');
    playCardSound();

    if (cardToDiscard) {
      playerOrderedCardIds = playerOrderedCardIds.filter(id => id !== cardToDiscard);
      selectedCardsSet.delete(cardToDiscard);
      if (selectedCardId === cardToDiscard) selectedCardId = null;
      if (currentGameState && currentGameState.myHand) {
        currentGameState.myHand = currentGameState.myHand.filter(c => c.id !== cardToDiscard);
        renderPlayerHand(currentGameState.myHand);
      }
    }

    socket.emit('discard_seka_card', {
      roomId: currentRoomId,
      userId,
      cardId: cardToDiscard
    });
    return;
  }

  // If user drew from ground, they MUST meld 41 before discarding!
  if (currentGameState.mustMeld41) {
    if (confirm('⚠️ ከመሬት ስላነሳህ 41 ሳታወርድ ወደ መሬት መጣል አትችልም!\n\n41 ማውረድ ካልቻልክ ጨዋታውን ትሸነፋለህ! እጅ መስጠት (መሸነፍ) ትፈልጋለህ?')) {
      socket.emit('forfeit_ground_fail', { roomId: currentRoomId, userId });
    }
    return;
  }

  const cardToDiscard = selectedCardId || Array.from(selectedCardsSet)[0];
  const cardObj = currentGameState.myHand?.find(c => c.id === cardToDiscard);

  // Rule: GEBI (ገቢ) Restriction on Discarding
  // A player CANNOT discard a card to ground if it can be GEBI into any open table meld!
  if (cardObj && isCardGebiToTable(cardObj, currentGameState.tableMelds, currentGameState.jokerRank, currentGameState.jokerSuits)) {
    showSortToast(`⚠️ [ ${cardObj.rank}${cardObj.suit} ] ወደ ጠረጴዛው ሜልድ ገቢ (GEBI) ስለሚሆን ወደ መሬት መጣል አትችልም! ጠረጴዛው ላይ ገቢ አድርግ ወይም ሌላ ካርታ ጣል!`);
    return;
  }

  playCardSound();

  // Optimistically remove the discarded card from player's hand immediately so remaining cards never scramble!
  if (cardToDiscard) {
    playerOrderedCardIds = playerOrderedCardIds.filter(id => id !== cardToDiscard);
    if (currentGameState && currentGameState.myHand) {
      currentGameState.myHand = currentGameState.myHand.filter(c => c.id !== cardToDiscard);
      renderPlayerHand(currentGameState.myHand);
    }
  }

  // If hand has 13 cards fully melded (Conquer), discarding the 14th card claims the win!
  const isWinningHand = currentGameState._winningMelds && currentGameState._winningMelds.length >= 3;
  socket.emit('discard_card', {
    roomId: currentRoomId,
    userId,
    cardId: cardToDiscard,
    toGebi: isWinningHand,
    melds: isWinningHand ? currentGameState._winningMelds : null
  });
  selectedCardsSet.clear();
  selectedCardId = null;
  updateTakeGroundButton();
});

// Seka Win Button (ሴካ አሸንፍ)
const sekaWinBtn = document.getElementById('sekaWinBtn');
if (sekaWinBtn) {
  sekaWinBtn.addEventListener('click', () => {
    if (!currentGameState || currentGameState.gameType !== 'SEKA') return;
    if (currentGameState.currentTurnPlayerId !== userId) return alert('የአንተ ተራ አይደለም!');
    if (currentGameState.turnState !== 'AWAITING_DISCARD') return alert('ለማሸነፍ መጀመሪያ 1 ካርታ አንሳ!');

    const discardCard = selectedCardId || (selectedCardsSet.size === 1 ? Array.from(selectedCardsSet)[0] : null);
    playCardSound();
    socket.emit('claim_seka_win', {
      roomId: currentRoomId,
      userId,
      discardCardId: discardCard
    });
  });
}

// Conquer Button (ኮንከር!)
if (conquerBtn) {
  conquerBtn.addEventListener('click', () => {
    triggerConquer();
  });
}

function triggerConquer() {
  if (!currentGameState || currentGameState.currentTurnPlayerId !== userId) return alert('Not your turn!');
  if (currentGameState.turnState !== 'AWAITING_DISCARD') {
    return alert('ካርታ ከመጣልህ በፊት መጀመሪያ ካርታ መሳብ አለብህ!');
  }

  const cardToDiscard = selectedCardId || currentGameState._tetayCardId || (currentGameState.myHand && currentGameState.myHand[currentGameState.myHand.length - 1]?.id);
  if (!cardToDiscard) return alert('መሬት ላይ የሚጣለውን የመጨረሻ ተጣይ ካርታ ምረጥ!');

  const remainingHand = currentGameState.myHand.filter(c => c.id !== cardToDiscard);
  const melds = currentGameState._winningMelds || autoGroupHandIntoMelds(remainingHand);

  socket.emit('discard_card', {
    roomId: currentRoomId,
    userId,
    cardId: cardToDiscard,
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

function moveSelectedCard(dir) {
  if (!selectedCardId || !currentGameState || !currentGameState.myHand) return;
  const idx = currentGameState.myHand.findIndex(c => c.id === selectedCardId);
  const targetIdx = idx + dir;
  if (idx !== -1 && targetIdx >= 0 && targetIdx < currentGameState.myHand.length) {
    const temp = currentGameState.myHand[idx];
    currentGameState.myHand[idx] = currentGameState.myHand[targetIdx];
    currentGameState.myHand[targetIdx] = temp;
    playerOrderedCardIds = currentGameState.myHand.map(c => c.id);
    playCardSound();
    renderPlayerHand(currentGameState.myHand);
  }
}

// Keyboard Left/Right Arrow keys to manually shift cards smoothly
window.addEventListener('keydown', (e) => {
  if (!selectedCardId || !currentGameState || !currentGameState.myHand) return;
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    moveSelectedCard(-1);
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    moveSelectedCard(1);
  }
});

// Toggle Groups View
if (groupMeldsBtn) {
  groupMeldsBtn.addEventListener('click', () => {
    isGroupViewActive = !isGroupViewActive;
    groupMeldsBtn.textContent = isGroupViewActive ? '🃏 View in Single Line' : '🗂️ View in Groups';
    groupMeldsBtn.style.background = isGroupViewActive ? '#38bdf8' : 'rgba(15, 23, 42, 0.85)';
    groupMeldsBtn.style.color = isGroupViewActive ? '#000' : '#fff';
    renderPlayerHand(currentGameState.myHand);
  });
}

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

function isNaturalMeld(cards) {
  if (!cards || (cards.length !== 3 && cards.length !== 4)) return false;
  if (cards.some(c => c.isJoker || c.isMainJoker || c.isFalseJoker)) return false;
  if (isSequenceSameSuit(cards)) return true;
  if (cards.every(c => c.rank === cards[0].rank)) {
    const suits = new Set(cards.map(c => c.suit));
    return suits.size >= 2;
  }
  return false;
}

function isWildJoker(c, jokerRank, jokerSuits) {
  if (!c) return false;
  if (c.isFalseJoker) return false; // False joker is NEVER wild!
  if (c.isJoker && !c.isFalseJoker) return true;
  if (jokerRank && c.rank === jokerRank) {
    if (!jokerSuits || jokerSuits.includes(c.suit)) return true;
  }
  return false;
}

function isValidTris(cards, jokerRank, jokerSuits) {
  if (!cards || cards.length !== 3) return false;
  if (isNaturalMeld(cards)) return true;

  const isJk = (c) => isWildJoker(c, jokerRank, jokerSuits);
  const jokerCount = cards.filter(isJk).length;
  if (jokerCount > 1) return false;

  const naturalCards = cards.filter(c => !isJk(c));
  const getRank = (c) => (c.isFalseJoker ? jokerRank : c.rank);

  // Case 1: Pure Tris (Set of 3 same rank, or False Joker substituting designated rank)
  if (jokerCount === 0) {
    const r0 = getRank(naturalCards[0]);
    if (r0 && getRank(naturalCards[1]) === r0 && getRank(naturalCards[2]) === r0) {
      const suits = new Set(naturalCards.map(c => c.suit));
      return suits.size >= 2;
    }
    const cardsWithRanks = naturalCards.map(c => ({ rank: getRank(c), suit: c.suit }));
    if (isSequenceSameSuit(cardsWithRanks)) return true;
  }

  // Case 2: Tris with 1 Joker
  if (jokerCount === 1) {
    const r0 = getRank(naturalCards[0]);
    const r1 = getRank(naturalCards[1]);
    if (r0 && r0 === r1) return true;
    if (naturalCards[0].suit === naturalCards[1].suit) {
      if (canFormSequenceWithJoker([
        { rank: r0, suit: naturalCards[0].suit },
        { rank: r1, suit: naturalCards[1].suit }
      ], 1, 3)) return true;
    }
  }
  return false;
}

function isValidQuatris(cards, jokerRank, jokerSuits) {
  if (!cards || cards.length !== 4) return false;
  if (isNaturalMeld(cards)) return true;

  const isJk = (c) => isWildJoker(c, jokerRank, jokerSuits);
  const jokerCount = cards.filter(isJk).length;
  if (jokerCount > 1) return false;

  const naturalCards = cards.filter(c => !isJk(c));
  const getRank = (c) => (c.isFalseJoker ? jokerRank : c.rank);

  // Case 1: Pure Quatris (4 same rank or 4 sequence same suit)
  if (jokerCount === 0) {
    const r0 = getRank(naturalCards[0]);
    if (r0 && naturalCards.every(c => getRank(c) === r0)) {
      const suits = new Set(naturalCards.map(c => c.suit));
      return suits.size >= 2;
    }
    const cardsWithRanks = naturalCards.map(c => ({ rank: getRank(c), suit: c.suit }));
    if (isSequenceSameSuit(cardsWithRanks)) return true;
  }

  // Case 2: Quatris with 1 Joker
  if (jokerCount === 1) {
    const r0 = getRank(naturalCards[0]);
    if (r0 && naturalCards.every(c => getRank(c) === r0)) return true;
    if (naturalCards.every(c => c.suit === naturalCards[0].suit)) {
      if (canFormSequenceWithJoker(naturalCards.map(c => ({ rank: getRank(c), suit: c.suit })), 1, 4)) return true;
    }
  }
  return false;
}

// Partitions a set of selected cards (e.g. 6 or 7 cards) into valid disjoint Tris / Quatris melds
function partitionIntoValidMelds(cards, jokerRank, jokerSuits) {
  if (!cards || cards.length < 3) return null;
  if (cards.length === 3 && isValidTris(cards, jokerRank, jokerSuits)) return [cards];
  if (cards.length === 4 && isValidQuatris(cards, jokerRank, jokerSuits)) return [cards];
  if (cards.length === 6) {
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 5; j++) {
        for (let k = j + 1; k < 6; k++) {
          const m1 = [cards[i], cards[j], cards[k]];
          const m2 = cards.filter((_, idx) => idx !== i && idx !== j && idx !== k);
          if (isValidTris(m1, jokerRank, jokerSuits) && isValidTris(m2, jokerRank, jokerSuits)) {
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
            if ((isValidQuatris(m1, jokerRank, jokerSuits) && isValidTris(m2, jokerRank, jokerSuits)) ||
              (isValidTris(m1, jokerRank, jokerSuits) && isValidQuatris(m2, jokerRank, jokerSuits))) {
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
            if (isValidQuatris(m1, jokerRank, jokerSuits) && isValidQuatris(m2, jokerRank, jokerSuits)) {
              return [m1, m2];
            }
          }
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

// Rule: In same-rank sets, sandwich colors:
// 2 Reds + 1 Black -> [Red, Black, Red] (e.g. 5♦ 5♠ 5♥)
// 2 Blacks + 1 Red -> [Black, Red, Black] (e.g. 5♠ 5♦ 5♣)
// 2 Reds + 2 Blacks -> [Red, Black, Red, Black]
function orderSameRankSet(cards) {
  if (!cards || cards.length < 3) return cards;

  const isRed = (c) => c.suit === '♥' || c.suit === '♦';
  const reds = cards.filter(isRed);
  const blacks = cards.filter(c => !isRed(c));

  if (cards.length === 3) {
    if (reds.length === 2 && blacks.length === 1) {
      return [reds[0], blacks[0], reds[1]];
    }
    if (blacks.length === 2 && reds.length === 1) {
      return [blacks[0], reds[0], blacks[1]];
    }
  } else if (cards.length === 4) {
    if (reds.length === 2 && blacks.length === 2) {
      return [reds[0], blacks[0], reds[1], blacks[1]];
    }
    if (reds.length === 3 && blacks.length === 1) {
      return [reds[0], blacks[0], reds[1], reds[2]];
    }
    if (blacks.length === 3 && reds.length === 1) {
      return [blacks[0], reds[0], blacks[1], blacks[2]];
    }
  }

  return cards;
}

// Distance in rank between two cards of same suit (1 = consecutive, 2 = 1-gap)
function getCardRankDistance(c1, c2) {
  if (!c1 || !c2 || c1.suit !== c2.suit) return 999;
  const r1 = getRankNum(c1.rank);
  const r2 = getRankNum(c2.rank);
  let dist = Math.abs(r1 - r2);
  // Ace high check: A(1) and K(13) -> dist 1; A(1) and Q(12) -> dist 2
  if ((c1.rank === 'A' && c2.rank === 'K') || (c2.rank === 'A' && c1.rank === 'K')) dist = 1;
  if ((c1.rank === 'A' && c2.rank === 'Q') || (c2.rank === 'A' && c1.rank === 'Q')) dist = 2;
  return dist;
}

// Compare rank for natural sequential ordering
function isCardHigherRank(a, b) {
  if (a.rank === 'A' && (b.rank === 'K' || b.rank === 'Q')) return true;
  if (b.rank === 'A' && (a.rank === 'K' || a.rank === 'Q')) return false;
  if (a.rank === 'A' && (b.rank === '2' || b.rank === '3')) return false;
  if (b.rank === 'A' && (a.rank === '2' || a.rank === '3')) return true;
  return getRankNum(a.rank) > getRankNum(b.rank);
}

// Rule: GEBI (ገቢ) Detection
// Checks if a card can attach to an existing table meld (extends sequence or completes 4-set).
function isCardGebiToMeld(card, meld, jokerRank, jokerSuits) {
  if (!card || !meld || meld.length < 3) return false;

  const isJk = (c) => isWildJoker(c, jokerRank, jokerSuits);
  const naturals = meld.filter(c => !isJk(c));
  if (naturals.length === 0) return false;

  // 1. Same-rank set of 3 cards (can take 4th card of same rank)
  const isSet = naturals.every(c => (c.isFalseJoker ? jokerRank : c.rank) === (naturals[0].isFalseJoker ? jokerRank : naturals[0].rank));
  if (isSet && meld.length === 3) {
    const setRank = naturals[0].isFalseJoker ? jokerRank : naturals[0].rank;
    const cardRank = card.isFalseJoker ? jokerRank : card.rank;
    if (cardRank === setRank && meld.every(c => c.suit !== card.suit)) {
      return true;
    }
  }

  // 2. Same-suit sequence (can extend on either end)
  const isSeq = naturals.every(c => c.suit === naturals[0].suit);
  if (isSeq) {
    const suit = naturals[0].suit;
    if (card.suit !== suit) return false;

    // Rank numbers with Ace as 1
    const numsAs1 = naturals.map(c => RANK_ORDER[c.rank]).sort((a, b) => a - b);
    const min1 = numsAs1[0];
    const max1 = numsAs1[numsAs1.length - 1];
    const cardNum1 = RANK_ORDER[card.rank];

    if (cardNum1 === min1 - 1 || cardNum1 === max1 + 1) return true;

    // Rank numbers with Ace as 14 (Ace High)
    const numsAs14 = naturals.map(c => (c.rank === 'A' ? 14 : RANK_ORDER[c.rank])).sort((a, b) => a - b);
    const min14 = numsAs14[0];
    const max14 = numsAs14[numsAs14.length - 1];
    const cardNum14 = card.rank === 'A' ? 14 : RANK_ORDER[card.rank];

    if (cardNum14 === min14 - 1 || cardNum14 === max14 + 1) return true;
  }

  return false;
}

function isCardGebiToTable(card, tableMelds, jokerRank, jokerSuits) {
  if (!card || !tableMelds) return false;
  const allGroups = [];
  if (Array.isArray(tableMelds)) {
    allGroups.push(...tableMelds);
  } else {
    for (const key of Object.keys(tableMelds)) {
      if (Array.isArray(tableMelds[key])) {
        allGroups.push(...tableMelds[key]);
      }
    }
  }

  for (const group of allGroups) {
    if (isCardGebiToMeld(card, group, jokerRank, jokerSuits)) {
      return true;
    }
  }
  return false;
}

// Connection score between two cards (Rank pair = 100, Suited consecutive = 80, Suited 1-gap = 50)
function getCardConnectionScore(a, b) {
  if (!a || !b) return 0;
  if (a.rank === b.rank) return 100;
  if (a.suit === b.suit) {
    const d = getCardRankDistance(a, b);
    if (d === 1) return 80;
    if (d === 2) return 50;
  }
  return 0;
}

// General Chaining Algorithm: links pairs and suited sequences into seamless unbroken chains
function buildChainsFromCards(cards) {
  const remaining = new Map(cards.map(c => [c.id, c]));
  const chains = [];

  while (remaining.size > 0) {
    let bestPair = null;
    let bestScore = 0;

    const remList = Array.from(remaining.values());
    for (let i = 0; i < remList.length - 1; i++) {
      for (let j = i + 1; j < remList.length; j++) {
        const s = getCardConnectionScore(remList[i], remList[j]);
        if (s > bestScore) {
          bestScore = s;
          bestPair = [remList[i], remList[j]];
        }
      }
    }

    if (!bestPair || bestScore === 0) {
      break;
    }

    let c1 = bestPair[0];
    let c2 = bestPair[1];
    let currentChain;
    if (c1.suit === c2.suit) {
      currentChain = isCardHigherRank(c2, c1) ? [c1, c2] : [c2, c1];
    } else {
      currentChain = [c1, c2];
    }

    remaining.delete(c1.id);
    remaining.delete(c2.id);

    let extended = true;
    while (extended && remaining.size > 0) {
      extended = false;
      const head = currentChain[0];
      const tail = currentChain[currentChain.length - 1];

      let bestHeadCandidate = null;
      let bestHeadScore = 0;
      let bestTailCandidate = null;
      let bestTailScore = 0;

      for (const cand of remaining.values()) {
        const sHead = getCardConnectionScore(cand, head);
        if (sHead > bestHeadScore) {
          bestHeadScore = sHead;
          bestHeadCandidate = cand;
        }
        const sTail = getCardConnectionScore(tail, cand);
        if (sTail > bestTailScore) {
          bestTailScore = sTail;
          bestTailCandidate = cand;
        }
      }

      if (bestHeadScore > 0 && bestHeadScore >= bestTailScore) {
        currentChain.unshift(bestHeadCandidate);
        remaining.delete(bestHeadCandidate.id);
        extended = true;
      } else if (bestTailScore > 0) {
        currentChain.push(bestTailCandidate);
        remaining.delete(bestTailCandidate.id);
        extended = true;
      }
    }

    // Apply color sandwich if chain is same rank of 3 or 4 cards
    if (currentChain.length >= 3 && currentChain.every(c => c.rank === currentChain[0].rank)) {
      currentChain = orderSameRankSet(currentChain);
    }

    chains.push(currentChain);
  }

  const singles = Array.from(remaining.values());
  singles.sort((a, b) => (a.pointValue || 0) - (b.pointValue || 0));

  return { chains, singles };
}

// Check if a card acts as a Joker (Wild Joker)
function isCardJoker(card, state) {
  if (!card) return false;
  if (card.isFalseJoker) return false; // False joker is NEVER wild! Only substitutes designated rank
  if (card.isJoker && !card.isFalseJoker) return true;
  if (state && state.jokerRank && card.rank === state.jokerRank) {
    if (!state.jokerSuits || state.jokerSuits.includes(card.suit)) return true;
  }
  return false;
}

// -------------------------------------------------------------------------
// PLAYER-CONTROLLED HAND ARRANGEMENT (ተጫዋቹ ራሱ እንዲደርድር)
// 1. Player has full manual control to arrange cards via Drag & Drop or Move Buttons
// 2. Preserves the player's exact manual card order across all server updates
// 3. Optional "✨ ደርድር" button finds and applies the single BEST arrangement
// 4. Any valid Tris (e.g. 5♥ 6♥ 7♥) is kept strictly intact in ascending order
// 5. Seamless visual presentation with NO space between cards (as in reference photo)
// -------------------------------------------------------------------------

let sortToastTimer = null;

function showSortToast(text) {
  let toast = document.getElementById('sortToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'sortToast';
    toast.className = 'sort-toast';
    document.body.appendChild(toast);
  } else if (lobbyView && lobbyView.style.display !== 'none' && !document.body.contains(toast)) {
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.classList.add('show');
  if (sortToastTimer) clearTimeout(sortToastTimer);
  sortToastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

// Preserve the player's manual card order across server state updates
function syncHandPreservingOrder(newHand) {
  if (!newHand || newHand.length === 0) {
    playerOrderedCardIds = [];
    return [];
  }
  if (!playerOrderedCardIds || playerOrderedCardIds.length === 0) {
    playerOrderedCardIds = newHand.map(c => c.id);
    return newHand;
  }

  const newMap = new Map(newHand.map(c => [c.id, c]));
  const preserved = [];

  // 1. Keep existing cards in the player's exact custom arranged order
  for (const id of playerOrderedCardIds) {
    if (newMap.has(id)) {
      preserved.push(newMap.get(id));
      newMap.delete(id);
    }
  }

  // 2. Newly drawn cards append to the end so the player can arrange them
  for (const remaining of newMap.values()) {
    preserved.push(remaining);
  }

  playerOrderedCardIds = preserved.map(c => c.id);
  return preserved;
}

// Seka Hand & Joker Placement Helpers
function isSekaWildJoker(c) {
  if (!c) return false;
  return c.isJoker === true || c.rank === 'JOKER' || c.suit === '🃏';
}

function arrangeSekaMeld(cards) {
  if (!cards || cards.length <= 1) return cards || [];
  const jokers = cards.filter(isSekaWildJoker);
  const natural = cards.filter(c => !isSekaWildJoker(c));
  const rankOrderMap = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };

  if (jokers.length === 0) {
    const hasA = natural.some(c => c.rank === 'A');
    const hasKOrQ = natural.some(c => c.rank === 'K' || c.rank === 'Q');
    const isAceHigh = hasA && hasKOrQ;
    const rankFn = (c) => (isAceHigh && c.rank === 'A' ? 14 : (rankOrderMap[c.rank] || 0));
    return [...natural].sort((a, b) => rankFn(a) - rankFn(b));
  }

  const joker = jokers[0];
  const hasA = natural.some(c => c.rank === 'A');
  const hasKOrQ = natural.some(c => c.rank === 'K' || c.rank === 'Q');
  const isAceHigh = hasA && hasKOrQ;
  const rankFn = (c) => (isAceHigh && c.rank === 'A' ? 14 : (rankOrderMap[c.rank] || 0));
  const sortedNatural = [...natural].sort((a, b) => rankFn(a) - rankFn(b));

  let gapIndex = -1;
  for (let i = 0; i < sortedNatural.length - 1; i++) {
    const diff = rankFn(sortedNatural[i + 1]) - rankFn(sortedNatural[i]);
    if (diff === 2) {
      gapIndex = i;
      break;
    }
  }

  if (gapIndex !== -1) {
    const result = [...sortedNatural];
    result.splice(gapIndex + 1, 0, joker);
    return result;
  }

  const highest = rankFn(sortedNatural[sortedNatural.length - 1]);
  if (highest >= 13) {
    return [joker, ...sortedNatural];
  }

  return [...sortedNatural, joker];
}

function checkValidSekaTris(cards) {
  if (!cards || cards.length !== 3) return false;
  const jokers = cards.filter(isSekaWildJoker);
  const natural = cards.filter(c => !isSekaWildJoker(c));
  if (jokers.length > 1) return false;
  if (natural.length === 0) return false;

  const suit = natural[0].suit;
  if (!natural.every(c => c.suit === suit)) return false;

  const rankOrderMap = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };
  const testSeq = (orderMap) => {
    const nums = natural.map(c => orderMap(c.rank)).sort((a, b) => a - b);
    for (let i = 0; i < nums.length - 1; i++) {
      if (nums[i] === nums[i + 1]) return false;
    }
    const span = nums[nums.length - 1] - nums[0] + 1;
    const missing = span - nums.length;
    return span <= 3 && missing <= jokers.length;
  };
  return testSeq(r => rankOrderMap[r]) || testSeq(r => r === 'A' ? 14 : rankOrderMap[r]);
}

function checkValidSekaQuatris(cards) {
  if (!cards || cards.length !== 4) return false;
  const jokers = cards.filter(isSekaWildJoker);
  const natural = cards.filter(c => !isSekaWildJoker(c));
  if (jokers.length > 1) return false;
  if (natural.length === 0) return false;

  const suit = natural[0].suit;
  if (!natural.every(c => c.suit === suit)) return false;

  const rankOrderMap = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };
  const testSeq = (orderMap) => {
    const nums = natural.map(c => orderMap(c.rank)).sort((a, b) => a - b);
    for (let i = 0; i < nums.length - 1; i++) {
      if (nums[i] === nums[i + 1]) return false;
    }
    const span = nums[nums.length - 1] - nums[0] + 1;
    const missing = span - nums.length;
    return span <= 4 && missing <= jokers.length;
  };
  return testSeq(r => rankOrderMap[r]) || testSeq(r => r === 'A' ? 14 : rankOrderMap[r]);
}

function arrangeSekaHandOptimal(hand) {
  if (!hand || hand.length <= 1) return { arrangedCards: hand || [], isWin: false };

  const jokers = hand.filter(isSekaWildJoker);
  let availableJokers = [...jokers];
  const natural = hand.filter(c => !isSekaWildJoker(c));
  const rankOrderMap = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };

  const suits = ['♠', '♥', '♦', '♣'];
  const bySuit = {};
  suits.forEach(s => bySuit[s] = []);
  natural.forEach(c => {
    if (bySuit[c.suit]) bySuit[c.suit].push(c);
  });

  const arrangedGroups = [];

  for (const s of suits) {
    const suitNatural = bySuit[s];
    const hasA = suitNatural.some(c => c.rank === 'A');
    const hasHigh = suitNatural.some(c => ['K', 'Q', 'J', '10'].includes(c.rank));
    const hasLow = suitNatural.some(c => ['2', '3', '4', '5'].includes(c.rank));
    const isAceHigh = hasA && hasHigh && !hasLow;
    const rankFn = (c) => (isAceHigh && c.rank === 'A' ? 14 : (rankOrderMap[c.rank] || 0));

    const suitCards = suitNatural.sort((a, b) => rankFn(a) - rankFn(b));
    let usedInSuit = new Set();

    // 0. Check natural complete 4-card Quatris sequence FIRST (e.g. J-Q-K-A, 7-8-9-10)
    for (let i = 0; i <= suitCards.length - 4; i++) {
      const quad = suitCards.slice(i, i + 4);
      if (checkValidSekaQuatris(quad) && !quad.some(c => usedInSuit.has(c.id))) {
        arrangedGroups.push(arrangeSekaMeld(quad));
        quad.forEach(c => usedInSuit.add(c.id));
      }
    }
    // Also check Ace-high Quatris wrapping (J-Q-K then A at start of sorted array)
    if (suitCards.length >= 4) {
      const aceCard = suitCards.find(c => c.rank === 'A' && !usedInSuit.has(c.id));
      if (aceCard) {
        const highCards = suitCards.filter(c => !usedInSuit.has(c.id) && ['J', 'Q', 'K'].includes(c.rank));
        if (highCards.length >= 3) {
          const quad = [...highCards.slice(0, 3), aceCard];
          if (checkValidSekaQuatris(quad)) {
            arrangedGroups.push(arrangeSekaMeld(quad));
            quad.forEach(c => usedInSuit.add(c.id));
          }
        }
      }
    }

    // 1. Check natural complete 3-card Tris sequence
    const remForTris = suitCards.filter(c => !usedInSuit.has(c.id));
    for (let i = 0; i <= remForTris.length - 3; i++) {
      const trio = remForTris.slice(i, i + 3);
      if (checkValidSekaTris(trio) && !trio.some(c => usedInSuit.has(c.id))) {
        arrangedGroups.push(arrangeSekaMeld(trio));
        trio.forEach(c => usedInSuit.add(c.id));
      }
    }
    // 1b. Check Ace-high Tris (Q-K-A) that may not be caught by consecutive slicing
    //     because A is sorted first (rank 1) while Q and K are at the end
    if (remForTris.length >= 3) {
      const aceCard = remForTris.find(c => c.rank === 'A' && !usedInSuit.has(c.id));
      if (aceCard) {
        const kCard = remForTris.find(c => c.rank === 'K' && !usedInSuit.has(c.id));
        const qCard = remForTris.find(c => c.rank === 'Q' && !usedInSuit.has(c.id));
        if (kCard && qCard) {
          const aceHighTrio = [qCard, kCard, aceCard];
          if (checkValidSekaTris(aceHighTrio)) {
            arrangedGroups.push(arrangeSekaMeld(aceHighTrio));
            aceHighTrio.forEach(c => usedInSuit.add(c.id));
          }
        }
      }
    }

    // 2. Check 3-card gap with Joker forming Quatris (e.g. J♠ Q♠ 🃏 → J♠ Q♠ 🃏 A♠ style, or 7♦ 8♦ 🃏 10♦)
    if (availableJokers.length > 0) {
      const remForQuatrisJoker = suitCards.filter(c => !usedInSuit.has(c.id));
      for (let i = 0; i < remForQuatrisJoker.length - 2; i++) {
        for (let j = i + 1; j < remForQuatrisJoker.length - 1; j++) {
          for (let k = j + 1; k < remForQuatrisJoker.length; k++) {
            if (availableJokers.length === 0) break;
            const c1 = remForQuatrisJoker[i], c2 = remForQuatrisJoker[j], c3 = remForQuatrisJoker[k];
            if (usedInSuit.has(c1.id) || usedInSuit.has(c2.id) || usedInSuit.has(c3.id)) continue;
            const jk = availableJokers[0];
            if (checkValidSekaQuatris([c1, c2, c3, jk])) {
              arrangedGroups.push(arrangeSekaMeld([c1, c2, c3, jk]));
              usedInSuit.add(c1.id); usedInSuit.add(c2.id); usedInSuit.add(c3.id);
              availableJokers.shift();
            }
          }
        }
      }
    }

    // 3. Check 2-card gap pairs with Joker for Tris (e.g. 5♥ 7♥ → 5♥ Joker 7♥, or 5♥ 6♥ → 5♥ 6♥ Joker)
    if (availableJokers.length > 0) {
      const remSuitCards = suitCards.filter(c => !usedInSuit.has(c.id));
      for (let i = 0; i < remSuitCards.length; i++) {
        for (let j = i + 1; j < remSuitCards.length; j++) {
          if (availableJokers.length === 0) break;
          const c1 = remSuitCards[i];
          const c2 = remSuitCards[j];
          if (usedInSuit.has(c1.id) || usedInSuit.has(c2.id)) continue;

          const jk = availableJokers[0];
          if (checkValidSekaTris([c1, c2, jk])) {
            const arrangedTrio = arrangeSekaMeld([c1, c2, jk]);
            arrangedGroups.push(arrangedTrio);
            usedInSuit.add(c1.id);
            usedInSuit.add(c2.id);
            availableJokers.shift();
          }
        }
      }
    }

    // Remaining natural cards in this suit
    const leftoverSuit = suitCards.filter(c => !usedInSuit.has(c.id));
    if (leftoverSuit.length > 0) {
      arrangedGroups.push(leftoverSuit);
    }
  }

  // If there are still unused jokers: NEVER place them consecutively (ተከታታይ ጆከር ማድረግ አይቻልም)!
  if (availableJokers.length === 1) {
    arrangedGroups.push([availableJokers[0]]);
  } else if (availableJokers.length > 1) {
    // If 2 jokers are unused, separate them so they are never side-by-side
    if (arrangedGroups.length >= 2) {
      arrangedGroups[0].push(availableJokers[0]);
      arrangedGroups[arrangedGroups.length - 1].push(availableJokers[1]);
    } else {
      arrangedGroups.unshift([availableJokers[0]]);
      arrangedGroups.push([availableJokers[1]]);
    }
  }

  return {
    arrangedCards: arrangedGroups.flat(),
    isWin: false
  };
}

// Single "✨ ደርድር" button: finds and applies the ONE single best arrangement (no options/cycling)
smartSortBtn.addEventListener('click', () => {
  if (!currentGameState || !currentGameState.myHand || currentGameState.myHand.length === 0) return;
  playCardSound();

  // If Seka game: sort by suited sequences (ጦር) placing Jokers in exact spots
  if (currentGameState.gameType === 'SEKA') {
    const sekaArranged = arrangeSekaHandOptimal(currentGameState.myHand);
    currentGameState.myHand = sekaArranged.arrangedCards;
    playerOrderedCardIds = sekaArranged.arrangedCards.map(c => c.id);
    renderPlayerHand(currentGameState.myHand);
    return;
  }

  const best = findSingleBestArrangement(currentGameState.myHand, currentGameState);
  currentGameState.myHand = best.arrangedCards;
  playerOrderedCardIds = currentGameState.myHand.map(c => c.id);

  if (best.isConquer) {
    currentGameState._winningMelds = best.meldsCards;
    currentGameState._tetayCardId = best.tetayCard.id;
    selectedCardId = best.tetayCard.id;
    selectedCardsSet.clear();
    selectedCardsSet.add(selectedCardId);
    showSortToast(`👑 ኮንከር! 13ቱ ካርታዎች ተሰርተዋል (ተጣይ: ${best.tetayCard.rank}${best.tetayCard.suit})`);
  } else {
    currentGameState._winningMelds = null;
    currentGameState._tetayCardId = null;
    showSortToast(`✨ ካርታዎችህ በተሻለ ሁኔታ ተደርድረዋል`);
  }

  smartSortBtn.textContent = '✨ ደርድር';
  renderPlayerHand(currentGameState.myHand);
});

// -------------------------------------------------------------
// BEST CONQUER HAND ARRANGER
// Exhaustively searches to find the ONE single best combination:
// - Keeps valid Tris (e.g. 5♥ 6♥ 7♥) 100% intact and sorted in ascending order
// - Maximizes complete melds (13 cards = conquer)
// - Places the worst/highest card at the end as "ተጣይ"
// -------------------------------------------------------------
function findSingleBestArrangement(hand, state) {
  if (!hand || hand.length <= 1) {
    return { arrangedCards: hand || [], meldsCards: [], tetayCard: hand ? hand[0] : null, isConquer: false, meldedCount: 0 };
  }

  const n = hand.length;
  const jokerRank = state ? state.jokerRank : null;
  const jokerSuits = state ? state.jokerSuits : null;
  const candidates = [];

  // 1. All valid Tris (3 cards)
  for (let i = 0; i < n - 2; i++) {
    for (let j = i + 1; j < n - 1; j++) {
      for (let k = j + 1; k < n; k++) {
        const trio = [hand[i], hand[j], hand[k]];
        if (isValidTris(trio, jokerRank, jokerSuits)) {
          let pts = 0;
          trio.forEach(c => { pts += c.pointValue || 0; });
          const isPure = isNaturalMeld(trio);
          candidates.push({
            cards: trio,
            len: 3,
            points: pts,
            isPure,
            key: trio.map(c => c.id).sort().join(',')
          });
        }
      }
    }
  }

  // 2. All valid Quatris (4 cards)
  for (let i = 0; i < n - 3; i++) {
    for (let j = i + 1; j < n - 2; j++) {
      for (let k = j + 1; k < n - 1; k++) {
        for (let l = k + 1; l < n; l++) {
          const quad = [hand[i], hand[j], hand[k], hand[l]];
          if (isValidQuatris(quad, jokerRank, jokerSuits)) {
            let pts = 0;
            quad.forEach(c => { pts += c.pointValue || 0; });
            const isPure = isNaturalMeld(quad);
            candidates.push({
              cards: quad,
              len: 4,
              points: pts,
              isPure,
              key: quad.map(c => c.id).sort().join(',')
            });
          }
        }
      }
    }
  }

  // Backtrack to find the single best disjoint combination of melds
  let bestMelds = [];
  let bestScore = -1;
  let maxMeldedCards = 0;

  function evaluateCombination(currentMelds, usedIds) {
    let totalCards = 0;
    let pureCount = 0;
    let meldPoints = 0;

    for (const m of currentMelds) {
      totalCards += m.len;
      if (m.isPure) pureCount++;
      meldPoints += m.points;
    }

    if (totalCards >= 13) return 1000000 + meldPoints;

    // Heavily reward complete melded cards: 10,000 per card
    let score = totalCards * 10000;

    // Heavily reward pure melds: 50,000 per pure meld!
    // This strictly prioritizes keeping natural runs/sets intact instead of stealing cards for wild jokers!
    score += pureCount * 50000;

    const unmelded = hand.filter(c => !usedIds.has(c.id));

    // Penalty check: Only penalize when a wild card is used in a 3-of-a-kind SET (same rank)
    // and breaks an open-ended suited run, stranding the neighbor alone.
    // NEVER penalize completing a sequence or Quatris (e.g. 1♥ 2♥ [Joker] 4♥)!
    if (totalCards < 13) {
      for (const m of currentMelds) {
        if (!m.isPure && m.len === 3) {
          const nats = m.cards.filter(c => !isCardJoker(c, state));
          const isSetMeld = nats.length >= 2 && nats.every(c => c.rank === nats[0].rank);
          if (isSetMeld) {
            for (const card of m.cards) {
              if (isCardJoker(card, state)) {
                const suitedNeighbor = unmelded.find(u => u.suit === card.suit && getCardRankDistance(u, card) === 1);
                if (suitedNeighbor) {
                  const neighborHasOther = unmelded.some(u => u.id !== suitedNeighbor.id && (u.rank === suitedNeighbor.rank || (u.suit === suitedNeighbor.suit && getCardRankDistance(u, suitedNeighbor) <= 2)));
                  if (!neighborHasOther) {
                    score -= 40000;
                  }
                }
              }
            }
          }
        }
      }
    }

    // Evaluate unmelded opportunities among remaining cards:
    const rankMap = new Map();
    for (const c of unmelded) {
      if (!rankMap.has(c.rank)) rankMap.set(c.rank, []);
      rankMap.get(c.rank).push(c);
    }
    for (const [r, cards] of rankMap.entries()) {
      if (cards.length >= 2) score += 600; // Strong Tris opportunity (Pair of same rank)!
    }

    const suitMap = new Map();
    for (const c of unmelded) {
      if (!suitMap.has(c.suit)) suitMap.set(c.suit, []);
      suitMap.get(c.suit).push(getRankNum(c.rank));
    }
    for (const [s, nums] of suitMap.entries()) {
      nums.sort((a, b) => a - b);
      for (let i = 0; i < nums.length - 1; i++) {
        if (nums[i + 1] === nums[i] + 1) score += 500; // Open-ended consecutive run opportunity!
        else if (nums[i + 1] === nums[i] + 2) score += 250; // Inside straight opportunity!
      }
    }

    score += meldPoints;
    return score;
  }

  function backtrack(startIdx, currentMelds, usedIds, totalCards) {
    const score = evaluateCombination(currentMelds, usedIds);
    if (score > bestScore) {
      bestScore = score;
      maxMeldedCards = totalCards;
      bestMelds = [...currentMelds];
    }

    if (totalCards >= 13) return;

    for (let i = startIdx; i < candidates.length; i++) {
      const cand = candidates[i];
      let overlaps = false;
      for (const c of cand.cards) {
        if (usedIds.has(c.id)) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;

      for (const c of cand.cards) usedIds.add(c.id);
      currentMelds.push(cand);

      backtrack(i + 1, currentMelds, usedIds, totalCards + cand.len);

      currentMelds.pop();
      for (const c of cand.cards) usedIds.delete(c.id);
    }
  }

  backtrack(0, [], new Set(), 0);

  // Format best melds: ensure sequences (like 5♥ 6♥ 7♥) are ordered strictly ascending!
  const usedIds = new Set();
  const meldsCards = [];

  for (const meld of bestMelds) {
    const cards = [...meld.cards];
    if (isNaturalMeld(cards)) {
      if (isSequenceSameSuit(cards)) {
        const hasA = cards.some(c => c.rank === 'A');
        const hasK = cards.some(c => c.rank === 'K');
        const has2 = cards.some(c => c.rank === '2');
        const aceHigh = hasA && hasK && !has2;
        cards.sort((a, b) => getRankNum(a.rank, aceHigh) - getRankNum(b.rank, aceHigh));
      } else {
        const ordered = orderSameRankSet(cards);
        cards.length = 0;
        cards.push(...ordered);
      }
    } else {
      const naturals = cards.filter(c => !isCardJoker(c, state));
      const jokers = cards.filter(c => isCardJoker(c, state));
      const isSeq = naturals.length > 0 && naturals.every(c => c.suit === naturals[0].suit);
      const isSet = naturals.length > 0 && naturals.every(c => c.rank === naturals[0].rank);

      if (isSeq) {
        const hasA = cards.some(c => c.rank === 'A');
        const hasK = cards.some(c => c.rank === 'K');
        const has2 = cards.some(c => c.rank === '2');
        const aceHigh = hasA && hasK && !has2;
        naturals.sort((a, b) => getRankNum(a.rank, aceHigh) - getRankNum(b.rank, aceHigh));

        if (jokers.length === 1 && naturals.length >= 2) {
          // Find if there is any inside gap between adjacent natural cards (e.g. 9 and J -> missing 10!):
          const natNums = naturals.map(c => getRankNum(c.rank, aceHigh));
          let insertIdx = -1;
          for (let i = 0; i < natNums.length - 1; i++) {
            if (natNums[i + 1] === natNums[i] + 2) {
              insertIdx = i + 1;
              break;
            }
          }

          cards.length = 0;
          if (insertIdx !== -1) {
            // Put the Joker exactly in the middle! (e.g. 9, Joker, J, Q)
            cards.push(...naturals.slice(0, insertIdx), jokers[0], ...naturals.slice(insertIdx));
          } else {
            // If no gap, place at end or beginning
            const lastNum = natNums[natNums.length - 1];
            if (lastNum >= 14 || (lastNum === 13 && !aceHigh)) {
              cards.push(jokers[0], ...naturals);
            } else {
              cards.push(...naturals, jokers[0]);
            }
          }
        } else {
          cards.length = 0;
          cards.push(...naturals, ...jokers);
        }
      } else if (isSet) {
        cards.length = 0;
        cards.push(...orderSameRankSet([...naturals, ...jokers]));
      }
    }
    cards.forEach(c => usedIds.add(c.id));
    meldsCards.push(cards);
  }

  let unmelded = hand.filter(c => !usedIds.has(c.id));

  // Connect any unmelded card that extends an existing meld!
  let attachedAny = true;
  while (attachedAny) {
    attachedAny = false;
    for (const group of meldsCards) {
      const naturals = group.filter(c => !isCardJoker(c, state));
      if (naturals.length === 0) continue;

      const isSet = naturals.every(c => c.rank === naturals[0].rank);
      const isSeq = naturals.every(c => c.suit === naturals[0].suit);

      if (isSet) {
        const setRank = naturals[0].rank;
        for (let idx = 0; idx < unmelded.length; idx++) {
          const s = unmelded[idx];
          if (s.rank === setRank) {
            group.push(s);
            const reordered = orderSameRankSet(group);
            group.length = 0;
            group.push(...reordered);
            unmelded.splice(idx, 1);
            attachedAny = true;
            break;
          }
        }
      } else if (isSeq) {
        const suit = naturals[0].suit;
        const hasA = group.some(c => c.rank === 'A');
        const hasK = group.some(c => c.rank === 'K');
        const has2 = group.some(c => c.rank === '2');
        const aceHigh = hasA && hasK && !has2;

        const firstCard = group[0];
        const lastCard = group[group.length - 1];
        const firstNum = getRankNum(firstCard.rank, aceHigh);
        const lastNum = getRankNum(lastCard.rank, aceHigh);

        for (let idx = 0; idx < unmelded.length; idx++) {
          const s = unmelded[idx];
          if (s.suit !== suit) continue;
          const sNum = getRankNum(s.rank, aceHigh);

          if (sNum === lastNum + 1) {
            group.push(s);
            unmelded.splice(idx, 1);
            attachedAny = true;
            break;
          } else if (sNum === firstNum - 1) {
            group.unshift(s);
            unmelded.splice(idx, 1);
            attachedAny = true;
            break;
          } else if (s.rank === 'A' && lastCard.rank === 'K') {
            group.push(s);
            unmelded.splice(idx, 1);
            attachedAny = true;
            break;
          } else if (s.rank === 'A' && firstCard.rank === '2') {
            group.unshift(s);
            unmelded.splice(idx, 1);
            attachedAny = true;
            break;
          }
        }
      }
    }
  }

  // -------------------------------------------------------------
  // GROUPING UNMELDED CARDS (General Chaining / Bridge Graph Algorithm)
  // Seamlessly links pairs and suited sequences into continuous unbroken chains
  // -------------------------------------------------------------
  const { chains, singles } = buildChainsFromCards(unmelded);

  // Unused Jokers placement:
  const unmeldedJokers = [];
  for (let i = singles.length - 1; i >= 0; i--) {
    if (isCardJoker(singles[i], state)) {
      unmeldedJokers.push(singles.splice(i, 1)[0]);
    }
  }

  if (unmeldedJokers.length > 0) {
    if (chains.length > 0) {
      // Put Joker with the highest chain opportunity!
      chains[0].push(...unmeldedJokers);
    } else {
      singles.unshift(...unmeldedJokers);
    }
  }

  // Flatten the arranged cards
  const resultCards = [];
  for (const group of meldsCards) {
    resultCards.push(...group.map(c => ({ ...c, isTetay: false })));
  }
  for (const group of chains) {
    resultCards.push(...group.map(c => ({ ...c, isTetay: false })));
  }
  for (const s of singles) {
    resultCards.push({ ...s, isTetay: false });
  }

  const isConquer = (maxMeldedCards === 13);
  const tetayCard = resultCards[resultCards.length - 1];
  if (isConquer && tetayCard) {
    tetayCard.isTetay = true;
  }

  return {
    arrangedCards: resultCards,
    meldsCards,
    tetayCard,
    isConquer,
    meldedCount: maxMeldedCards
  };
}

// Backward compatibility alias: Optimal Conquer Hand Arranger
function arrangeHandOptimal(hand, state) {
  const best = findSingleBestArrangement(hand, state);
  return best ? best.arrangedCards : (hand || []);
}

// Main Game Renderer
function renderGame(state) {
  const isSeka = state.gameType === 'SEKA';
  const gameModeBadge = document.getElementById('gameModeBadge');
  if (gameModeBadge) {
    gameModeBadge.textContent = isSeka ? '🃏 ሴካ (SEKA)' : '👑 ኮንከር (CONQUER)';
    gameModeBadge.style.borderColor = isSeka ? '#f59e0b' : 'var(--primary-gold)';
    gameModeBadge.style.color = isSeka ? '#f59e0b' : 'var(--primary-gold)';
  }

  tableIdDisplay.textContent = `#${state.roomId.replace('room_', '').replace('bot_', 'BOT-').replace('seka_', 'SEKA-')}`;
  potDisplay.textContent = `POT: ${state.pot} ETB`;
  deckCount.textContent = state.deckCount !== undefined ? state.deckCount : (state.deckCardCount !== undefined ? state.deckCardCount : 0);

  // Turn status
  const isMyTurn = state.isMyTurn !== undefined ? state.isMyTurn : (state.currentTurnPlayerId === userId);
  const oppName = state.opponent ? state.opponent.name : (state.creator && state.creator.id !== userId ? state.creator.name : (state.joiner && state.joiner.id !== userId ? state.joiner.name : 'Waiting...'));
  turnIndicator.textContent = isMyTurn ? 'YOUR TURN' : `${oppName}'s Turn`;
  turnIndicator.style.color = isMyTurn ? '#4ade80' : '#f5b041';

  // Rule 2: Blind Cut Joker modal for Joiner; Waiting modal for Creator (Conquer only)
  if (state.status === 'CUTTING_JOKER' && !isSeka) {
    if (state.joiner && state.joiner.id === userId) {
      cutJokerModal.style.display = 'flex';
      if (waitingJokerModal) waitingJokerModal.style.display = 'none';
    } else {
      cutJokerModal.style.display = 'none';
      if (waitingJokerModal) waitingJokerModal.style.display = 'flex';
    }
  } else {
    cutJokerModal.style.display = 'none';
    if (waitingJokerModal) waitingJokerModal.style.display = 'none';
  }

  // Joker Info Bar (Conquer only)
  if (jokerInfoBar) {
    if (!isSeka && state.jokerRank && state.jokerSuits && state.status === 'PLAYING') {
      jokerInfoBar.style.display = 'flex';
      jokerInfoText.innerHTML = `${state.jokerRank}${state.jokerSuits[0]} & ${state.jokerRank}${state.jokerSuits[1]} ⭐`;
    } else {
      jokerInfoBar.style.display = 'none';
    }
  }

  // Opponent display
  opponentNameDisplay.textContent = oppName;
  const oppCount = state.opponentCardCount !== undefined ? state.opponentCardCount : (state.opponentHandCount || 10);
  opponentCardCount.textContent = oppCount;
  const isInitialDeal = !hasPlayedDealingAnim && state.status === 'PLAYING';
  const isFinished = state.status === 'FINISHED';
  renderOpponentCards(oppCount, isInitialDeal, isFinished, state.winningMelds, state.winningDiscard);

  // Center Field: Base Joker Card (Conquer only)
  const canShowJokerCard = !isSeka && state.status === 'PLAYING' && (state.baseCard || state.jokerCard) && hasPlayedDealingAnim && !isDealingInProgress;
  if (canShowJokerCard) {
    const cardToShow = state.baseCard || state.jokerCard;
    baseJokerCardContainer.style.display = 'block';
    baseJokerCardContainer.innerHTML = createCardHTML(cardToShow, false, true);
  } else {
    baseJokerCardContainer.style.display = 'none';
    baseJokerCardContainer.innerHTML = '';
  }

  // Update Chosen Joker Badge at the "ሳብ" (Deck) location (Conquer only)
  if (deckJokerCallBadge) {
    if (!isSeka && canShowJokerCard && state.jokerRank && state.jokerSuits && state.jokerSuits.length > 0) {
      const choiceMap = {
        'high': 'ከፍ',
        'low': 'ዝቅ',
        'tach': 'ዝቅ',
        'same': 'አንድ ላይ',
        'and_lay': 'አንድ ላይ',
        'gon': 'ጎን',
        'opposite': 'ጎን'
      };
      const choiceLabel = choiceMap[state.jokerChoice] || 'ከፍ';
      const isRed = state.jokerSuits.includes('♥') || state.jokerSuits.includes('♦');
      const suitColor = isRed ? '#ef4444' : '#ffffff';
      const jokersText = `${state.jokerRank}${state.jokerSuits[0]} ${state.jokerRank}${state.jokerSuits[1]}`;

      deckJokerCallBadge.style.display = 'block';
      deckJokerCallBadge.innerHTML = `⭐ <span style="color: ${suitColor}; font-weight: 800;">${jokersText}</span> <span style="color: #f5b041;">(${choiceLabel})</span>`;
    } else {
      deckJokerCallBadge.style.display = 'none';
      deckJokerCallBadge.innerHTML = '';
    }
  }

  // Discard Pile (Meret / Ground)
  const topGroundCard = state.topDiscard || state.topGroundCard;
  if (topGroundCard) {
    const isNewGround = previousGroundCardId !== topGroundCard.id;
    previousGroundCardId = topGroundCard.id;
    const arrivalClass = isNewGround ? 'discard-arrival' : '';
    groundCardContainer.innerHTML = createCardHTML(topGroundCard, false, false, 1, arrivalClass);
  } else {
    groundCardContainer.innerHTML = `<div class="card" style="border: 2px dashed #94a3b8; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 12px;">Empty</div>`;
  }

  // Ground Draw button status: Always clickable on your turn if ground has a card
  const hasGroundCard = !!topGroundCard;
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

  // Rule 8: Poke Status & Timer (Conquer only)
  if (isSeka) {
    pokeTimerBanner.style.display = 'none';
    if (pokeBtn) pokeBtn.style.display = 'none';
    if (weredBtn) weredBtn.style.display = 'none';
    const sWinBtn = document.getElementById('sekaWinBtn');
    if (sWinBtn) {
      sWinBtn.style.display = 'inline-block';
      sWinBtn.disabled = !isMyTurn || state.turnState !== 'AWAITING_DISCARD';
    }
  } else {
    const sWinBtn = document.getElementById('sekaWinBtn');
    if (sWinBtn) sWinBtn.style.display = 'none';
    if (weredBtn) weredBtn.style.display = 'inline-block';
    if (pokeBtn) pokeBtn.style.display = 'inline-block';

    if (state.pokeState && state.pokeState.active) {
      pokeTimerBanner.style.display = 'block';
      pokeSecondsDisplay.textContent = state.pokeState.secondsLeft;
      pokeBtn.disabled = true;
    } else {
      pokeTimerBanner.style.display = 'none';
      if (pokeBtn) pokeBtn.disabled = isMyTurn || state.status !== 'PLAYING';
    }
  }

  // Hand Points Display (Removed from table per authentic game rules)
  if (pointsDisplay) {
    pointsDisplay.textContent = state.points || 0;
  }
  if (groundEligibilityBadge) {
    groundEligibilityBadge.style.display = 'none';
  }

  // Preserve the player's manual card arrangement across state updates
  if (state.status === 'PLAYING' && state.myHand) {
    state.myHand = syncHandPreservingOrder(state.myHand);
    currentGameState.myHand = state.myHand;
  }

  // Render player cards
  renderPlayerHand(state.myHand);

  // Render logs
  if (gameLogsContainer && state.logs && state.logs.length > 0) {
    gameLogsContainer.innerHTML = state.logs.map(l => `<div class="log-entry">${l}</div>`).join('');
  }

  // Render Table Melds (Conquer only)
  if (tableMeldsArea) {
    if (isSeka) {
      tableMeldsArea.style.display = 'none';
    } else {
      renderTableMelds(state);
    }
  }

  // Game Result Modal
  if (state.status === 'FINISHED') {
    if (groundMeldBar) groundMeldBar.style.display = 'none';
    const iWon = state.winner === userId || (state.winner && state.winner.id === userId);
    resultModalTitle.textContent = iWon ? '🏆 YOU WON!' : '❌ DEFEAT!';
    resultModalTitle.style.color = iWon ? '#4ade80' : '#ef4444';
    if (isSeka) {
      resultModalDesc.textContent = iWon
        ? `እንኳን ደስ አለህ! በ 2 ትሪስ + 1 ኳትሪስ ሴካ ጨርሰህ ${state.pot} ETB አሸንፈሃል!`
        : `${state.winner ? state.winner.name : 'ተጋጣሚህ'} በሴካ አሸንፏል!`;
    } else {
      resultModalDesc.textContent = state.winReason || (iWon ? `You conquered and claimed ${state.pot} ETB!` : 'Better luck next time!');
    }

    // Reveal winning cards in modal
    const winningHandDisplay = document.getElementById('winningHandDisplay');
    const winningMeldsList = document.getElementById('winningMeldsList');
    if (winningHandDisplay && winningMeldsList) {
      if (state.winningMelds && state.winningMelds.length > 0) {
        winningHandDisplay.style.display = 'block';
        winningMeldsList.innerHTML = renderWinningMeldsHTML(state.winningMelds, state.winningDiscard);
      } else {
        winningHandDisplay.style.display = 'none';
        winningMeldsList.innerHTML = '';
      }
    }

    gameResultModal.style.display = 'flex';
    if (iWon) playWinSound();
  }
}

// Helper: renders winning melds face-up with clean visual grouping
function renderWinningMeldsHTML(melds, tetayCard) {
  let html = '';
  if (melds && melds.length > 0) {
    melds.forEach((m, idx) => {
      const typeLabel = m.type === 'QUATRIS' ? `ኳትሪስ (${m.cards.length} ካርታ ጦር)` : `ትሪስ ${idx + 1} (${m.cards.length} ካርታ ጦር)`;
      html += `
        <div style="background: rgba(30, 41, 59, 0.85); border: 1px solid #475569; border-radius: 8px; padding: 8px 12px; width: 100%;">
          <div style="font-size: 12px; color: #38bdf8; font-weight: bold; margin-bottom: 6px;">${typeLabel}</div>
          <div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
            ${m.cards.map(c => createCardHTML(c, false, false)).join('')}
          </div>
        </div>
      `;
    });
  }
  if (tetayCard) {
    html += `
      <div style="background: rgba(30, 41, 59, 0.85); border: 1px solid #dc2626; border-radius: 8px; padding: 8px 12px; width: 100%;">
        <div style="font-size: 12px; color: #ef4444; font-weight: bold; margin-bottom: 6px;">ተጣይ (11ኛ ካርታ ወደ መሬት የወረደ)</div>
        <div style="display: flex; gap: 8px; justify-content: center;">
          ${createCardHTML(tetayCard, false, false)}
        </div>
      </div>
    `;
  }
  return html;
}

returnToLobbyBtn.addEventListener('click', () => {
  switchToLobbyView();
});

function renderOpponentCards(count, isInitialDeal = false, isFinished = false, winningMelds = null, winningDiscard = null) {
  // If game is finished and opponent has winning melds, lay them face-up on table!
  if (isFinished && winningMelds && winningMelds.length > 0) {
    let meldCardsHtml = '<div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; align-items: center;">';
    winningMelds.forEach((m, mIdx) => {
      meldCardsHtml += `
        <div style="display: inline-flex; gap: 4px; padding: 4px 6px; background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(245, 158, 11, 0.6); border-radius: 6px;">
          ${m.cards.map(c => createCardHTML(c, false, false)).join('')}
        </div>
      `;
    });
    if (winningDiscard) {
      meldCardsHtml += `
        <div style="display: inline-flex; gap: 4px; padding: 4px 6px; background: rgba(220, 38, 38, 0.25); border: 1px solid #ef4444; border-radius: 6px;" title="ተጣይ">
          ${createCardHTML(winningDiscard, false, false)}
        </div>
      `;
    }
    meldCardsHtml += '</div>';
    opponentCardsContainer.innerHTML = meldCardsHtml;
    return;
  }

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

function getResponsiveFanGeometry(totalCards) {
  const w = window.innerWidth || document.documentElement.clientWidth || 375;
  const count = Math.max(totalCards - 1, 1);
  let maxAngle = 36;
  let spacing = 28;

  if (w <= 375) {
    // iPhone Mini & SE (width <= 375px):
    // 10 card gaps * 20px = 200px + 46px card width = 246px.
    // Leaves > 64px safety margin inside 375px! 100% visible, zero clipping!
    maxAngle = 16;
    spacing = Math.min(21, Math.max(15, Math.floor(220 / count)));
  } else if (w <= 480) {
    // Standard Mobile (376px - 480px)
    maxAngle = 22;
    spacing = Math.min(25, Math.max(17, Math.floor(260 / count)));
  } else if (w <= 768) {
    // Tablets / Large Phones (481px - 768px)
    maxAngle = 28;
    spacing = Math.min(28, Math.max(19, Math.floor(340 / count)));
  } else {
    // Desktop screens
    maxAngle = 36;
    spacing = Math.min(32, Math.max(22, Math.floor(440 / count)));
  }

  return { maxAngle, spacing };
}

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

  // When a card arrives, keep player's manual arrangement and preserve their order
  currentGameState.myHand = hand;

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
    playerCardsContainer.style.display = 'block';

    const total = hand.length;
    const middle = (total - 1) / 2;
    const { maxAngle, spacing } = getResponsiveFanGeometry(total);

    playerCardsContainer.innerHTML = hand.map((card, idx) => {
      const isSelected = selectedCardsSet.has(card.id) || selectedCardsSet.has(String(card.id)) || String(card.id) === String(selectedCardId);
      let animClass = '';
      if (isSingleDraw && idx === hand.length - 1) {
        animClass = 'drawn-anim';
      }
      const angle = middle > 0 ? ((idx - middle) / middle) * maxAngle : 0;
      const offset = (idx - middle) * spacing;
      const fanStyle = `--angle: ${angle.toFixed(1)}deg; --offset: ${offset.toFixed(0)}px;`;

      return createCardHTML(card, isSelected, false, idx + 1, animClass, '', fanStyle);
    }).join('');
  }

  updateTakeGroundButton();
  bindCardInteractions(hand);
}

function updateTakeGroundButton() {
  if (!takeGroundBtn || !currentGameState) return;
  const selectedCards = (currentGameState.myHand || []).filter(c => selectedCardsSet.has(c.id) || selectedCardsSet.has(String(c.id)));

  if (selectedCards.length > 0) {
    takeGroundBtn.textContent = '📥 አውርድና አንሳ';
  } else {
    takeGroundBtn.textContent = '📥 ከመሬት አንሳ';
  }
}

// Deal cards one-by-one face down, then flip to reveal once finished!
function runDealingSequence(hand) {
  isDealingInProgress = true;
  playerCardsContainer.innerHTML = '';
  playerCardsContainer.style.display = 'block';
  meldGroupsContainer.style.display = 'none';

  const total = hand.length;
  const middle = (total - 1) / 2;
  const { maxAngle, spacing } = getResponsiveFanGeometry(total);

  hand.forEach((card, idx) => {
    setTimeout(() => {
      const cardEl = document.createElement('div');
      cardEl.className = 'card face-down dealing-anim';
      cardEl.setAttribute('data-id', card.id);
      const angle = middle > 0 ? ((idx - middle) / middle) * maxAngle : 0;
      const offset = (idx - middle) * spacing;
      cardEl.style.zIndex = idx + 1;
      cardEl.style.setProperty('--angle', `${angle.toFixed(1)}deg`);
      cardEl.style.setProperty('--offset', `${offset.toFixed(0)}px`);
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
      const isFalse = card.isFalseJoker || card.rank === 'FALSE' || card.rank === 'JK';
      const isRed = card.suit === '♥' || card.suit === '♦' || (isFalse && card.color === 'red');
      const colorClass = isRed ? 'red' : 'black';
      const displayRank = isFalse ? 'FALSE' : card.rank;
      const displaySuit = isFalse ? '🃏' : card.suit;
      const falseTextColor = isRed ? '#ef4444' : '#0f172a';
      const cornerRankStyle = isFalse ? `style="font-size: 8px; font-weight: 900; color: ${falseTextColor};"` : '';
      const centerStyle = isFalse ? 'style="font-size: 20px;"' : '';

      let starHTML = '';
      if (isFalse) {
        starHTML = `<div class="card-false-badge ${isRed ? 'red' : 'black'}">FALSE</div>`;
      } else if (card.isMainJoker || card.isJoker) {
        starHTML = `<div class="card-joker-star">⭐</div>`;
      }

      cardEl.className = `card ${colorClass} flip-reveal`;
      cardEl.innerHTML = `
        ${starHTML}
        <div class="card-corner top-left">
          <div class="corner-rank" ${cornerRankStyle}>${displayRank}</div>
          <div class="corner-suit">${isFalse ? '' : displaySuit}</div>
        </div>
        <div class="card-center-suit" ${centerStyle}>${displaySuit}</div>
      `;
      playCardSound();

      // All cards flipped and revealed!
      if (idx === hand.length - 1) {
        setTimeout(() => {
          isDealingInProgress = false;
          renderPlayerHand(hand);
          bindCardInteractions(hand);

          // 27 cards have finished dealing! Now reveal the 28th card (Base Joker Card) and badge!
          if (currentGameState && (currentGameState.baseCard || currentGameState.jokerCard)) {
            const cardToShow = currentGameState.baseCard || currentGameState.jokerCard;
            if (baseJokerCardContainer) {
              baseJokerCardContainer.style.display = 'block';
              baseJokerCardContainer.innerHTML = createCardHTML(cardToShow, false, true);
              baseJokerCardContainer.classList.add('flip-reveal');
            }
            if (deckJokerCallBadge && currentGameState.jokerRank && currentGameState.jokerSuits && currentGameState.jokerSuits.length > 0) {
              const choiceMap = {
                'high': 'ከፍ',
                'low': 'ዝቅ',
                'tach': 'ዝቅ',
                'same': 'አንድ ላይ',
                'and_lay': 'አንድ ላይ',
                'gon': 'ጎን',
                'opposite': 'ጎን'
              };
              const choiceLabel = choiceMap[currentGameState.jokerChoice] || 'ከፍ';
              const isRed = currentGameState.jokerSuits.includes('♥') || currentGameState.jokerSuits.includes('♦');
              const suitColor = isRed ? '#ef4444' : '#ffffff';
              const jokersText = `${currentGameState.jokerRank}${currentGameState.jokerSuits[0]} ${currentGameState.jokerRank}${currentGameState.jokerSuits[1]}`;
              deckJokerCallBadge.style.display = 'block';
              deckJokerCallBadge.innerHTML = `⭐ <span style="color: ${suitColor}; font-weight: 800;">${jokersText}</span> <span style="color: #f5b041;">(${choiceLabel})</span>`;
              deckJokerCallBadge.classList.add('flip-reveal');
            }
            playCardSound();
          }
        }, 200);
      }
    }, idx * 45); // Cascading flip wave
  });
}

let touchDraggedId = null;
let currentTouchOverEl = null;
let touchStartX = 0;
let touchStartY = 0;
let isTouchDragging = false;

function bindCardInteractions(hand) {
  const activeContainer = isGroupViewActive ? meldGroupsContainer : playerCardsContainer;
  const cardElements = activeContainer.querySelectorAll('.card');

  cardElements.forEach(cardEl => {
    cardEl.draggable = true;

    // --- Click / Tap Handler (Selection & Instant Tap-to-Place) ---
    cardEl.addEventListener('click', (e) => {
      if (Date.now() - dragJustEndedTime < 220) return;

      const cId = cardEl.getAttribute('data-id');

      // Meld selection mode (e.g. 41 ground meld bar): multi-select
      if (groundMeldBar && groundMeldBar.style.display !== 'none') {
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
        return;
      }

      // Normal mode: Single-card Tap-to-Place!
      // If Card A is already selected and user taps Card B -> Move Card A to Card B's position!
      if (selectedCardId && String(selectedCardId) !== String(cId) && selectedCardsSet.size === 1) {
        const fromIndex = currentGameState.myHand.findIndex(c => String(c.id) === String(selectedCardId));
        const toIndex = currentGameState.myHand.findIndex(c => String(c.id) === String(cId));
        if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
          const [movedCard] = currentGameState.myHand.splice(fromIndex, 1);
          currentGameState.myHand.splice(toIndex, 0, movedCard);
          playerOrderedCardIds = currentGameState.myHand.map(c => c.id);
          playCardSound();
          showSortToast('📍 ካርታው ወደ አዲሱ ቦታ ተቀይሯል');
          renderPlayerHand(currentGameState.myHand);
          return;
        }
      }

      // Normal selection toggle
      if (selectedCardsSet.has(cId)) {
        selectedCardsSet.delete(cId);
        selectedCardId = null;
      } else {
        selectedCardsSet.clear();
        selectedCardsSet.add(cId);
        selectedCardId = cId;
      }
      playCardSound();
      updateTakeGroundButton();
      renderPlayerHand(currentGameState.myHand);
    });

    // --- Desktop Mouse Drag and Drop ---
    cardEl.addEventListener('dragstart', (e) => {
      draggedCardId = cardEl.getAttribute('data-id');
      cardEl.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedCardId);
    });

    cardEl.addEventListener('dragend', () => {
      cardEl.classList.remove('dragging');
      document.querySelectorAll('.card').forEach(c => c.classList.remove('drag-over'));
      dragJustEndedTime = Date.now();
    });

    cardEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const targetCardId = cardEl.getAttribute('data-id');
      if (draggedCardId && draggedCardId !== targetCardId) {
        cardEl.classList.add('drag-over');
      }
    });

    cardEl.addEventListener('dragleave', () => {
      cardEl.classList.remove('drag-over');
    });

    cardEl.addEventListener('drop', (e) => {
      e.preventDefault();
      cardEl.classList.remove('drag-over');
      dragJustEndedTime = Date.now();
      const targetCardId = cardEl.getAttribute('data-id');
      if (!draggedCardId || draggedCardId === targetCardId) return;

      const fromIndex = currentGameState.myHand.findIndex(c => String(c.id) === String(draggedCardId));
      const toIndex = currentGameState.myHand.findIndex(c => String(c.id) === String(targetCardId));

      if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
        const [movedCard] = currentGameState.myHand.splice(fromIndex, 1);
        currentGameState.myHand.splice(toIndex, 0, movedCard);
        playerOrderedCardIds = currentGameState.myHand.map(c => c.id);
        playCardSound();
        showSortToast('📍 ካርታው ተቀይሯል');
        renderPlayerHand(currentGameState.myHand);
      }
    });

    // --- Mobile Touch Screen Drag and Drop (Ultra Smooth) ---
    cardEl.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      touchDraggedId = cardEl.getAttribute('data-id');
      currentTouchOverEl = null;
      isTouchDragging = false;
    }, { passive: true });

    cardEl.addEventListener('touchmove', (e) => {
      if (!touchDraggedId) return;
      const touch = e.touches[0];
      const dx = touch.clientX - touchStartX;
      const dy = touch.clientY - touchStartY;

      // Start drag only if finger moved more than 8px
      if (Math.hypot(dx, dy) > 8) {
        isTouchDragging = true;
        if (e.cancelable) e.preventDefault(); // Stop screen scrolling while repositioning card
        cardEl.classList.add('dragging');

        const elem = document.elementFromPoint(touch.clientX, touch.clientY);
        const targetCard = elem ? elem.closest('.card') : null;

        if (currentTouchOverEl && currentTouchOverEl !== targetCard) {
          currentTouchOverEl.classList.remove('drag-over');
        }

        if (targetCard && targetCard.getAttribute('data-id') !== touchDraggedId && activeContainer.contains(targetCard)) {
          currentTouchOverEl = targetCard;
          targetCard.classList.add('drag-over');
        } else {
          currentTouchOverEl = null;
        }
      }
    }, { passive: false });

    cardEl.addEventListener('touchend', (e) => {
      cardEl.classList.remove('dragging');
      if (isTouchDragging) {
        dragJustEndedTime = Date.now();
        if (currentTouchOverEl) {
          currentTouchOverEl.classList.remove('drag-over');
          const targetCardId = currentTouchOverEl.getAttribute('data-id');
          if (touchDraggedId && targetCardId && touchDraggedId !== targetCardId) {
            const fromIndex = currentGameState.myHand.findIndex(c => String(c.id) === String(touchDraggedId));
            const toIndex = currentGameState.myHand.findIndex(c => String(c.id) === String(targetCardId));
            if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
              const [movedCard] = currentGameState.myHand.splice(fromIndex, 1);
              currentGameState.myHand.splice(toIndex, 0, movedCard);
              playerOrderedCardIds = currentGameState.myHand.map(c => c.id);
              playCardSound();
              showSortToast('📍 ካርታው ተቀይሯል');
              renderPlayerHand(currentGameState.myHand);
            }
          }
        }
      }
      touchDraggedId = null;
      currentTouchOverEl = null;
      isTouchDragging = false;
    });

    cardEl.addEventListener('touchcancel', () => {
      cardEl.classList.remove('dragging');
      if (currentTouchOverEl) currentTouchOverEl.classList.remove('drag-over');
      touchDraggedId = null;
      currentTouchOverEl = null;
      isTouchDragging = false;
    });
  });
}

function createCardHTML(card, isSelected = false, isBaseJoker = false, zIndex = 1, animClass = '', animDelay = '', extraStyle = '') {
  const isFalse = card.isFalseJoker || card.rank === 'FALSE' || card.rank === 'JK';
  const isSekaWildJoker = (card.isJoker || card.rank === 'JOKER' || card.suit === '🃏') && !isFalse;
  const isRed = card.suit === '♥' || card.suit === '♦' || card.color === 'red' || (isFalse && card.color === 'red');
  const colorClass = isRed ? 'red' : 'black';
  const selectedClass = isSelected ? 'selected' : '';
  const groupStartClass = card.isGroupStart ? 'group-start' : '';
  const delayStyle = animDelay ? `animation-delay: ${animDelay};` : '';

  const displayRank = isFalse ? 'FALSE' : (isSekaWildJoker ? '🃏' : card.rank);
  const displaySuit = isFalse ? '🃏' : (isSekaWildJoker ? 'JOKER' : card.suit);
  const falseTextColor = isRed ? '#ef4444' : '#0f172a';
  const cornerRankStyle = isFalse ? `style="font-size: 8px; font-weight: 900; color: ${falseTextColor};"` : (isSekaWildJoker ? `style="font-size: 11px; font-weight: 900;"` : '');
  const centerStyle = (isFalse || isSekaWildJoker) ? 'style="font-size: 20px;"' : '';

  // Golden Star (⭐) on designated jokers, FALSE badge on printed false jokers, WILD on Seka jokers
  let starHTML = '';
  if (isFalse) {
    starHTML = `<div class="card-false-badge ${isRed ? 'red' : 'black'}">FALSE</div>`;
  } else if (isSekaWildJoker) {
    starHTML = `<div class="card-joker-star" style="font-size: 10px; width: auto; padding: 1px 4px;">🃏 WILD</div>`;
  } else if (card.isMainJoker || card.isJoker) {
    starHTML = `<div class="card-joker-star">⭐</div>`;
  }
  const baseBadge = isBaseJoker ? `<div class="card-base-badge">BASE ⭐</div>` : '';
  const tetayBadge = card.isTetay ? `<div class="card-tetay-badge">ተጣይ 🔻</div>` : '';

  return `
    <div class="card ${colorClass} ${selectedClass} ${groupStartClass} ${animClass}" data-id="${card.id}" style="z-index: ${zIndex}; ${delayStyle} ${extraStyle}">
      ${starHTML}
      ${tetayBadge}
      <div class="card-corner top-left">
        <div class="corner-rank" ${cornerRankStyle}>${displayRank}</div>
        <div class="corner-suit">${isFalse ? '' : (isSekaWildJoker ? '' : displaySuit)}</div>
      </div>
      <div class="card-center-suit" ${centerStyle}>${displaySuit}</div>
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
      myMeldsContainer.innerHTML = myMelds.map((group, mIdx) => `
        <div class="table-meld-group" data-owner="${myId}" data-meld-idx="${mIdx}" title="ካርታ ምረጥና እዚህ ላይ ገቢ አድርግ">
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
      opponentMeldsContainer.innerHTML = oppMelds.map((group, mIdx) => `
        <div class="table-meld-group" data-owner="${oppId}" data-meld-idx="${mIdx}" title="ካርታ ምረጥና እዚህ ላይ ገቢ አድርግ">
          ${group.map(c => createMiniCardHTML(c)).join('')}
        </div>
      `).join('');
    } else {
      opponentMeldsBox.style.display = 'none';
    }
  }

  bindTableMeldClicks();
}

function bindTableMeldClicks() {
  if (!tableMeldsArea) return;
  const allMeldEls = tableMeldsArea.querySelectorAll('.table-meld-group');
  allMeldEls.forEach(el => {
    el.addEventListener('click', () => {
      const targetOwnerId = el.getAttribute('data-owner');
      const meldIndex = parseInt(el.getAttribute('data-meld-idx'), 10);
      const selectedId = selectedCardId || (selectedCardsSet.size === 1 ? Array.from(selectedCardsSet)[0] : null);

      if (!selectedId) {
        showSortToast('👉 መጀመሪያ ከእጅህ ገቢ ማድረግ የምትፈልገውን ካርታ ምረጥ!');
        return;
      }

      if (!currentGameState || currentGameState.currentTurnPlayerId !== userId) {
        showSortToast('⚠️ የአንተ ተራ አይደለም!');
        return;
      }

      const card = currentGameState.myHand?.find(c => c.id === selectedId);
      if (!card) return;

      const melds = currentGameState.tableMelds?.[targetOwnerId];
      const targetMeld = melds?.[meldIndex];
      if (!targetMeld) return;

      // Check for GEBI attachment:
      if (isCardGebiToMeld(card, targetMeld, currentGameState.jokerRank, currentGameState.jokerSuits)) {
        playCardSound();
        socket.emit('attach_gebi_card', {
          roomId: currentRoomId,
          userId,
          targetOwnerId,
          meldIndex,
          cardId: card.id
        });
        selectedCardsSet.clear();
        selectedCardId = null;
        showSortToast(`📥 [ ${card.rank}${card.suit} ] ወደ ሜልዱ ገቢ ተደረገ!`);
        return;
      }

      showSortToast(`⚠️ [ ${card.rank}${card.suit} ] ወደዚህ ሜልድ ገቢ (GEBI) መሆን አይችልም!`);
    });
  });
}

// Mini card for table melds (smaller display)
function createMiniCardHTML(card) {
  const isFalse = card.isFalseJoker || card.rank === 'FALSE' || card.rank === 'JK';
  const isRed = card.suit === '♥' || card.suit === '♦' || (isFalse && card.color === 'red');
  const colorClass = isRed ? 'red' : 'black';

  if (isFalse) {
    const borderColor = isRed ? '#ef4444' : '#64748b';
    const textColor = isRed ? '#ef4444' : '#94a3b8';
    return `
      <div class="mini-card ${colorClass}" style="background: rgba(15, 23, 42, 0.95); border-color: ${borderColor}; min-width: 34px; text-align: center;">
        <span style="font-size: 8px; font-weight: 900; color: ${textColor}; letter-spacing: 0.5px;">FALSE</span>
      </div>
    `;
  }

  const isDesignatedJoker = card.isMainJoker || card.isJoker;
  const jokerBadge = isDesignatedJoker ? '⭐' : '';

  return `
    <div class="mini-card ${colorClass}">
      <span>${card.rank}${card.suit}</span>
      ${jokerBadge ? `<span class="mini-joker-badge">${jokerBadge}</span>` : ''}
    </div>
  `;
}

// Window resize listener to dynamically recalculate card fan geometry across devices
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (currentGameState && currentGameState.myHand && currentGameState.status === 'PLAYING' && !isDealingInProgress) {
      renderPlayerHand(currentGameState.myHand);
    }
  }, 120);
});

