// public/app.js

// Initialize or restore player ID
let userId = localStorage.getItem('conquer_user_id');
if (!userId) {
  userId = 'user_' + Math.floor(1000 + Math.random() * 9000);
  localStorage.setItem('conquer_user_id', userId);
}

function isGenericName(name) {
  if (!name) return true;
  const l = name.trim().toLowerCase();
  return l === 'player' || l.startsWith('player ') || l === 'player1' || l === 'player 1' ||
    l === 'ተጫዋች' || l.startsWith('ተጫዋች') || l.startsWith('user_');
}

let storedName = localStorage.getItem('conquer_user_name') || '';
let userPhone = localStorage.getItem('conquer_user_phone') || '';
let isUserRegistered = localStorage.getItem('conquer_user_registered') === 'true' && Boolean(userPhone);
let playerName = storedName || (isUserRegistered ? 'ተጫዋች' : '');
let currentUserBalance = 0;
let socket = io();
let currentRoomId = null;
let currentGameState = null;
let selectedCardId = null;
let selectedCardsSet = new Set();
let playerOrderedCardIds = [];
let draggedCardId = null;
let dragJustEndedTime = 0;

// -------------------------------------------------------------
// TELEGRAM WEB APP (TMA) INTEGRATION (Zero breaking changes to Auth/System)
// -------------------------------------------------------------
const tgApp = (typeof window !== 'undefined' && window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
if (tgApp) {
  try {
    tgApp.ready();
    tgApp.expand();
    if (typeof tgApp.enableClosingConfirmation === 'function') {
      tgApp.enableClosingConfirmation();
    }
  } catch (e) { }
}

function triggerTgHaptic(type = 'light') {
  if (tgApp && tgApp.HapticFeedback) {
    try {
      if (type === 'light') tgApp.HapticFeedback.impactOccurred('light');
      else if (type === 'medium') tgApp.HapticFeedback.impactOccurred('medium');
      else if (type === 'heavy') tgApp.HapticFeedback.impactOccurred('heavy');
      else if (type === 'success') tgApp.HapticFeedback.notificationOccurred('success');
    } catch (e) { }
  }
}

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
  const btns = [document.getElementById('soundToggleBtn')];
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
  triggerTgHaptic('light');
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
  triggerTgHaptic('medium');
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
  triggerTgHaptic('success');
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
if (soundToggleBtn) soundToggleBtn.addEventListener('click', toggleSound);
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
const gebiBtn = document.getElementById('gebiBtn');
let currentMeldBarMode = 'ground'; // 'ground' or 'wered'

// Leave Game & 1-Minute Return Window Elements
const activeGameReturnBanner = document.getElementById('activeGameReturnBanner');
const returnBannerTableId = document.getElementById('returnBannerTableId');
const returnBannerCountdown = document.getElementById('returnBannerCountdown');
const returnToGameBtn = document.getElementById('returnToGameBtn');
const turnTimerBadge = document.getElementById('turnTimerBadge');
const turnSecondsVal = document.getElementById('turnSecondsVal');
let activeGameReturnRoomId = null;
let returnBannerTimer = null;
let isTemporarilyOut = false;

function showActiveGameReturnBanner(roomId, deadline) {
  activeGameReturnRoomId = roomId;
  if (!activeGameReturnBanner) return;
  if (returnBannerTableId) returnBannerTableId.textContent = '#' + roomId.replace(/^seka_/, '');
  activeGameReturnBanner.style.display = 'block';

  if (returnBannerTimer) clearInterval(returnBannerTimer);
  const targetEnd = deadline || (Date.now() + 60 * 1000);

  function update() {
    const left = Math.min(60, Math.max(0, Math.round((targetEnd - Date.now()) / 1000)));
    if (returnBannerCountdown) returnBannerCountdown.textContent = left + 's';
    if (left <= 0) {
      clearInterval(returnBannerTimer);
      returnBannerTimer = null;
    }
  }
  update();
  returnBannerTimer = setInterval(update, 1000);
}

function hideActiveGameReturnBanner() {
  if (returnBannerTimer) {
    clearInterval(returnBannerTimer);
    returnBannerTimer = null;
  }
  activeGameReturnRoomId = null;
  isTemporarilyOut = false;
  if (activeGameReturnBanner) activeGameReturnBanner.style.display = 'none';
}

if (leaveGameBtn) {
  leaveGameBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!currentRoomId || !currentGameState || currentGameState.status !== 'PLAYING') {
      switchToLobbyView();
      return;
    }

    isTemporarilyOut = true;
    activeGameReturnRoomId = currentRoomId;
    socket.emit('leave_seka_table_temp', { roomId: currentRoomId, userId });
    showActiveGameReturnBanner(currentRoomId, Date.now() + 60 * 1000);
    switchToLobbyView();
    playCardSound();
    showSortToast('🚪 ከጠረጴዛው ወጥተዋል! በ 60s ውስጥ ካልተመለሱ በነባሪ ይሸነፋሉ');
  });
}

if (returnToGameBtn) {
  returnToGameBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (activeGameReturnRoomId) {
      isTemporarilyOut = false;
      socket.emit('return_to_seka_table', { roomId: activeGameReturnRoomId, userId });
      hideActiveGameReturnBanner();
      switchToGameView();
      playCardSound();
      showSortToast('👋 ወደ ጨዋታው ተመልሰዋል!');
    }
  });
}

function updateTurnDisplay(state) {
  const s = state || currentGameState;
  if (!s || !turnIndicator) return;
  if (s.status !== 'PLAYING') {
    turnIndicator.textContent = s.status === 'FINISHED' ? 'የጨዋታ ውጤት' : 'ተራ...';
    if (turnTimerBadge) turnTimerBadge.style.display = 'none';
    return;
  }
  const isMyTurn = s.isMyTurn !== undefined ? s.isMyTurn : (s.currentTurnPlayerId === userId);
  const oppName = s.opponentName || (s.creator && s.creator.id !== userId ? s.creator.name : (s.joiner && s.joiner.id !== userId ? s.joiner.name : 'Opponent'));

  // Real-time second calculation immune to device clock skew (strictly capped at 60s)
  if (!s._clientReceivedAt || s._lastTurnPlayerId !== s.currentTurnPlayerId || s._lastTurnState !== s.turnState) {
    s._clientReceivedAt = Date.now();
    s._serverSecondsLeft = typeof s.turnSecondsLeft === 'number' ? Math.min(60, s.turnSecondsLeft) : 60;
    s._lastTurnPlayerId = s.currentTurnPlayerId;
    s._lastTurnState = s.turnState;
  }

  const elapsed = Math.floor((Date.now() - s._clientReceivedAt) / 1000);
  let sec = Math.max(0, (s._serverSecondsLeft || 60) - elapsed);
  sec = Math.min(60, Math.max(0, sec));

  if (isMyTurn) {
    const actionHint = s.turnState === 'AWAITING_DISCARD' ? '— 1 ካርታ ጣል' : '— ካርታ ሳብ / አንሳ';
    turnIndicator.innerHTML = `🔥 YOUR TURN <span style="font-size: 13px; font-weight: 800; color: #fef08a;">${actionHint}</span> <span style="font-size: 15px; font-weight: 900; color: ${sec <= 15 ? '#ef4444' : '#fef08a'}; margin-left: 6px;">(⏳ ${sec}s)</span>`;
    turnIndicator.style.color = '#4ade80';
  } else {
    turnIndicator.innerHTML = `👤 ${oppName}'s Turn <span style="font-size: 14px; font-weight: 800; color: ${sec <= 15 ? '#ef4444' : '#cbd5e1'}; margin-left: 6px;">(⏳ ${sec}s)</span>`;
    turnIndicator.style.color = '#f5b041';
  }

  if (turnTimerBadge && turnSecondsVal) {
    turnTimerBadge.style.display = 'inline-flex';
    turnSecondsVal.textContent = sec;
    if (sec <= 15) turnTimerBadge.classList.add('urgent');
    else turnTimerBadge.classList.remove('urgent');
  }
}

// Local 1-second interval to keep the turn timer and countdown ticking down smoothly
setInterval(() => {
  if (currentGameState && currentGameState.status === 'PLAYING') {
    updateTurnDisplay(currentGameState);
  }
}, 1000);

// Initial setup
if (playerNameInput) playerNameInput.value = playerName;
if (walletUserDisplay) walletUserDisplay.textContent = playerName;
const sekaDisplayNameVal = document.getElementById('sekaPlayerNameDisplayVal');
if (sekaDisplayNameVal) sekaDisplayNameVal.textContent = playerName || 'ተጫዋች';

// Auth Header Elements (Login, Sign Up & Logout)
const headerLoginBtn = document.getElementById('headerLoginBtn');
const headerSignupBtn = document.getElementById('headerSignupBtn');
const headerLogoutBtn = document.getElementById('headerLogoutBtn');
const userLoggedInArea = document.getElementById('userLoggedInArea');
const userLoggedOutArea = document.getElementById('userLoggedOutArea');

function updateAuthUI() {
  const loggedOutArea = document.getElementById('userLoggedOutArea');
  const loggedArea = document.getElementById('userLoggedInArea');
  const dBtn = document.getElementById('depositBtn');
  if (isUserRegistered) {
    if (loggedOutArea) loggedOutArea.style.display = 'none';
    if (loggedArea) loggedArea.style.display = 'flex';
    if (dBtn) dBtn.style.display = 'inline-flex';
    if (walletUserDisplay) {
      walletUserDisplay.textContent = playerName;
      walletUserDisplay.title = playerName;
    }
  } else {
    if (loggedOutArea) loggedOutArea.style.display = 'flex';
    if (loggedArea) loggedArea.style.display = 'none';
    if (dBtn) dBtn.style.display = 'none';
  }
  if (playerNameInput) playerNameInput.value = playerName;
  const sNameDisp = document.getElementById('sekaPlayerNameDisplayVal');
  if (sNameDisp) sNameDisp.textContent = playerName || 'ተጫዋች';
}

function applyWalletUpdate(wallet) {
  if (!wallet) return;
  const w = (wallet.wallet && typeof wallet.wallet === 'object' && (wallet.wallet.id || wallet.wallet.phone)) ? wallet.wallet : wallet;
  if (w.balance !== undefined) {
    currentUserBalance = Number(w.balance) || 0;
    if (walletBalanceDisplay) {
      walletBalanceDisplay.textContent = `${currentUserBalance.toLocaleString()} ETB`;
    }
  }
  if (w.name) {
    playerName = w.name;
    localStorage.setItem('conquer_user_name', playerName);
  }
  if (w.phone) {
    userPhone = w.phone;
    localStorage.setItem('conquer_user_phone', userPhone);
  }
  if (w.id) {
    userId = w.id;
    localStorage.setItem('conquer_user_id', userId);
  }
  if (userPhone) {
    isUserRegistered = true;
    localStorage.setItem('conquer_user_registered', 'true');
    if (!playerName) {
      playerName = 'ተጫዋች';
      localStorage.setItem('conquer_user_name', playerName);
    }
  }
  const sNameDisp = document.getElementById('sekaPlayerNameDisplayVal');
  if (sNameDisp && playerName) sNameDisp.textContent = playerName;
  if (playerNameInput && playerName) playerNameInput.value = playerName;
  updateAuthUI();
}
updateAuthUI();

if (headerSignupBtn) {
  headerSignupBtn.addEventListener('click', () => {
    openRegistrationModal();
  });
}

if (headerLogoutBtn) {
  headerLogoutBtn.addEventListener('click', () => {
    const ok = confirm('እርግጠኛ ኖት መውጣት (Logout ማድረግ) ይፈልጋሉ?');
    if (!ok) return;

    localStorage.removeItem('conquer_user_registered');
    localStorage.removeItem('conquer_user_name');
    localStorage.removeItem('conquer_user_phone');

    userId = 'user_' + Math.floor(1000 + Math.random() * 9000);
    localStorage.setItem('conquer_user_id', userId);
    playerName = '';
    userPhone = '';
    isUserRegistered = false;

    currentUserBalance = 0;
    if (regNameInput) regNameInput.value = '';
    if (regPhoneInput) regPhoneInput.value = '';
    const sNameDisp = document.getElementById('sekaPlayerNameDisplayVal');
    if (sNameDisp) sNameDisp.textContent = 'ተጫዋች';
    if (walletUserDisplay) walletUserDisplay.textContent = '';
    if (walletBalanceDisplay) walletBalanceDisplay.textContent = '0 ETB';

    updateAuthUI();
    playCardSound();
    showSortToast('👋 በተሳካ ሁኔታ ወጥተዋል (Logged out)። ለመጫወት Sign Up ያድርጉ!');
  });
}

// -------------------------------------------------------------
// USER AUTH (LOGIN & REGISTRATION) MODAL LOGIC
// -------------------------------------------------------------
const registerModal = document.getElementById('registerModal');
const openProfileBtn = document.getElementById('openProfileBtn');
const closeRegModalBtn = document.getElementById('closeRegModalBtn');

const tabBtnLogin = document.getElementById('tabBtnLogin');
const tabBtnRegister = document.getElementById('tabBtnRegister');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');

const loginPhoneInput = document.getElementById('loginPhoneInput');
const loginPassInput = document.getElementById('loginPassInput');
const loginErrorMsg = document.getElementById('loginErrorMsg');
const submitLoginBtn = document.getElementById('submitLoginBtn');
const switchToRegisterLink = document.getElementById('switchToRegisterLink');

const regNameInput = document.getElementById('regNameInput');
const regPhoneInput = document.getElementById('regPhoneInput');
const regPassInput = document.getElementById('regPassInput');
const regConfirmPassInput = document.getElementById('regConfirmPassInput');
const regErrorMsg = document.getElementById('regErrorMsg');
const submitRegBtn = document.getElementById('submitRegBtn');
const switchToLoginLink = document.getElementById('switchToLoginLink');

function setAuthMode(mode) {
  if (loginErrorMsg) loginErrorMsg.style.display = 'none';
  if (regErrorMsg) regErrorMsg.style.display = 'none';

  if (mode === 'login') {
    if (tabBtnLogin) {
      tabBtnLogin.style.background = '#fff';
      tabBtnLogin.style.color = '#0f172a';
      tabBtnLogin.style.boxShadow = '0 2px 6px rgba(0,0,0,0.06)';
    }
    if (tabBtnRegister) {
      tabBtnRegister.style.background = 'transparent';
      tabBtnRegister.style.color = '#64748b';
      tabBtnRegister.style.boxShadow = 'none';
    }
    if (loginForm) loginForm.style.display = 'flex';
    if (registerForm) registerForm.style.display = 'none';
    setTimeout(() => { if (loginPhoneInput) loginPhoneInput.focus(); }, 100);
  } else {
    if (tabBtnRegister) {
      tabBtnRegister.style.background = '#fff';
      tabBtnRegister.style.color = '#0f172a';
      tabBtnRegister.style.boxShadow = '0 2px 6px rgba(0,0,0,0.06)';
    }
    if (tabBtnLogin) {
      tabBtnLogin.style.background = 'transparent';
      tabBtnLogin.style.color = '#64748b';
      tabBtnLogin.style.boxShadow = 'none';
    }
    if (registerForm) registerForm.style.display = 'flex';
    if (loginForm) loginForm.style.display = 'none';
    setTimeout(() => { if (regNameInput) regNameInput.focus(); }, 100);
  }
}

function openLoginModal() {
  if (!registerModal) return;
  setAuthMode('login');
  if (loginPhoneInput && userPhone) loginPhoneInput.value = userPhone;
  if (loginPassInput) loginPassInput.value = '';
  registerModal.style.display = 'flex';
}

function openRegistrationModal() {
  if (!registerModal) return;
  setAuthMode('register');
  const tgUser = (tgApp && tgApp.initDataUnsafe && tgApp.initDataUnsafe.user) ? tgApp.initDataUnsafe.user : null;
  if (regNameInput) regNameInput.value = tgUser ? (tgUser.first_name || '') : '';
  if (regPhoneInput) regPhoneInput.value = userPhone || '';
  if (regPassInput) regPassInput.value = '';
  if (regConfirmPassInput) regConfirmPassInput.value = '';
  registerModal.style.display = 'flex';
}

function closeRegistrationModal() {
  if (!registerModal) return;
  registerModal.style.display = 'none';
}

function requireAuth(actionMessage) {
  if (isUserRegistered && userPhone) {
    if (!playerName) {
      playerName = 'ተጫዋች';
      localStorage.setItem('conquer_user_name', playerName);
    }
    return true;
  }
  if (actionMessage) showSortToast(actionMessage);
  if (userPhone) {
    openLoginModal();
  } else {
    openRegistrationModal();
  }
  return false;
}

if (tabBtnLogin) {
  tabBtnLogin.addEventListener('click', () => setAuthMode('login'));
}
if (tabBtnRegister) {
  tabBtnRegister.addEventListener('click', () => setAuthMode('register'));
}
if (switchToRegisterLink) {
  switchToRegisterLink.addEventListener('click', (e) => {
    e.preventDefault();
    setAuthMode('register');
  });
}
if (switchToLoginLink) {
  switchToLoginLink.addEventListener('click', (e) => {
    e.preventDefault();
    setAuthMode('login');
  });
}

if (headerLoginBtn) {
  headerLoginBtn.addEventListener('click', openLoginModal);
}
if (headerSignupBtn) {
  headerSignupBtn.addEventListener('click', openRegistrationModal);
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

// -------------------------------------------------------------
// 1. LOGIN SUBMIT HANDLER
// -------------------------------------------------------------
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawPhone = (loginPhoneInput ? loginPhoneInput.value : '').trim();
    const rawPass = (loginPassInput ? loginPassInput.value : '').trim();

    // Check for Admin Credentials
    if (rawPhone === 'wondewossenbefikaduabebe' && (rawPass === 'wende3428@D' || rawPass === 'wende3428')) {
      localStorage.setItem('conquer_admin_key', 'wende3428@D');
      localStorage.setItem('conquer_admin_user', 'wondewossenbefikaduabebe');
      showSortToast('🔐 Welcome Admin! ወደ Admin ገጽ እየተዘዋወሩ ነው...');
      setTimeout(() => { window.location.href = '/admin.html'; }, 600);
      return;
    }

    if (!rawPhone) {
      if (loginErrorMsg) {
        loginErrorMsg.textContent = 'እባክዎ ስልክ ቁጥር ያስገቡ';
        loginErrorMsg.style.display = 'block';
      }
      return;
    }

    const cleanPhone = normalizeEthPhone(rawPhone);
    const ethRegex = /^0(9|7)\d{8}$/;
    if (!ethRegex.test(cleanPhone)) {
      if (loginErrorMsg) {
        loginErrorMsg.textContent = 'እባክዎ ትክክለኛ የኢትዮጵያ ስልክ ቁጥር ያስገቡ (ምሳሌ፡ 0912345678)';
        loginErrorMsg.style.display = 'block';
      }
      return;
    }

    if (!rawPass) {
      if (loginErrorMsg) {
        loginErrorMsg.textContent = 'እባክዎ የይለፍ ቃል ያስገቡ';
        loginErrorMsg.style.display = 'block';
      }
      return;
    }

    if (submitLoginBtn) {
      submitLoginBtn.disabled = true;
      submitLoginBtn.textContent = '⏳ በመግባት ላይ...';
    }

    try {
      const res = await fetch('/api/user/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleanPhone, password: rawPass })
      });
      const data = await res.json();
      if (data && data.success) {
        const w = (data.wallet && (data.wallet.id || data.wallet.phone)) ? data.wallet : (data.wallet?.wallet || data.user || data.wallet || {});
        const wId = w.id || data.user?.id;
        const wName = w.name || data.user?.name || 'ተጫዋች';
        const wPhone = w.phone || data.user?.phone || cleanPhone;
        const wBal = w.balance !== undefined ? w.balance : (data.user?.balance !== undefined ? data.user.balance : 1000);

        if (wId) {
          userId = wId;
          localStorage.setItem('conquer_user_id', userId);
        }
        playerName = wName;
        userPhone = wPhone;
        isUserRegistered = true;
        localStorage.setItem('conquer_user_name', playerName);
        localStorage.setItem('conquer_user_phone', userPhone);
        localStorage.setItem('conquer_user_registered', 'true');

        applyWalletUpdate({
          id: userId,
          name: playerName,
          phone: userPhone,
          balance: wBal
        });

        closeRegistrationModal();
        playWinSound();
        showSortToast(`🎉 እንኳን ደህና መጡ ${playerName}!`);
      } else {
        if (loginErrorMsg) {
          loginErrorMsg.textContent = data.message || 'የመግቢያ ስህተት፤ እባክዎ እንደገና ይሞክሩ';
          loginErrorMsg.style.display = 'block';
        }
      }
    } catch (err) {
      if (loginErrorMsg) {
        loginErrorMsg.textContent = 'የኔትወርክ ስህተት ተከስቷል';
        loginErrorMsg.style.display = 'block';
      }
    } finally {
      if (submitLoginBtn) {
        submitLoginBtn.disabled = false;
        submitLoginBtn.textContent = '🔑 ይግቡ (Login)';
      }
    }
  });
}

// -------------------------------------------------------------
// 2. REGISTRATION SUBMIT HANDLER
// -------------------------------------------------------------
if (registerForm) {
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const rawName = (regNameInput ? regNameInput.value : '').trim();
    const rawPhone = (regPhoneInput ? regPhoneInput.value : '').trim();
    const pass = (regPassInput ? regPassInput.value : '').trim();
    const confirmPass = (regConfirmPassInput ? regConfirmPassInput.value : '').trim();

    // Check for Admin Credentials
    if (rawName === 'wondewossenbefikaduabebe' && (pass === 'wende3428@D' || pass === 'wende3428')) {
      localStorage.setItem('conquer_admin_key', 'wende3428@D');
      localStorage.setItem('conquer_admin_user', 'wondewossenbefikaduabebe');
      showSortToast('🔐 Welcome Admin! ወደ Admin ገጽ እየተዘዋወሩ ነው...');
      setTimeout(() => { window.location.href = '/admin.html'; }, 600);
      return;
    }

    // Validation
    if (!rawName || rawName.length < 2) {
      if (regErrorMsg) {
        regErrorMsg.textContent = 'እባክዎ ስምዎን ያስገቡ (ቢያንስ 2 ፊደል)';
        regErrorMsg.style.display = 'block';
      }
      return;
    }
    if (isGenericName(rawName)) {
      if (regErrorMsg) {
        regErrorMsg.textContent = 'እባክዎ ትክክለኛ የራስዎን ስም ያስገቡ (Player ወይም ተጫዋች መጠቀም አይቻልም)';
        regErrorMsg.style.display = 'block';
      }
      return;
    }

    const cleanPhone = normalizeEthPhone(rawPhone);
    const ethRegex = /^0(9|7)\d{8}$/;
    if (!ethRegex.test(cleanPhone)) {
      if (regErrorMsg) {
        regErrorMsg.textContent = 'እባክዎ ትክክለኛ የኢትዮጵያ ስልክ ቁጥር ያስገቡ (ምሳሌ፡ 0912345678)';
        regErrorMsg.style.display = 'block';
      }
      return;
    }

    if (!pass || pass.length < 4) {
      if (regErrorMsg) {
        regErrorMsg.textContent = 'የይለፍ ቃል ቢያንስ 4 ፊደል ወይም ቁጥር መሆን አለበት';
        regErrorMsg.style.display = 'block';
      }
      return;
    }

    if (pass !== confirmPass) {
      if (regErrorMsg) {
        regErrorMsg.textContent = 'የይለፍ ቃሎቹ አይመሳሰሉም (Passwords do not match)!';
        regErrorMsg.style.display = 'block';
      }
      return;
    }

    if (submitRegBtn) {
      submitRegBtn.disabled = true;
      submitRegBtn.textContent = '⏳ በመመዝገብ ላይ...';
    }

    try {
      const res = await fetch('/api/user/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, name: rawName, phone: cleanPhone, password: pass })
      });
      const data = await res.json();
      if (data && data.success && data.wallet) {
        const w = (data.wallet && (data.wallet.id || data.wallet.phone)) ? data.wallet : (data.wallet?.wallet || data.user || data.wallet || {});
        const wId = w.id || userId;
        const wName = w.name || rawName;
        const wPhone = w.phone || cleanPhone;
        const wBal = w.balance !== undefined ? w.balance : 1000;

        userId = wId;
        playerName = wName;
        userPhone = wPhone;
        isUserRegistered = true;
        localStorage.setItem('conquer_user_id', userId);
        localStorage.setItem('conquer_user_name', playerName);
        localStorage.setItem('conquer_user_phone', userPhone);
        localStorage.setItem('conquer_user_registered', 'true');

        applyWalletUpdate({
          id: userId,
          name: playerName,
          phone: userPhone,
          balance: wBal
        });

        closeRegistrationModal();
        playWinSound();
        showSortToast(`🎉 ምዝገባዎ ተሳክቷል! እንኳን ደህና መጡ ${rawName}!`);
      } else {
        if (regErrorMsg) {
          regErrorMsg.textContent = data.message || 'የምዝገባ ስህተት፤ እባክዎ እንደገና ይሞክሩ';
          regErrorMsg.style.display = 'block';
        }
      }
    } catch (err) {
      if (regErrorMsg) {
        regErrorMsg.textContent = 'የኔትወርክ ስህተት ተከስቷል';
        regErrorMsg.style.display = 'block';
      }
    } finally {
      if (submitRegBtn) {
        submitRegBtn.disabled = false;
        submitRegBtn.textContent = '✅ ተመዝገብ (Sign Up)';
      }
    }
  });
}

// Auto-prompt registration or login if not registered
if (!isUserRegistered || !userPhone) {
  setTimeout(() => {
    if (userPhone) {
      openLoginModal();
    } else {
      openRegistrationModal();
    }
  }, 500);
}

if (playerNameInput) {
  playerNameInput.addEventListener('change', () => {
    const val = playerNameInput.value.trim();
    if (val && val.toLowerCase() !== 'player' && !val.toLowerCase().startsWith('player ')) {
      playerName = val;
      localStorage.setItem('conquer_user_name', playerName);
      if (walletUserDisplay) walletUserDisplay.textContent = playerName;
      const sNameDisp = document.getElementById('sekaPlayerNameDisplayVal');
      if (sNameDisp) sNameDisp.textContent = playerName;
      if (userPhone) socket.emit('register_user', { userId, name: playerName, phone: userPhone });
    }
  });
}

// Socket connection
socket.on('connect', () => {
  socket.emit('register_user', { userId, name: playerName, phone: userPhone });
  refreshRoomsList();
  const savedActiveRoom = localStorage.getItem('conquer_active_room_id');
  if (savedActiveRoom && userId) {
    socket.emit('reconnect_active_game', { roomId: savedActiveRoom, userId });
  }
});

// Auto-reconnect response listeners on page refresh
socket.on('seka_reconnect_success', ({ roomId, status }) => {
  currentRoomId = roomId;
  localStorage.setItem('conquer_active_room_id', roomId);
  isTemporarilyOut = false;
  activeGameReturnRoomId = null;
  hideActiveGameReturnBanner();
  if (homeGameSelectView) homeGameSelectView.style.display = 'none';
  if (sekaLobbySection) sekaLobbySection.style.display = 'none';
  if (conquerLobbySection) conquerLobbySection.style.display = 'none';
  if (lobbyView) lobbyView.style.display = 'none';
  switchToGameView();
});

socket.on('conquer_reconnect_success', ({ roomId, status }) => {
  currentRoomId = roomId;
  localStorage.setItem('conquer_active_room_id', roomId);
  isTemporarilyOut = false;
  activeGameReturnRoomId = null;
  hideActiveGameReturnBanner();
  if (homeGameSelectView) homeGameSelectView.style.display = 'none';
  if (sekaLobbySection) sekaLobbySection.style.display = 'none';
  if (conquerLobbySection) conquerLobbySection.style.display = 'none';
  if (lobbyView) lobbyView.style.display = 'none';
  switchToGameView();
});

socket.on('active_room_expired', () => {
  localStorage.removeItem('conquer_active_room_id');
  currentRoomId = null;
  if (homeGameSelectView && (!currentGameState || currentGameState.status !== 'PLAYING')) {
    homeGameSelectView.style.display = 'flex';
  }
});

socket.on('wallet_update', (wallet) => {
  applyWalletUpdate(wallet);
});

socket.on(`wallet_${userId}`, (wallet) => {
  applyWalletUpdate(wallet);
});

// Deposit approved notification
socket.on(`deposit_approved_${userId}`, (data) => {
  showSortToast(`🎉 ${data.amount.toLocaleString()} ETB deposit ተረጋግጧል! ወደ balance ገብቷል!`);
  playWinSound();
  loadPendingDeposits();
});

// Deposit rejected notification
socket.on(`deposit_rejected_${userId}`, (data) => {
  showSortToast(`❌ Deposit ተቀባይነት አላገኘም: ${data.reason || 'ምክንያት አልተገለጸም'}`);
  loadPendingDeposits();
});

socket.on('error_msg', (msg) => {
  showSortToast(`⚠️ ${msg}`);
});

socket.on('room_expired', ({ roomId, message }) => {
  closeWaitingForOpponentModal();
  currentWaitingRoomId = null;
  if (currentRoomId === roomId) currentRoomId = null;
  showSortToast(message || '⏳ በ 60 ሰከንድ ውስጥ ተጋጣሚ ስላልገባ ጨዋታው ተሰርዟል! አሁን አዲስ ጨዋታ መፍጠር ይችላሉ።');
  switchToLobbyView();
  refreshRoomsList();
  refreshSekaRoomsList();
});

socket.on('rooms_updated', () => {
  refreshRoomsList();
  refreshSekaRoomsList();
});

socket.on('player_timed_out', ({ winnerName, loserName, message }) => {
  hideActiveGameReturnBanner();
  showSortToast(message || '⏰ ተጫዋች በ 1 ደቂቃ ውስጥ ካርታ ስላልጣለ ተሸንፏል!');
});

socket.on('player_abandoned', ({ winnerName, loserName, message }) => {
  hideActiveGameReturnBanner();
  showSortToast(message || '❌ ተጫዋች በ 1 ደቂቃ ውስጥ ስላልተመለሰ ተሸንፏል!');
});

socket.on('room_created', ({ roomId }) => {
  currentRoomId = roomId;
  localStorage.setItem('conquer_active_room_id', roomId);
  switchToGameView();
});

// Real-Time Game State Sync (Conquer)
socket.on('game_state', (state) => {
  if (state.roomId !== currentRoomId) {
    playerOrderedCardIds = [];
    currentRoomId = state.roomId;
  }
  if (state.status === 'PLAYING' || state.status === 'WAITING') {
    localStorage.setItem('conquer_active_room_id', state.roomId);
  } else if (state.status === 'FINISHED' || state.status === 'EXPIRED') {
    localStorage.removeItem('conquer_active_room_id');
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
  localStorage.setItem('conquer_active_room_id', roomId);
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
      const expiredRoomId = currentWaitingRoomId;
      closeWaitingForOpponentModal();
      localStorage.removeItem('conquer_active_room_id');
      showSortToast('⏳ በ 60 ሰከንድ ውስጥ ተጋጣሚ ስላልገባ የሴካ ጨዋታው ተሰርዟል! አሁን አዲስ ጨዋታ መፍጠር ይችላሉ።');
      if (expiredRoomId) {
        socket.emit('leave_seka_room', { roomId: expiredRoomId, userId });
      }
      refreshSekaRoomsList();
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
      socket.emit('leave_room', { roomId: currentWaitingRoomId, userId });
    }
    closeWaitingForOpponentModal();
    localStorage.removeItem('conquer_active_room_id');
    currentWaitingRoomId = null;
    currentRoomId = null;
    playCardSound();
    showSortToast('ጠረጴዛው ተሰርዟል፤ አዲስ ጨዋታ መፍጠር ይችላሉ');
    refreshSekaRoomsList();
    refreshRoomsList();
  });
}

// Real-Time Game State Sync (Seka)
socket.on('seka_room_created', ({ roomId, expiresAt, isBot, stakeAmount }) => {
  currentRoomId = roomId;
  localStorage.setItem('conquer_active_room_id', roomId);
  if (isBot) {
    switchToGameView();
  } else {
    currentWaitingRoomId = roomId;
    playCardSound();
    showWaitingForOpponentModal(roomId, expiresAt, stakeAmount);
    refreshSekaRoomsList();
  }
});

socket.on('seka_game_state', (state) => {
  if (state.roomId !== currentRoomId) {
    playerOrderedCardIds = [];
    currentRoomId = state.roomId;
  }
  if (state.status === 'PLAYING' || state.status === 'WAITING') {
    localStorage.setItem('conquer_active_room_id', state.roomId);
  } else if (state.status === 'FINISHED' || state.status === 'EXPIRED') {
    localStorage.removeItem('conquer_active_room_id');
  }

  // Check if player intentionally left the table temporarily via leave button
  const userIsTemporarilyAway = isTemporarilyOut || (activeGameReturnRoomId === state.roomId);

  // The game ONLY starts when status becomes PLAYING!
  if (state.status === 'PLAYING') {
    closeWaitingForOpponentModal();
    if (userIsTemporarilyAway) {
      const deadline = state.temporarilyLeft && state.temporarilyLeft[userId]
        ? state.temporarilyLeft[userId].deadline
        : (Date.now() + 60 * 1000);
      showActiveGameReturnBanner(state.roomId, deadline);
    } else {
      hideActiveGameReturnBanner();
      if (homeGameSelectView) homeGameSelectView.style.display = 'none';
      if (sekaLobbySection) sekaLobbySection.style.display = 'none';
      if (lobbyView) lobbyView.style.display = 'none';
      if (gameView.style.display === 'none') {
        switchToGameView();
      }
    }
  }

  if (state.status === 'FINISHED') {
    isTemporarilyOut = false;
    hideActiveGameReturnBanner();
  }

  if (state.status === 'PLAYING' && state.myHand) {
    state.myHand = syncHandPreservingOrder(state.myHand);
  }
  currentGameState = state;
  renderGame(state);
});

// Game Selector (Home Page: Conquer vs Seka)
let lastLobbyGameType = localStorage.getItem('conquer_last_game_type') || 'SEKA';
const homeGameSelectView = document.getElementById('homeGameSelectView');
const homeConquerBtn = document.getElementById('homeConquerBtn');
const homeSekaBtn = document.getElementById('homeSekaBtn');
const backToHomeBtn = document.getElementById('backToHomeBtn');
const backFromConquerBtn = document.getElementById('backFromConquerBtn');
const sekaLobbySection = document.getElementById('sekaLobbySection');
const conquerLobbySection = document.getElementById('conquerLobbySection');
const createSekaRoomBtn = document.getElementById('createSekaRoomBtn');
const playSekaBotBtn = document.getElementById('playSekaBotBtn');
const conquerComingSoonModal = document.getElementById('conquerComingSoonModal');
const goToSekaFromModalBtn = document.getElementById('goToSekaFromModalBtn');
const closeConquerModalBtn = document.getElementById('closeConquerModalBtn');

// If there's an active room saved in localStorage, suppress home view to prevent flicker while reconnecting
if (localStorage.getItem('conquer_active_room_id')) {
  if (homeGameSelectView) homeGameSelectView.style.display = 'none';
  if (sekaLobbySection) sekaLobbySection.style.display = 'none';
  if (conquerLobbySection) conquerLobbySection.style.display = 'none';
  if (lobbyView) lobbyView.style.display = 'none';
}

if (homeSekaBtn) {
  homeSekaBtn.addEventListener('click', () => {
    playCardSound();
    if (!requireAuth('⚠️ ሴካ ለመጫወት እባክዎ መጀመሪያ ይግቡ ወይም ይመዝገቡ!')) {
      return;
    }
    lastLobbyGameType = 'SEKA';
    localStorage.setItem('conquer_last_game_type', 'SEKA');
    if (homeGameSelectView) homeGameSelectView.style.display = 'none';
    if (conquerLobbySection) conquerLobbySection.style.display = 'none';
    if (sekaLobbySection) sekaLobbySection.style.display = 'block';
    refreshSekaRoomsList();
  });
}

if (homeConquerBtn) {
  homeConquerBtn.addEventListener('click', () => {
    playCardSound();
    if (!requireAuth('⚠️ ኮንከር ለመጫወት እባክዎ መጀመሪያ ይግቡ ወይም ይመዝገቡ!')) {
      return;
    }
    lastLobbyGameType = 'CONQUER';
    localStorage.setItem('conquer_last_game_type', 'CONQUER');
    const cNameDisplay = document.getElementById('conquerPlayerNameDisplayVal');
    if (cNameDisplay) cNameDisplay.textContent = playerName || 'ተጫዋች';
    if (homeGameSelectView) homeGameSelectView.style.display = 'none';
    if (sekaLobbySection) sekaLobbySection.style.display = 'none';
    if (conquerLobbySection) conquerLobbySection.style.display = 'block';
    refreshRoomsList();
  });
}

if (backFromConquerBtn) {
  backFromConquerBtn.addEventListener('click', () => {
    playCardSound();
    if (conquerLobbySection) conquerLobbySection.style.display = 'none';
    if (homeGameSelectView) homeGameSelectView.style.display = 'flex';
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
    if (!requireAuth('⚠️ ሴካ ለመጫወት እባክዎ መጀመሪያ ይግቡ ወይም ይመዝገቡ!')) {
      return;
    }
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

function getSekaStakeAmount() {
  const inputEl = document.getElementById('sekaStakeInput');
  const selectEl = document.getElementById('sekaStakeSelect');
  let val = 10;
  if (inputEl && inputEl.value !== '') {
    val = Number(inputEl.value);
  } else if (selectEl && selectEl.value !== '') {
    val = Number(selectEl.value);
  }
  return isNaN(val) ? 0 : Math.floor(val);
}

// Create Seka Room
let isCreatingSekaRoom = false;
if (createSekaRoomBtn) {
  createSekaRoomBtn.addEventListener('click', () => {
    if (isCreatingSekaRoom) return;
    if (!requireAuth('⚠️ ጨዋታ ለመፍጠር እባክዎ መጀመሪያ ይግቡ ወይም ይመዝገቡ!')) {
      return;
    }
    const stakeAmount = getSekaStakeAmount();
    if (stakeAmount < 5) {
      showSortToast('⚠️ ዝቅተኛው የውርርድ መጠን 5 ብር ነው!');
      const inputEl = document.getElementById('sekaStakeInput');
      if (inputEl) inputEl.focus();
      return;
    }
    const sekaPlayersSelect = document.getElementById('sekaPlayersSelect');

    // Check balance
    if (currentUserBalance < stakeAmount) {
      showSortToast(`⚠️ በቂ balance የለዎትም! ያለዎት ሂሳብ ${currentUserBalance.toLocaleString()} ETB ሲሆን የውርርድ መጠኑ ${stakeAmount.toLocaleString()} ETB ነው። እባክዎ መጀመሪያ Deposit ያድርጉ ወይም አነስ ያለ ውርርድ ይምረጡ።`);
      openDepositModal();
      return;
    }

    const sName = playerName || 'ተጫዋች';
    const maxPlayers = sekaPlayersSelect ? (Number(sekaPlayersSelect.value) === 3 ? 3 : 2) : 2;
    isCreatingSekaRoom = true;
    setTimeout(() => { isCreatingSekaRoom = false; }, 2000);
    playCardSound();
    socket.emit('create_seka_room', { userId, name: sName, stakeAmount, maxPlayers });
  });
}

// Play Seka vs Bot
if (playSekaBotBtn) {
  playSekaBotBtn.addEventListener('click', () => {
    if (!requireAuth('⚠️ ከቦት ጋር ለመጫወት እባክዎ መጀመሪያ ይግቡ ወይም ይመዝገቡ!')) {
      return;
    }
    const stakeAmount = getSekaStakeAmount();
    if (stakeAmount < 5) {
      showSortToast('⚠️ ዝቅተኛው የውርርድ መጠን 5 ብር ነው!');
      const inputEl = document.getElementById('sekaStakeInput');
      if (inputEl) inputEl.focus();
      return;
    }

    // Check balance
    if (currentUserBalance < stakeAmount) {
      showSortToast(`⚠️ በቂ balance የለዎትም! ያለዎት ሂሳብ ${currentUserBalance.toLocaleString()} ETB ሲሆን የውርርድ መጠኑ ${stakeAmount.toLocaleString()} ETB ነው። እባክዎ መጀመሪያ Deposit ያድርጉ ወይም አነስ ያለ ውርርድ ይምረጡ።`);
      openDepositModal();
      return;
    }

    const sName = playerName || 'ተጫዋች';
    playCardSound();
    socket.emit('play_seka_bot', { userId, name: sName, stakeAmount });
  });
}

// -------------------------------------------------------------
// DEPOSIT MODAL LOGIC
// -------------------------------------------------------------
const depositModal = document.getElementById('depositModal');
const closeDepositModalBtn = document.getElementById('closeDepositModalBtn');
const headerBalanceClick = document.getElementById('headerBalanceClick');
const depositModalBalanceDisplay = document.getElementById('depositModalBalanceDisplay');
const depositCustomAmountInput = document.getElementById('depositCustomAmountInput');
const confirmDepositBtn = document.getElementById('confirmDepositBtn');
const depositBtnText = document.getElementById('depositBtnText');
const depositPhoneVal = document.getElementById('depositPhoneVal');
const depositAccountNameVal = document.getElementById('depositAccountNameVal');
const depositInstructions = document.getElementById('depositInstructions');
const depositErrorMsg = document.getElementById('depositErrorMsg');
const depositTxnIdInput = document.getElementById('depositTxnIdInput');
const depositPendingList = document.getElementById('depositPendingList');
const depositPendingItems = document.getElementById('depositPendingItems');

let selectedDepositMethod = 'telebirr';
let selectedDepositAmount = 100;

const DEPOSIT_METHODS = {
  telebirr: {
    name: 'Telebirr',
    phone: '0960995213',
    accountName: 'Wendosen',
    instruction: 'በቴሌብር መተግበሪያ ወደ <strong>0960995213</strong> (Wendosen) ይላኩ። ከዚያ Transaction ID ያስገቡና <strong>«አሁን አስገባ»</strong> ይጫኑ!'
  }
};

function updateDepositUI() {
  const methodInfo = DEPOSIT_METHODS[selectedDepositMethod] || DEPOSIT_METHODS.telebirr;
  if (depositPhoneVal) depositPhoneVal.textContent = methodInfo.phone;
  if (depositAccountNameVal) depositAccountNameVal.textContent = methodInfo.accountName;
  if (depositInstructions) depositInstructions.innerHTML = methodInfo.instruction;
  if (depositBtnText) {
    depositBtnText.textContent = `${selectedDepositAmount.toLocaleString()} ETB አስገባ`;
  }
}

function openDepositModal() {
  if (!depositModal) return;
  if (!requireAuth('⚠️ ገንዘብ ለማስገባት እባክዎ መጀመሪያ ይግቡ ወይም ይመዝገቡ!')) {
    return;
  }
  if (depositModalBalanceDisplay && walletBalanceDisplay) {
    depositModalBalanceDisplay.textContent = walletBalanceDisplay.textContent;
  }
  if (depositErrorMsg) {
    depositErrorMsg.style.display = 'none';
    depositErrorMsg.textContent = '';
  }
  if (depositTxnIdInput) depositTxnIdInput.value = '';
  updateDepositUI();
  loadPendingDeposits();
  depositModal.style.display = 'flex';
}

async function loadPendingDeposits() {
  if (!depositPendingList || !depositPendingItems) return;
  try {
    const res = await fetch(`/api/wallet/deposits/${userId}`);
    const data = await res.json();
    if (data.deposits && data.deposits.length > 0) {
      depositPendingItems.innerHTML = data.deposits.map(d => {
        const statusColors = { PENDING: '#f59e0b', APPROVED: '#10b981', REJECTED: '#ef4444' };
        const statusText = { PENDING: '⏳ በመጠባበቅ', APPROVED: '✅ ተረጋግጧል', REJECTED: '❌ ተቀባይነት አላገኘም' };
        const statusColor = statusColors[d.status] || '#64748b';
        const statusLabel = statusText[d.status] || d.status;
        const date = new Date(d.created_at).toLocaleDateString('am-ET', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        return `<div class="deposit-pending-item" style="border-left: 3px solid ${statusColor};">
          <div class="pending-item-top">
            <span class="pending-amount">${d.amount.toLocaleString()} ETB</span>
            <span class="pending-status" style="color: ${statusColor};">${statusLabel}</span>
          </div>
          <div class="pending-item-bottom">
            <span class="pending-method">${d.method === 'telebirr' ? '📱' : d.method === 'cbebirr' ? '🏦' : '💳'} ${d.method}</span>
            <span class="pending-txn">TXN: ${d.transaction_id}</span>
            <span class="pending-date">${date}</span>
          </div>
        </div>`;
      }).join('');
      depositPendingList.style.display = 'block';
    } else {
      depositPendingList.style.display = 'none';
    }
  } catch (e) {
    depositPendingList.style.display = 'none';
  }
}

function closeDepositModal() {
  if (!depositModal) return;
  depositModal.style.display = 'none';
}

if (depositBtn) {
  depositBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openDepositModal();
  });
}

if (headerBalanceClick) {
  headerBalanceClick.addEventListener('click', () => {
    openDepositModal();
  });
}

if (closeDepositModalBtn) {
  closeDepositModalBtn.addEventListener('click', closeDepositModal);
}

if (depositModal) {
  depositModal.addEventListener('click', (e) => {
    if (e.target === depositModal) {
      closeDepositModal();
    }
  });
}

// Payment method tabs
const depositMethodTabs = document.querySelectorAll('#depositMethodTabs .deposit-tab-btn');
depositMethodTabs.forEach(btn => {
  btn.addEventListener('click', () => {
    depositMethodTabs.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedDepositMethod = btn.getAttribute('data-method') || 'telebirr';
    updateDepositUI();
    playCardSound();
  });
});

// Amount preset buttons
const amountPresetBtns = document.querySelectorAll('#depositAmountPresets .amount-preset-btn');
amountPresetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    amountPresetBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const amt = Number(btn.getAttribute('data-amount')) || 100;
    selectedDepositAmount = amt;
    if (depositCustomAmountInput) depositCustomAmountInput.value = amt;
    updateDepositUI();
    playCardSound();
  });
});

if (depositCustomAmountInput) {
  depositCustomAmountInput.addEventListener('input', () => {
    const amt = Number(depositCustomAmountInput.value) || 0;
    selectedDepositAmount = amt;
    amountPresetBtns.forEach(b => {
      b.classList.toggle('active', Number(b.getAttribute('data-amount')) === amt);
    });
    updateDepositUI();
  });
}

// Copy phone / account number on tap
function copyDepositPhone() {
  const methodInfo = DEPOSIT_METHODS[selectedDepositMethod] || DEPOSIT_METHODS.telebirr;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(methodInfo.phone).then(() => {
      showSortToast(`📋 ${methodInfo.phone} ተኮርጅቷል (Copied)!`);
      const copyBtn = document.getElementById('copyTelebirrBtn');
      if (copyBtn) {
        copyBtn.textContent = '✅ ተኮርጇል';
        setTimeout(() => { copyBtn.textContent = '📋 ኮፒ'; }, 2000);
      }
    }).catch(() => { });
  }
}

if (depositPhoneVal) {
  depositPhoneVal.addEventListener('click', copyDepositPhone);
}

const copyTelebirrBtn = document.getElementById('copyTelebirrBtn');
if (copyTelebirrBtn) {
  copyTelebirrBtn.addEventListener('click', copyDepositPhone);
}

// Paste TXN ID
const pasteTxnBtn = document.getElementById('pasteTxnBtn');
if (pasteTxnBtn && depositTxnIdInput) {
  pasteTxnBtn.addEventListener('click', async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          depositTxnIdInput.value = text.trim();
          showSortToast('📋 Transaction ID ተለጥፏል!');
        }
      }
    } catch (e) {
      depositTxnIdInput.focus();
    }
  });
}

// Submit Deposit
if (confirmDepositBtn) {
  confirmDepositBtn.addEventListener('click', async () => {
    const amt = Number(depositCustomAmountInput ? depositCustomAmountInput.value : selectedDepositAmount) || 0;
    const txnId = depositTxnIdInput ? depositTxnIdInput.value.trim() : '';

    // Validate amount
    if (amt <= 0) {
      if (depositErrorMsg) {
        depositErrorMsg.textContent = 'እባክዎ ከ 0 በላይ የሆነ የገንዘብ መጠን ያስገቡ';
        depositErrorMsg.style.display = 'block';
      }
      return;
    }

    // Validate Transaction ID
    if (!txnId || txnId.length < 4) {
      if (depositErrorMsg) {
        depositErrorMsg.textContent = '⚠️ እባክዎ Transaction ID / የክፍያ ማረጋገጫ ቁጥር ያስገቡ (ቢያንስ 4 ፊደል)';
        depositErrorMsg.style.display = 'block';
      }
      if (depositTxnIdInput) depositTxnIdInput.focus();
      return;
    }

    confirmDepositBtn.disabled = true;
    confirmDepositBtn.textContent = '⏳ በማስገባት ላይ...';

    try {
      const res = await fetch('/api/wallet/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, amount: amt, method: selectedDepositMethod, transactionId: txnId })
      });
      const data = await res.json();
      if (data && data.success) {
        if (data.wallet) {
          applyWalletUpdate(data.wallet);
        }
        playWinSound();
        if (data.status === 'PENDING') {
          showSortToast(`📋 ${amt.toLocaleString()} ETB deposit ጥያቄ ተልኳል! TXN: ${txnId}\nአስተዳዳሪ ሲያረጋግጥ balance ይጨመራል።`);
        } else {
          showSortToast(`🎉 ${amt.toLocaleString()} ETB በ ${DEPOSIT_METHODS[selectedDepositMethod].name} በተሳካ ሁኔታ ገቢ ተደርጓል!`);
        }
        if (depositTxnIdInput) depositTxnIdInput.value = '';
        loadPendingDeposits();
        if (depositModalBalanceDisplay && walletBalanceDisplay) {
          depositModalBalanceDisplay.textContent = walletBalanceDisplay.textContent;
        }
      } else {
        if (depositErrorMsg) {
          depositErrorMsg.textContent = data.message || 'ስህተት ተከስቷል፤ እባክዎ እንደገና ይሞክሩ';
          depositErrorMsg.style.display = 'block';
        }
      }
    } catch (e) {
      if (depositErrorMsg) {
        depositErrorMsg.textContent = 'የኔትወርክ ስህተት ተከስቷል';
        depositErrorMsg.style.display = 'block';
      }
    } finally {
      confirmDepositBtn.disabled = false;
      updateDepositUI();
    }
  });
}

function getConquerStakeAmount() {
  const inputEl = document.getElementById('stakeInput');
  const selectEl = document.getElementById('stakeSelect');
  let val = 10;
  if (inputEl && inputEl.value !== '') {
    val = Number(inputEl.value);
  } else if (selectEl && selectEl.value !== '') {
    val = Number(selectEl.value);
  }
  return isNaN(val) ? 0 : Math.floor(val);
}

// Create Room (Conquer)
if (createRoomBtn) {
  createRoomBtn.addEventListener('click', () => {
    if (!requireAuth('⚠️ ጨዋታ ለመፍጠር እባክዎ መጀመሪያ ይግቡ ወይም ይመዝገቡ!')) {
      return;
    }
    const stakeAmount = getConquerStakeAmount();
    if (stakeAmount < 5) {
      showSortToast('⚠️ ዝቅተኛው የውርርድ መጠን 5 ብር ነው!');
      const inputEl = document.getElementById('stakeInput');
      if (inputEl) inputEl.focus();
      return;
    }
    if (currentUserBalance < stakeAmount) {
      showSortToast(`⚠️ በቂ balance የለዎትም! ያለዎት ሂሳብ ${currentUserBalance.toLocaleString()} ETB ሲሆን የውርርድ መጠኑ ${stakeAmount.toLocaleString()} ETB ነው።`);
      openDepositModal();
      return;
    }
    lastLobbyGameType = 'CONQUER';
    localStorage.setItem('conquer_last_game_type', 'CONQUER');
    playCardSound();
    socket.emit('create_room', { userId, name: playerName || 'ተጫዋች', stakeAmount });
  });
}

// Play Against Bot (Conquer)
if (playBotBtn) {
  playBotBtn.addEventListener('click', () => {
    if (!requireAuth('⚠️ ከቦት ጋር ለመጫወት እባክዎ መጀመሪያ ይግቡ ወይም ይመዝገቡ!')) {
      return;
    }
    const stakeAmount = getConquerStakeAmount();
    if (stakeAmount < 5) {
      showSortToast('⚠️ ዝቅተኛው የውርርድ መጠን 5 ብር ነው!');
      const inputEl = document.getElementById('stakeInput');
      if (inputEl) inputEl.focus();
      return;
    }
    if (currentUserBalance < stakeAmount) {
      showSortToast(`⚠️ በቂ balance የለዎትም! ያለዎት ሂሳብ ${currentUserBalance.toLocaleString()} ETB ሲሆን የውርርድ መጠኑ ${stakeAmount.toLocaleString()} ETB ነው።`);
      openDepositModal();
      return;
    }
    lastLobbyGameType = 'CONQUER';
    localStorage.setItem('conquer_last_game_type', 'CONQUER');
    playCardSound();
    socket.emit('play_vs_bot', { userId, name: playerName || 'ተጫዋች', stakeAmount });
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
          <strong style="color: #0f172a;">${r.creatorName}</strong>
          <div style="font-size: 12px; color: #64748b;">Stake: ${r.stakeAmount} ETB ${r.expiresIn ? `| <span style="color: #059669; font-weight: 700;">⏳ ${r.expiresIn}s ይቀራል</span>` : ''}</div>
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
      sekaContainer.innerHTML = `<p style="color: #64748b; font-size: 14px;">በአሁኑ ሰዓት ክፍት የሴካ ጨዋታ የለም። አዲስ ጨዋታ ለመፍጠር "Create Game" የሚለውን ይጫኑ ወይም ከ AI Bot ጋር ይጫወቱ!</p>`;
      return;
    }
    sekaContainer.innerHTML = rooms.map(r => {
      const isMyRoom = (r.creatorId && r.creatorId === userId) || (r.roomId === currentWaitingRoomId);
      if (isMyRoom) {
        return `
          <div class="room-list-item" style="background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 12px; padding: 12px 16px; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 2px 8px rgba(5, 150, 105, 0.08);">
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <strong style="color: #065f46; font-size: 14px;">🃏 የእርስዎ ጨዋታ (${r.creatorName})</strong>
                <span style="background: #ecfdf5; color: #047857; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 12px; border: 1px solid #a7f3d0;">ተጫዋች በመጠበቅ ላይ...</span>
              </div>
              <div style="font-size: 12px; color: #475569; margin-top: 4px;">
                ውርርድ: <strong>${r.stakeAmount} ETB</strong> | ${r.playersCount || 1}/${r.maxPlayers || 2} ተጫዋቾች 
                ${r.expiresIn !== undefined ? `| <span style="color: #059669; font-weight: 700;">⏳ ${r.expiresIn}s ይቀራል</span>` : ''}
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 13px; color: #059669; font-weight: 700; background: #ffffff; padding: 5px 12px; border-radius: 20px; border: 1px solid #a7f3d0;">⏳ ${r.expiresIn !== undefined ? r.expiresIn + 's' : '60s'}</span>
            </div>
          </div>
        `;
      } else {
        return `
          <div class="room-list-item" style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 16px; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between;">
            <div>
              <strong style="color: #0f172a; font-size: 14px;">🃏 ${r.creatorName}</strong>
              <div style="font-size: 12px; color: #64748b; margin-top: 4px;">
                ውርርድ: <strong>${r.stakeAmount} ETB</strong> | ${r.playersCount || 1}/${r.maxPlayers || 2} ተጫዋቾች 
                ${r.expiresIn !== undefined ? `| <span style="color: #059669; font-weight: 700;">⏳ ${r.expiresIn}s ይቀራል</span>` : ''}
              </div>
            </div>
            <button class="btn-primary" style="width: auto; padding: 7px 16px; font-size: 13px;" onclick="joinSekaRoom('${r.roomId}')">
              ተቀላቀል (Join) →
            </button>
          </div>
        `;
      }
    }).join('');
  } catch (e) { }
}

window.cancelCreatedRoom = function (roomId) {
  socket.emit('leave_seka_room', { roomId, userId });
  socket.emit('leave_room', { roomId, userId });
  localStorage.removeItem('conquer_active_room_id');
  currentWaitingRoomId = null;
  currentRoomId = null;
  playCardSound();
  showSortToast('ጠረጴዛው ተሰርዟል፤ አዲስ ጨዋታ መፍጠር ይችላሉ');
  refreshSekaRoomsList();
  refreshRoomsList();
};

if (!window.sekaRoomsAutoRefresh) {
  window.sekaRoomsAutoRefresh = setInterval(() => {
    const sSec = document.getElementById('sekaLobbySection');
    const lView = document.getElementById('lobbyView');
    if (lView && lView.style.display !== 'none' && sSec && sSec.style.display !== 'none') {
      refreshSekaRoomsList();
    }
  }, 2500);
}

window.joinRoom = function (roomId) {
  if (!requireAuth('⚠️ ጨዋታውን ለመቀላቀል እባክዎ መጀመሪያ ይግቡ ወይም ይመዝገቡ!')) {
    return;
  }
  currentRoomId = roomId;
  localStorage.setItem('conquer_active_room_id', roomId);
  socket.emit('join_room', { roomId, userId, name: playerName });
  switchToGameView();
};

window.joinSekaRoom = function (roomId) {
  if (!requireAuth('⚠️ ጨዋታውን ለመቀላቀል እባክዎ መጀመሪያ ይግቡ ወይም ይመዝገቡ!')) {
    return;
  }
  const sName = playerName || 'ተጫዋች';
  currentRoomId = roomId;
  localStorage.setItem('conquer_active_room_id', roomId);
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
  const sekaTableWinArea = document.getElementById('sekaTableWinArea');
  if (sekaTableWinArea) sekaTableWinArea.style.display = 'none';
  const playerHandFanContainer = document.getElementById('playerHandFanContainer');
  if (playerHandFanContainer) {
    playerHandFanContainer.style.display = 'block';
    playerHandFanContainer.classList.remove('finished-melds-container');
  }
  if (playerCardsContainer) playerCardsContainer.classList.remove('finished-melds');
  if (opponentCardsContainer) opponentCardsContainer.style.display = 'flex';
  const myHandLabelFinished = document.getElementById('myHandLabelFinished');
  if (myHandLabelFinished) myHandLabelFinished.style.display = 'none';
  const discardBtn = document.getElementById('discardBtn');
  if (discardBtn) discardBtn.style.display = 'inline-block';
  lobbyView.style.display = 'none';
  gameView.style.display = 'block';
}

function switchToLobbyView() {
  if (!isTemporarilyOut && (!currentGameState || currentGameState.status !== 'PLAYING')) {
    localStorage.removeItem('conquer_active_room_id');
    currentRoomId = null;
  }
  document.documentElement.classList.remove('in-game');
  document.body.classList.remove('in-game');
  hasPlayedDealingAnim = false;
  isDealingInProgress = false;
  previousHandLength = 0;
  previousOpponentCardCount = 0;
  previousGroundCardId = null;
  playerOrderedCardIds = [];
  const sekaTableWinArea = document.getElementById('sekaTableWinArea');
  if (sekaTableWinArea) sekaTableWinArea.style.display = 'none';
  const playerHandFanContainer = document.getElementById('playerHandFanContainer');
  if (playerHandFanContainer) {
    playerHandFanContainer.style.display = 'block';
    playerHandFanContainer.classList.remove('finished-melds-container');
  }
  if (playerCardsContainer) playerCardsContainer.classList.remove('finished-melds');
  if (opponentCardsContainer) opponentCardsContainer.style.display = 'flex';
  const myHandLabelFinished = document.getElementById('myHandLabelFinished');
  if (myHandLabelFinished) myHandLabelFinished.style.display = 'none';
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
  if (homeGameSelectView) homeGameSelectView.style.display = 'none';
  if (lastLobbyGameType === 'CONQUER') {
    if (sekaLobbySection) sekaLobbySection.style.display = 'none';
    if (conquerLobbySection) conquerLobbySection.style.display = 'block';
  } else {
    if (conquerLobbySection) conquerLobbySection.style.display = 'none';
    if (sekaLobbySection) sekaLobbySection.style.display = 'block';
  }
  cutJokerModal.style.display = 'none';
  if (waitingJokerModal) waitingJokerModal.style.display = 'none';
  closeWaitingForOpponentModal();
  gameResultModal.style.display = 'none';
  const winningHandDisplay = document.getElementById('winningHandDisplay');
  if (winningHandDisplay) winningHandDisplay.style.display = 'none';
  refreshRoomsList();
  refreshSekaRoomsList();
}


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
  const isMyTurn = currentGameState.isMyTurn !== undefined
    ? currentGameState.isMyTurn
    : (currentGameState.currentTurnPlayerId === userId);

  if (!isMyTurn) {
    showSortToast('⚠️ የአንተ ተራ አይደለም! የተጋጣሚህን ተራ ጠብቅ።');
    return;
  }
  if (currentGameState.turnState !== 'AWAITING_DRAW') {
    if (currentGameState.myHand && currentGameState.myHand.length >= 11) {
      showSortToast('⚠️ 11 ካርታ ስላለህ መጀመሪያ 1 ካርታ መሬት ላይ ጣል!');
    } else {
      showSortToast('⚠️ አስቀድመህ ካርታ ስበሃል፤ አሁን 1 ካርታ መሬት ላይ ጣል!');
    }
    return;
  }

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

    const hasAlreadyOpened = currentGameState.tableMelds && currentGameState.tableMelds[userId] && currentGameState.tableMelds[userId].length > 0;
    const isFreeJoker = currentGameState.topGroundCard && (currentGameState.topGroundCard.isJoker || currentGameState.topGroundCard.rank === currentGameState.jokerRank);
    playDrawSound();
    currentGameState.mustMeld41 = (!hasAlreadyOpened && !isFreeJoker);
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

function handleGebiAction() {
  if (!currentGameState || currentGameState.status !== 'PLAYING') return;
  if (currentGameState.currentTurnPlayerId !== userId) {
    return showSortToast('⚠️ የአንተ ተራ አይደለም!');
  }

  const selectedCards = (currentGameState.myHand || []).filter(c =>
    selectedCardsSet.has(String(c.id)) || selectedCardsSet.has(c.id)
  );

  if (selectedCards.length !== 1) {
    return showSortToast('👉 ገቢ ለማድረግ ከእጅህ 1 ካርታ ብቻ ምረጥ!');
  }

  const card = selectedCards[0];
  const tableMelds = currentGameState.tableMelds || {};
  let foundTarget = null;

  for (const ownerId of Object.keys(tableMelds)) {
    const meldsList = tableMelds[ownerId] || [];
    for (let mIdx = 0; mIdx < meldsList.length; mIdx++) {
      if (isCardGebiToMeld(card, meldsList[mIdx], currentGameState.jokerRank, currentGameState.jokerSuits)) {
        foundTarget = { ownerId, meldIndex: mIdx };
        break;
      }
    }
    if (foundTarget) break;
  }

  if (!foundTarget) {
    return showSortToast(`⚠️ [ ${card.rank}${card.suit} ] ጠረጴዛው ላይ ካሉት ሜልዶች ጋር ገቢ መሆን አይችልም!`);
  }

  playCardSound();
  playerOrderedCardIds = playerOrderedCardIds.filter(id => id !== card.id);
  currentGameState.myHand = currentGameState.myHand.filter(c => c.id !== card.id);
  selectedCardsSet.clear();
  selectedCardId = null;
  renderPlayerHand(currentGameState.myHand);

  socket.emit('attach_gebi_card', {
    roomId: currentRoomId,
    userId,
    targetOwnerId: foundTarget.ownerId,
    meldIndex: foundTarget.meldIndex,
    cardId: card.id
  });
  showSortToast(`📥 [ ${card.rank}${card.suit} ] ወደ ሜልዱ ገቢ ተደረገ!`);
}

if (gebiBtn) {
  gebiBtn.addEventListener('click', handleGebiAction);
}

// Live update points and hint in Ground Meld Bar as cards are selected
function updateGroundMeldBar() {
  if (!groundMeldBar || groundMeldBar.style.display === 'none') return;
  if (!currentGameState || !currentGameState.myHand) return;

  const selectedCards = currentGameState.myHand.filter(c => selectedCardsSet.has(c.id) || selectedCardsSet.has(String(c.id)));
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
  const selectedCards = currentGameState.myHand.filter(c => selectedCardsSet.has(c.id) || selectedCardsSet.has(String(c.id)));
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
  if (currentGameState && currentGameState.status === 'FINISHED' && currentGameState.remainingDeckCards && currentGameState.remainingDeckCards.length > 0) {
    e.stopPropagation();
    openRemainingDeckModal(currentGameState.remainingDeckCards);
    return;
  }
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
  if (selectedCardsSet.size > 1) {
    showSortToast('⚠️ መሬት ለመጣል 1 ካርታ ብቻ ይምረጡ!');
    return;
  }
  const cardObj = currentGameState.myHand?.find(c => c.id === cardToDiscard);
  const isLastCardWin = currentGameState.myHand && currentGameState.myHand.length === 1;

  // Rule: GEBI (ገቢ) Restriction on Discarding (exempt final winning 14th discard!)
  if (!isLastCardWin && cardObj && isCardGebiToTable(cardObj, currentGameState.tableMelds, currentGameState.jokerRank, currentGameState.jokerSuits)) {
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
    if (currentGameState.currentTurnPlayerId !== userId) {
      showSortToast('⚠️ የአንተ ተራ አይደለም!');
      return;
    }
    if (currentGameState.turnState !== 'AWAITING_DISCARD') {
      showSortToast('⚠️ ለማሸነፍ መጀመሪያ 1 ካርታ አንሳ!');
      return;
    }

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
    // Keep cards in their natural dealt order (scattered / unorganized)
    // The player uses "✨ ደርድር" to sort them when desired!
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

  const hasA = natural.some(c => c.rank === 'A');
  const hasHigh = natural.some(c => ['K', 'Q', 'J'].includes(c.rank));
  const hasLow = natural.some(c => ['2', '3', '4', '5'].includes(c.rank));

  if (jokers.length === 0) {
    // Ace-bridge: both high (10/J/Q/K) and low (2/3/4/5) exist with Ace -> natural run [10, J, Q, K, A, 2, 3]
    if (hasA && hasHigh && hasLow) {
      const highCards = natural.filter(c => ['10', 'J', 'Q', 'K'].includes(c.rank)).sort((a, b) => (rankOrderMap[a.rank] || 0) - (rankOrderMap[b.rank] || 0));
      const aCards = natural.filter(c => c.rank === 'A');
      const lowCards = natural.filter(c => !['10', 'J', 'Q', 'K', 'A'].includes(c.rank)).sort((a, b) => (rankOrderMap[a.rank] || 0) - (rankOrderMap[b.rank] || 0));
      return [...highCards, ...aCards, ...lowCards];
    }

    const isAceHigh = hasA && hasHigh && !hasLow;
    const rankFn = (c) => (isAceHigh && c.rank === 'A' ? 14 : (rankOrderMap[c.rank] || 0));
    return [...natural].sort((a, b) => rankFn(a) - rankFn(b));
  }

  const joker = jokers[0];
  if (hasA && hasHigh && hasLow) {
    const highCards = natural.filter(c => ['10', 'J', 'Q', 'K'].includes(c.rank)).sort((a, b) => (rankOrderMap[a.rank] || 0) - (rankOrderMap[b.rank] || 0));
    const aCards = natural.filter(c => c.rank === 'A');
    const lowCards = natural.filter(c => !['10', 'J', 'Q', 'K', 'A'].includes(c.rank)).sort((a, b) => (rankOrderMap[a.rank] || 0) - (rankOrderMap[b.rank] || 0));
    const baseSeq = [...highCards, ...aCards, ...lowCards];
    const getDist = (r1, r2) => {
      const n1 = rankOrderMap[r1] || 0;
      const n2 = rankOrderMap[r2] || 0;
      const direct = Math.abs(n1 - n2);
      const c1 = Math.abs((n1 === 1 ? 14 : n1) - (n2 === 1 ? 14 : n2));
      return Math.min(direct, c1);
    };
    let gapIdx = -1;
    for (let i = 0; i < baseSeq.length - 1; i++) {
      if (getDist(baseSeq[i].rank, baseSeq[i + 1].rank) === 2) {
        gapIdx = i;
        break;
      }
    }
    if (gapIdx !== -1) {
      const res = [...baseSeq];
      res.splice(gapIdx + 1, 0, joker);
      return res;
    }
    return [...baseSeq, joker];
  }

  const isAceHigh = hasA && hasHigh && !hasLow;
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

function partition10CardsIntoSekaMeldsClient(cards) {
  if (!cards || cards.length !== 10) return { valid: false };

  function getCombinations(arr, k) {
    const result = [];
    function backtrack(start, current) {
      if (current.length === k) {
        result.push([...current]);
        return;
      }
      for (let i = start; i < arr.length; i++) {
        current.push(arr[i]);
        backtrack(i + 1, current);
        current.pop();
      }
    }
    backtrack(0, []);
    return result;
  }

  const indices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const quatrisCombos = getCombinations(indices, 4);

  for (const qIdx of quatrisCombos) {
    const qSet = new Set(qIdx);
    const quatrisCards = qIdx.map(i => cards[i]);
    if (!checkValidSekaQuatris(quatrisCards)) continue;

    const remIndices = indices.filter(i => !qSet.has(i));
    const trisCombos = getCombinations(remIndices, 3);

    for (const t1Idx of trisCombos) {
      const t1Set = new Set(t1Idx);
      const t2Idx = remIndices.filter(i => !t1Set.has(i));

      const tris1Cards = t1Idx.map(i => cards[i]);
      const tris2Cards = t2Idx.map(i => cards[i]);

      if (checkValidSekaTris(tris1Cards) && checkValidSekaTris(tris2Cards)) {
        return {
          valid: true,
          quatris: arrangeSekaMeld(quatrisCards),
          tris1: arrangeSekaMeld(tris1Cards),
          tris2: arrangeSekaMeld(tris2Cards)
        };
      }
    }
  }
  return { valid: false };
}

function arrangeSekaHandOptimal(hand) {
  if (!hand || hand.length <= 1) return { arrangedCards: hand || [], isWin: false };

  // 1. Check if winning 10-card or 11-card hand
  if (hand.length === 10) {
    const p10 = partition10CardsIntoSekaMeldsClient(hand);
    if (p10.valid) {
      return {
        arrangedCards: [...p10.quatris, ...p10.tris1, ...p10.tris2],
        isWin: true
      };
    }
  } else if (hand.length === 11) {
    for (let i = 0; i < hand.length; i++) {
      const candidateDiscard = hand[i];
      const remaining10 = hand.filter((_, idx) => idx !== i);
      const p10 = partition10CardsIntoSekaMeldsClient(remaining10);
      if (p10.valid) {
        return {
          arrangedCards: [...p10.quatris, ...p10.tris1, ...p10.tris2, candidateDiscard],
          isWin: true,
          tetayCard: candidateDiscard
        };
      }
    }
  }

  // 2. Arrangement during gameplay (melds -> connected pairs -> same suit -> lone singles at far right)
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

  const quatrisGroups = [];
  const trisGroups = [];
  const pairGroups = [];
  const sameSuitGroups = [];
  const singleCards = [];
  const usedIds = new Set();
  const suitCardsMap = {};

  function getSekaRankDistLocal(r1, r2) {
    const n1 = rankOrderMap[r1] || 0;
    const n2 = rankOrderMap[r2] || 0;
    const direct = Math.abs(n1 - n2);
    const circular1 = Math.abs((n1 === 1 ? 14 : n1) - (n2 === 1 ? 14 : n2));
    const circular2 = Math.abs(n1 - (n2 === 1 ? 14 : n2));
    const circular3 = Math.abs((n1 === 1 ? 14 : n1) - n2);
    return Math.min(direct, circular1, circular2, circular3);
  }

  // Phase 1: Check natural runs & melds in each suit
  for (const s of suits) {
    const suitNatural = bySuit[s];
    if (suitNatural.length === 0) continue;

    // Standard ascending order for natural meld checks
    const rankFn = (c) => (c.rank === 'A' ? 1 : (rankOrderMap[c.rank] || 0));
    let suitCards = [...suitNatural].sort((a, b) => rankFn(a) - rankFn(b));

    // 0a. Check 6-card natural run FIRST: produces TWO TRIS! (e.g. 1-2-3-4-5-6 or 3-4-5-6-7-8)
    for (let i = 0; i <= suitCards.length - 6; i++) {
      const run6 = suitCards.slice(i, i + 6);
      const trio1 = run6.slice(0, 3);
      const trio2 = run6.slice(3, 6);
      if (checkValidSekaTris(trio1) && checkValidSekaTris(trio2) && !run6.some(c => usedIds.has(c.id))) {
        trisGroups.push(arrangeSekaMeld(trio1));
        trisGroups.push(arrangeSekaMeld(trio2));
        run6.forEach(c => usedIds.add(c.id));
      }
    }

    // 0b. Check natural complete 4-card Quatris sequence (e.g. J-Q-K-A, 7-8-9-10)
    const remForQuat = suitCards.filter(c => !usedIds.has(c.id));
    for (let i = 0; i <= remForQuat.length - 4; i++) {
      const quad = remForQuat.slice(i, i + 4);
      if (checkValidSekaQuatris(quad) && !quad.some(c => usedIds.has(c.id))) {
        quatrisGroups.push(arrangeSekaMeld(quad));
        quad.forEach(c => usedIds.add(c.id));
      }
    }
    // Also check Ace-high Quatris wrapping (J-Q-K then A at start of sorted array)
    const remAceHighQuat = suitCards.filter(c => !usedIds.has(c.id));
    if (remAceHighQuat.length >= 4) {
      const aceCard = remAceHighQuat.find(c => c.rank === 'A' && !usedIds.has(c.id));
      if (aceCard) {
        const highCards = remAceHighQuat.filter(c => !usedIds.has(c.id) && ['J', 'Q', 'K'].includes(c.rank));
        if (highCards.length >= 3) {
          const quad = [...highCards.slice(0, 3), aceCard];
          if (checkValidSekaQuatris(quad)) {
            quatrisGroups.push(arrangeSekaMeld(quad));
            quad.forEach(c => usedIds.add(c.id));
          }
        }
      }
    }

    // 1. Check natural complete 3-card Tris in this suit
    const remForTris = suitCards.filter(c => !usedIds.has(c.id));
    for (let i = 0; i <= remForTris.length - 3; i++) {
      const trio = remForTris.slice(i, i + 3);
      if (checkValidSekaTris(trio) && !trio.some(c => usedIds.has(c.id))) {
        trisGroups.push(arrangeSekaMeld(trio));
        trio.forEach(c => usedIds.add(c.id));
      }
    }
    // 1b. Check Ace-high Tris (Q-K-A)
    const remAceHigh = suitCards.filter(c => !usedIds.has(c.id));
    if (remAceHigh.length >= 3) {
      const aceCard = remAceHigh.find(c => c.rank === 'A');
      const kCard = remAceHigh.find(c => c.rank === 'K');
      const qCard = remAceHigh.find(c => c.rank === 'Q');
      if (aceCard && kCard && qCard) {
        const aceHighTrio = [qCard, kCard, aceCard];
        if (checkValidSekaTris(aceHighTrio)) {
          trisGroups.push(arrangeSekaMeld(aceHighTrio));
          aceHighTrio.forEach(c => usedIds.add(c.id));
        }
      }
    }

    // Now re-sort remaining unmelded cards with Ace-bridge or Ace-High
    const remAfterNatural = suitCards.filter(c => !usedIds.has(c.id));
    const hasA = remAfterNatural.some(c => c.rank === 'A');
    const hasHighToAce = remAfterNatural.some(c => ['Q', 'K'].includes(c.rank));
    const hasLowFromAce = remAfterNatural.some(c => ['2', '3', '4'].includes(c.rank));
    if (hasA && hasHighToAce && hasLowFromAce) {
      // Ace-bridge: High -> Ace -> Low -> other mid
      const highCards = remAfterNatural.filter(c => ['10', 'J', 'Q', 'K'].includes(c.rank)).sort((a, b) => (rankOrderMap[a.rank] - rankOrderMap[b.rank]));
      const aCards = remAfterNatural.filter(c => c.rank === 'A');
      const lowCards = remAfterNatural.filter(c => ['2', '3', '4'].includes(c.rank)).sort((a, b) => (rankOrderMap[a.rank] - rankOrderMap[b.rank]));
      const otherMidCards = remAfterNatural.filter(c => !['10', 'J', 'Q', 'K', 'A', '2', '3', '4'].includes(c.rank)).sort((a, b) => (rankOrderMap[a.rank] - rankOrderMap[b.rank]));
      suitCardsMap[s] = [...highCards, ...aCards, ...lowCards, ...otherMidCards];
    } else if (hasA && hasHighToAce && !hasLowFromAce) {
      // Ace-High: sort with Ace as 14 so it stays adjacent to high cards (e.g. J, Q, A or 10, J, Q, A)
      const rankHighFn = (c) => (c.rank === 'A' ? 14 : (rankOrderMap[c.rank] || 0));
      suitCardsMap[s] = [...remAfterNatural].sort((a, b) => rankHighFn(a) - rankHighFn(b));
    } else {
      suitCardsMap[s] = remAfterNatural;
    }
  }

  // Phase 2: Check 3-card gap with Joker forming Quatris across ALL suits FIRST!
  // (Takes absolute priority over using Joker for 2-card Tris in any suit, e.g. 1♦, 3♦, 4♦ + JK)
  if (availableJokers.length > 0) {
    for (const s of suits) {
      const suitCards = suitCardsMap[s] || [];
      const remForQuatrisJk = suitCards.filter(c => !usedIds.has(c.id));
      for (let i = 0; i < remForQuatrisJk.length - 2; i++) {
        for (let j = i + 1; j < remForQuatrisJk.length - 1; j++) {
          for (let k = j + 1; k < remForQuatrisJk.length; k++) {
            if (availableJokers.length === 0) break;
            const c1 = remForQuatrisJk[i], c2 = remForQuatrisJk[j], c3 = remForQuatrisJk[k];
            if (usedIds.has(c1.id) || usedIds.has(c2.id) || usedIds.has(c3.id)) continue;
            const jk = availableJokers[0];
            if (checkValidSekaQuatris([c1, c2, c3, jk])) {
              quatrisGroups.push(arrangeSekaMeld([c1, c2, c3, jk]));
              usedIds.add(c1.id); usedIds.add(c2.id); usedIds.add(c3.id);
              availableJokers.shift();
            }
          }
        }
      }
    }
  }

  // Phase 3: Check 2-card gap pairs with Joker for Tris across ALL suits
  if (availableJokers.length > 0) {
    for (const s of suits) {
      const suitCards = suitCardsMap[s] || [];
      const remSuitCards = suitCards.filter(c => !usedIds.has(c.id));
      for (let i = 0; i < remSuitCards.length; i++) {
        for (let j = i + 1; j < remSuitCards.length; j++) {
          if (availableJokers.length === 0) break;
          const c1 = remSuitCards[i];
          const c2 = remSuitCards[j];
          if (usedIds.has(c1.id) || usedIds.has(c2.id)) continue;

          const jk = availableJokers[0];
          if (checkValidSekaTris([c1, c2, jk])) {
            const arrangedTrio = arrangeSekaMeld([c1, c2, jk]);
            trisGroups.push(arrangedTrio);
            usedIds.add(c1.id); usedIds.add(c2.id);
            availableJokers.shift();
          }
        }
      }
    }
  }

  // Phase 4: Promote Tris to Quatris ONLY if 4th card forms a valid Seka Quatris!
  for (const s of suits) {
    const suitCards = suitCardsMap[s] || [];
    const remForQuatPromote = suitCards.filter(c => !usedIds.has(c.id));
    const suitTris = trisGroups.filter(m => m.some(c => c.suit === s && !isSekaWildJoker(c)));
    for (const remCard of remForQuatPromote) {
      if (usedIds.has(remCard.id)) continue;
      for (let t = 0; t < suitTris.length; t++) {
        const meld = suitTris[t];
        if (meld.length === 3 && checkValidSekaQuatris([...meld, remCard])) {
          const quat = arrangeSekaMeld([...meld, remCard]);
          quatrisGroups.push(quat);
          const idx = trisGroups.indexOf(meld);
          if (idx !== -1) trisGroups.splice(idx, 1);
          suitTris.splice(t, 1);
          usedIds.add(remCard.id);
          break;
        }
      }
    }
  }

  // Phase 5: Cluster remaining cards per suit using circular proximity (dist <= 2)
  for (const s of suits) {
    const suitCards = suitCardsMap[s] || [];
    const remSuit = suitCards.filter(c => !usedIds.has(c.id));
    if (remSuit.length > 0) {
      let currentCluster = [remSuit[0]];
      for (let i = 1; i < remSuit.length; i++) {
        const prev = remSuit[i - 1];
        const curr = remSuit[i];
        const dist = getSekaRankDistLocal(prev.rank, curr.rank);
        if (dist <= 2) {
          currentCluster.push(curr);
        } else {
          if (currentCluster.length >= 2) {
            sameSuitGroups.push(currentCluster);
          } else {
            singleCards.push(currentCluster[0]);
          }
          currentCluster = [curr];
        }
      }
      if (currentCluster.length >= 2) {
        sameSuitGroups.push(currentCluster);
      } else {
        singleCards.push(currentCluster[0]);
      }
      remSuit.forEach(c => usedIds.add(c.id));
    }
  }

  const SUIT_ORDER = { '♠': 1, '♥': 2, '♦': 3, '♣': 4 };

  // Sort Quatris groups deterministically by suit order
  quatrisGroups.sort((a, b) => {
    const sA = (a.find(c => !isSekaWildJoker(c)) || {}).suit;
    const sB = (b.find(c => !isSekaWildJoker(c)) || {}).suit;
    return (SUIT_ORDER[sA] || 99) - (SUIT_ORDER[sB] || 99);
  });

  // Sort Tris groups deterministically by suit order
  trisGroups.sort((a, b) => {
    const sA = (a.find(c => !isSekaWildJoker(c)) || {}).suit;
    const sB = (b.find(c => !isSekaWildJoker(c)) || {}).suit;
    return (SUIT_ORDER[sA] || 99) - (SUIT_ORDER[sB] || 99);
  });

  // Prioritize same-suit close clusters deterministically:
  // 1. Larger clusters first (e.g. 3 cards before 2 cards)
  // 2. Fixed suit order (♠ -> ♥ -> ♦ -> ♣)
  // 3. Lowest rank in cluster
  sameSuitGroups.sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    const sA = a[0] ? a[0].suit : '';
    const sB = b[0] ? b[0].suit : '';
    const suitDiff = (SUIT_ORDER[sA] || 99) - (SUIT_ORDER[sB] || 99);
    if (suitDiff !== 0) return suitDiff;
    const rA = rankOrderMap[a[0].rank] || 0;
    const rB = rankOrderMap[b[0].rank] || 0;
    return rA - rB;
  });

  // Sort singles deterministically by suit order, then rank
  singleCards.sort((a, b) => {
    const suitDiff = (SUIT_ORDER[a.suit] || 99) - (SUIT_ORDER[b.suit] || 99);
    if (suitDiff !== 0) return suitDiff;
    return (rankOrderMap[a.rank] || 0) - (rankOrderMap[b.rank] || 0);
  });

  // Assemble arranged cards:
  // Melds come FIRST (Quatris then Tris).
  // Any same-suit neighbor cards/clusters stay immediately adjacent to that suit's melds!
  const arrangedCards = [];
  const meldsToPlace = [...quatrisGroups, ...trisGroups];
  const placedClusterIdxs = new Set();
  const placedSingleIds = new Set();

  for (const meld of meldsToPlace) {
    let meldCards = [...meld];
    const meldNat = meld.find(c => !isSekaWildJoker(c));
    if (meldNat) {
      const meldSuit = meldNat.suit;
      // Check if any close single of this same suit connects directly (dist <= 1, e.g. K connects to A)
      for (let i = 0; i < singleCards.length; i++) {
        const sc = singleCards[i];
        if (!placedSingleIds.has(sc.id) && sc.suit === meldSuit) {
          const meldNats = meldCards.filter(c => !isSekaWildJoker(c));
          if (meldNats.some(c => getSekaRankDistLocal(c.rank, sc.rank) <= 2)) {
            meldCards = arrangeSekaMeld([...meldCards, sc]);
            placedSingleIds.add(sc.id);
          }
        }
      }
      arrangedCards.push(...meldCards);

      // Place any same-suit cluster (e.g. 5♠ 6♠ or 8♠ 9♠ pair) right next to this meld
      for (let i = 0; i < sameSuitGroups.length; i++) {
        if (!placedClusterIdxs.has(i) && sameSuitGroups[i].some(c => c.suit === meldSuit)) {
          arrangedCards.push(...sameSuitGroups[i]);
          placedClusterIdxs.add(i);
        }
      }
    } else {
      arrangedCards.push(...meldCards);
    }
  }

  // Append remaining same-suit clusters that don't belong to an existing meld
  for (let i = 0; i < sameSuitGroups.length; i++) {
    if (!placedClusterIdxs.has(i)) {
      arrangedCards.push(...sameSuitGroups[i]);
    }
  }

  // Any unused Jokers
  const unusedJokers = [...availableJokers];
  arrangedCards.push(...unusedJokers);

  // Append remaining isolated distant singles
  for (const sc of singleCards) {
    if (!placedSingleIds.has(sc.id)) {
      arrangedCards.push(sc);
    }
  }

  return {
    arrangedCards,
    isWin: false
  };
}

// Single "✨ ደርድር" button: finds and applies the ONE single best arrangement (no options/cycling)
smartSortBtn.addEventListener('click', () => {
  if (!currentGameState || !currentGameState.myHand || currentGameState.myHand.length === 0) return;
  playCardSound();

  // If Seka game: sort by suited sequences placing Jokers in exact spots (ኳትሪስ ➔ ትሪስ 1 ➔ ትሪስ 2)
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
  currentGameState._winningMelds = null;
  currentGameState._tetayCardId = null;

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
  const isMyTurn = state.isMyTurn !== undefined ? state.isMyTurn : (state.currentTurnPlayerId === userId);
  const gameModeBadge = document.getElementById('gameModeBadge');
  if (gameModeBadge) {
    gameModeBadge.textContent = '';
  }

  tableIdDisplay.textContent = '';
  if (potDisplay) {
    potDisplay.textContent = `💰 ደራሽ: ${state.pot || 0} ETB`;
    potDisplay.style.display = 'inline-flex';
  }
  const deckCnt = state.deckCount !== undefined ? state.deckCount : (state.deckCardCount !== undefined ? state.deckCardCount : 0);
  if (deckCount) {
    deckCount.textContent = deckCnt;
  }
  const remainingDeckDisplay = document.getElementById('remainingDeckDisplay');
  const stockDeckTopCard = document.getElementById('stockDeckTopCard');
  const stockDeckSlotLabel = document.getElementById('stockDeckSlotLabel');
  if (state.status !== 'FINISHED') {
    if (remainingDeckDisplay) remainingDeckDisplay.style.display = 'none';
    if (stockDeckTopCard) stockDeckTopCard.style.display = 'flex';
    if (stockDeckSlotLabel) stockDeckSlotLabel.textContent = 'ዴክ (Deck)';
  }

  // Turn status with live countdown
  updateTurnDisplay(state);

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
  const oppName = state.opponentName || (state.creator && state.creator.id !== userId ? state.creator.name : (state.joiner && state.joiner.id !== userId ? state.joiner.name : 'Opponent'));
  opponentNameDisplay.textContent = oppName;
  const oppCount = state.opponentCardCount !== undefined ? state.opponentCardCount : (state.opponentHandCount || 10);
  opponentCardCount.textContent = oppCount;
  const isInitialDeal = !hasPlayedDealingAnim && state.status === 'PLAYING';
  const isFinished = state.status === 'FINISHED';
  renderOpponentCards(oppCount, isInitialDeal);

  // Center Field: Base Joker Card (Conquer only)
  const canShowJokerCard = !isSeka && state.status === 'PLAYING' && (state.baseCard || state.jokerCard);
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
      const suitColor = isRed ? '#dc2626' : '#0f172a';
      const jokersText = `${state.jokerRank}${state.jokerSuits[0]} ${state.jokerRank}${state.jokerSuits[1]}`;

      deckJokerCallBadge.style.display = 'block';
      deckJokerCallBadge.innerHTML = `⭐ <strong>ጆከር:</strong> <span style="color: ${suitColor}; font-weight: 900; background: #ffffff; padding: 1px 6px; border-radius: 6px; margin: 0 3px;">${jokersText}</span> <span style="color: #fef08a; font-weight: 700;">(${choiceLabel})</span>`;
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
    if (gebiBtn) gebiBtn.style.display = 'none';
    const dBtn = document.getElementById('discardBtn');
    if (dBtn) dBtn.style.display = 'inline-block';
    const sWinBtn = document.getElementById('sekaWinBtn');
    if (sWinBtn) {
      sWinBtn.style.display = 'inline-block';
      sWinBtn.disabled = !isMyTurn || state.turnState !== 'AWAITING_DISCARD';
    }
  } else {
    const sWinBtn = document.getElementById('sekaWinBtn');
    if (sWinBtn) sWinBtn.style.display = 'none';
    const dBtn = document.getElementById('discardBtn');
    if (dBtn) dBtn.style.display = 'inline-block';
    if (weredBtn) weredBtn.style.display = 'inline-block';
    if (gebiBtn) gebiBtn.style.display = 'inline-block';
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

  // Turn Timer Badge
  if (turnTimerBadge && turnSecondsVal) {
    if (state.status === 'PLAYING') {
      turnTimerBadge.style.display = 'inline-flex';
      const sLeft = state.turnSecondsLeft !== undefined ? state.turnSecondsLeft : 60;
      turnSecondsVal.textContent = sLeft;
      if (sLeft <= 15) {
        turnTimerBadge.classList.add('urgent');
      } else {
        turnTimerBadge.classList.remove('urgent');
      }
    } else {
      turnTimerBadge.style.display = 'none';
    }
  }

  const statusLobbyBtn = document.getElementById('statusLobbyBtn');
  if (statusLobbyBtn && state.status !== 'FINISHED') {
    statusLobbyBtn.style.display = 'none';
  }
  const myHandLabelFinished = document.getElementById('myHandLabelFinished');
  if (myHandLabelFinished && state.status !== 'FINISHED') {
    myHandLabelFinished.style.display = 'none';
  }

  // Manage return banner
  if (state.status === 'FINISHED') {
    hideActiveGameReturnBanner();
  } else if (state.status === 'PLAYING' && gameView && gameView.style.display !== 'none') {
    hideActiveGameReturnBanner();
  }

  // Game Result Handling
  if (state.status === 'FINISHED') {
    if (turnTimerBadge) turnTimerBadge.style.display = 'none';
    if (groundMeldBar) groundMeldBar.style.display = 'none';
    const iWon = state.winner === userId || (state.winner && state.winner.id === userId);

    // NEVER show pop-up modal!
    if (gameResultModal) gameResultModal.style.display = 'none';

    // Show result clearly in status bar without blocking the table
    if (turnIndicator) {
      const winnerName = state.winner ? (state.winner.name || state.winner) : (iWon ? (playerName || 'ተጫዋች') : 'ተጋጣሚ');
      if (state.winReason === 'TIMEOUT_FORFEIT') {
        turnIndicator.textContent = iWon ? '🏆 ተጋጣሚ በ 1 ደቂቃ ውስጥ ካርታ ስላልጣለ አሸነፍክ!' : `⏰ የጊዜ ገደብ አለቀ (አሸናፊ፦ ${winnerName})`;
        turnIndicator.style.color = iWon ? '#4ade80' : '#fbbf24';
      } else if (state.winReason === 'ABANDON_FORFEIT') {
        turnIndicator.textContent = iWon ? '🚪 ተጋጣሚ ከጠረጴዛው ወጥቶ ስላልተመለሰ አሸነፍክ!' : `🚪 ተጫዋች ከጠረጴዛው ወጥቷል (አሸናፊ፦ ${winnerName})`;
        turnIndicator.style.color = iWon ? '#4ade80' : '#fbbf24';
      } else {
        turnIndicator.textContent = iWon ? `🏆 አሸንፈሃል! (ደራሽ: ${state.pot || 0} ETB)` : `🏆 አሸናፊ፦ ${winnerName} (ደራሽ: ${state.pot || 0} ETB)`;
        turnIndicator.style.color = iWon ? '#4ade80' : '#fbbf24';
      }
    }

    // Show Back to Lobby button on status bar when game is finished
    const statusLobbyBtn = document.getElementById('statusLobbyBtn');
    if (statusLobbyBtn) {
      statusLobbyBtn.style.display = 'inline-block';
      statusLobbyBtn.onclick = () => switchToLobbyView();
    }

    // Hide middle table win area completely (Option 2: cards shown only in player/opponent positions)
    const sekaTableWinArea = document.getElementById('sekaTableWinArea');
    if (sekaTableWinArea) sekaTableWinArea.style.display = 'none';

    const isTimeoutForfeit = state.winReason === 'TIMEOUT_FORFEIT' || state.winReason === 'ABANDON_FORFEIT';

    if (isTimeoutForfeit) {
      // In timeout/abandon forfeit, NO cards are revealed (forfeited cards stay hidden face-down)
      if (opponentCardsContainer) {
        renderOpponentCards(oppCount);
      }
      if (playerHandFanContainer) playerHandFanContainer.style.display = 'block';
      if (state.myHand && state.myHand.length > 0) {
        playerCardsContainer.className = 'fan';
        const opt = arrangeSekaHandOptimal(state.myHand);
        const arranged = (opt && opt.arrangedCards && opt.arrangedCards.length > 0) ? opt.arrangedCards : state.myHand;
        renderPlayerHand(arranged);
      }
    } else {
      let winMelds = state.winningMelds;
      let winDiscard = state.winningDiscard;

      if (!winMelds || winMelds.length === 0) {
        const handToPartition = (iWon && state.myHand && state.myHand.length >= 10)
          ? state.myHand
          : (state.opponentHand && state.opponentHand.length >= 10 ? state.opponentHand : (state.myHand || []));

        if (handToPartition.length >= 10) {
          const opt = arrangeSekaHandOptimal(handToPartition);
          if (opt && opt.arrangedCards && opt.arrangedCards.length >= 10) {
            winMelds = [
              { type: 'QUATRIS', cards: opt.arrangedCards.slice(0, 4) },
              { type: 'TRIS', cards: opt.arrangedCards.slice(4, 7) },
              { type: 'TRIS', cards: opt.arrangedCards.slice(7, 10) }
            ];
            winDiscard = opt.arrangedCards[10] || opt.tetayCard || opt.discardedCard;
          }
        }
      }

      if (winMelds && winMelds.length > 0) {
        // Sort melds so QUATRIS is first!
        winMelds.sort((a, b) => {
          const lenA = Array.isArray(a) ? a.length : (a && a.cards ? a.cards.length : 0);
          const lenB = Array.isArray(b) ? b.length : (b && b.cards ? b.cards.length : 0);
          return lenB - lenA;
        });
      }

      const playerHandFanContainer = document.getElementById('playerHandFanContainer');
      if (playerHandFanContainer) playerHandFanContainer.style.display = 'block';

      // Ensure the tetay discarded card is displayed ONLY on the ground discard pile (never duplicated in hand)
      if (winDiscard && groundCardContainer) {
        groundCardContainer.innerHTML = createCardHTML(winDiscard, false, false);
        groundCardContainer.style.display = 'block';
      }

      if (iWon) {
        // When I win: render winning meld clusters in normal card size (76x110px) with clean spacing (Option 2)
        let myMelds = winMelds;
        if (!myMelds || myMelds.length === 0) {
          const hand10 = (state.myHand && state.myHand.length === 11 && winDiscard)
            ? state.myHand.filter(c => c.id !== winDiscard.id)
            : (state.myHand || []);
          const opt = arrangeSekaHandOptimal(hand10);
          if (opt && opt.arrangedCards && opt.arrangedCards.length >= 10) {
            myMelds = [
              { type: 'QUATRIS', cards: opt.arrangedCards.slice(0, 4) },
              { type: 'TRIS', cards: opt.arrangedCards.slice(4, 7) },
              { type: 'TRIS', cards: opt.arrangedCards.slice(7, 10) }
            ];
          }
        }
        if (myMelds && myMelds.length > 0) {
          if (playerHandFanContainer) {
            playerHandFanContainer.style.display = 'flex';
            playerHandFanContainer.style.justifyContent = 'center';
            playerHandFanContainer.style.alignItems = 'center';
            playerHandFanContainer.style.height = 'auto';
            playerHandFanContainer.style.minHeight = '130px';
            playerHandFanContainer.style.pointerEvents = 'auto';
          }
          if (playerCardsContainer) {
            playerCardsContainer.className = 'finished-player-melds';
            playerCardsContainer.innerHTML = renderMeldClustersHTML(myMelds);
            playerCardsContainer.style.display = 'flex';
            playerCardsContainer.style.position = 'relative';
            playerCardsContainer.style.left = 'auto';
            playerCardsContainer.style.bottom = 'auto';
            playerCardsContainer.style.transform = 'none';
            playerCardsContainer.style.width = '100%';
            playerCardsContainer.style.justifyContent = 'center';
            playerCardsContainer.style.alignItems = 'center';
          }
        } else if (state.myHand && state.myHand.length > 0) {
          playerCardsContainer.className = 'fan';
          const opt = arrangeSekaHandOptimal(state.myHand);
          const arranged = (opt && opt.arrangedCards && opt.arrangedCards.length > 0) ? opt.arrangedCards : state.myHand;
          renderPlayerHand(arranged);
        }
      } else {
        // When opponent wins: flip opponent's winning melds in normal card size (76x110px) with clean spacing
        if (opponentCardsContainer) {
          let oppMelds = winMelds;
          if (!oppMelds || oppMelds.length === 0) {
            let oppCards = (state.opponentHand && state.opponentHand.length > 0) ? state.opponentHand : [];
            if (oppCards.length === 11 && winDiscard) {
              oppCards = oppCards.filter(c => c.id !== winDiscard.id);
            }
            if (oppCards.length >= 10) {
              const optOpp = arrangeSekaHandOptimal(oppCards);
              if (optOpp && optOpp.arrangedCards && optOpp.arrangedCards.length >= 10) {
                oppMelds = [
                  { type: 'QUATRIS', cards: optOpp.arrangedCards.slice(0, 4) },
                  { type: 'TRIS', cards: optOpp.arrangedCards.slice(4, 7) },
                  { type: 'TRIS', cards: optOpp.arrangedCards.slice(7, 10) }
                ];
              }
            }
          }
          if (oppMelds && oppMelds.length > 0) {
            opponentCardsContainer.innerHTML = renderMeldClustersHTML(oppMelds);
            opponentCardsContainer.style.display = 'flex';
            opponentCardsContainer.style.justifyContent = 'center';
          }
        }
        // Render player's own hand spread out in full clarity so the player sees all their cards clearly!
        if (state.myHand && state.myHand.length > 0) {
          const opt = arrangeSekaHandOptimal(state.myHand);
          const arranged = (opt && opt.arrangedCards && opt.arrangedCards.length > 0) ? opt.arrangedCards : state.myHand;
          renderPlayerHand(arranged);
        }
      }
    }

    // Hide in-game action buttons
    const sekaWinBtn = document.getElementById('sekaWinBtn');
    const discardBtn = document.getElementById('discardBtn');
    if (sekaWinBtn) sekaWinBtn.style.display = 'none';
    if (discardBtn) discardBtn.style.display = 'none';
    if (weredBtn) weredBtn.style.display = 'none';
    if (gebiBtn) gebiBtn.style.display = 'none';
    if (pokeBtn) pokeBtn.style.display = 'none';

    // Reveal remaining deck cards on the deck slot when game finishes!
    const remainingDeckDisplay = document.getElementById('remainingDeckDisplay');
    const stockDeckTopCard = document.getElementById('stockDeckTopCard');
    const stockDeckSlotLabel = document.getElementById('stockDeckSlotLabel');
    const remCards = state.remainingDeckCards;

    if (remCards && remCards.length > 0 && remainingDeckDisplay) {
      if (stockDeckTopCard) stockDeckTopCard.style.display = 'none';
      remainingDeckDisplay.style.display = 'flex';

      const topSlice = remCards.slice(-3); // top 3 cascading cards
      let html = '<div class="remaining-deck-cascade" title="የቀሩ ካርታዎችን ለማየት ይጫኑ (Click to see all)">';
      topSlice.forEach((c, idx) => {
        const offsetX = (idx - (topSlice.length - 1)) * 10;
        const offsetY = (idx - (topSlice.length - 1)) * 4;
        const rot = (idx - (topSlice.length - 1)) * 6;
        html += `<div style="position: absolute; transform: translate(${offsetX}px, ${offsetY}px) rotate(${rot}deg); z-index: ${idx + 1}; pointer-events: none;">
          ${createCardHTML(c, false, false)}
        </div>`;
      });
      html += `<div class="remaining-deck-badge-chip">የቀረ: ${remCards.length} ካርታ 🔍</div>`;
      html += '</div>';
      remainingDeckDisplay.innerHTML = html;

      if (stockDeckSlotLabel) {
        stockDeckSlotLabel.innerHTML = `የቀረ (${remCards.length}) <span style="font-size: 10px; color: #38bdf8;">(እይ)</span>`;
      }
    }

    if (iWon) playWinSound();
    return;
  }
}

// Helper: renders meld clusters directly in hand or opponent space with pure spacing (Option 2: No labels, pure cards, 10-card melds only)
function renderMeldClustersHTML(melds) {
  let html = '<div class="hand-meld-clusters">';
  if (melds && melds.length > 0) {
    melds.forEach(m => {
      const cards = Array.isArray(m) ? m : (m && m.cards ? m.cards : []);
      if (cards && cards.length > 0) {
        html += `
          <div class="hand-meld-cluster">
            ${cards.map(c => createCardHTML(c, false, false)).join('')}
          </div>
        `;
      }
    });
  }
  html += '</div>';
  return html;
}

// Helper: renders winning melds face-up with clean visual grouping
function renderWinningMeldsHTML(melds, tetayCard) {
  let html = '';
  if (melds && melds.length > 0) {
    melds.forEach((m, idx) => {
      const typeLabel = m.type === 'QUATRIS' ? `ኳትሪስ (${m.cards.length} ካርታ)` : `ትሪስ ${idx + 1} (${m.cards.length} ካርታ)`;
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


function openRemainingDeckModal(cards) {
  const modal = document.getElementById('remainingDeckModal');
  const grid = document.getElementById('remainingDeckModalGrid');
  const title = document.getElementById('remainingDeckModalTitle');
  if (!modal || !grid) return;
  if (title) title.innerHTML = `🃏 በዴኩ ውስጥ ሳይሳቡ የቀሩ ካርታዎች (${cards.length} ካርታዎች)`;
  grid.innerHTML = cards.map(c => `
    <div style="margin: 3px;">
      ${createCardHTML(c, false, false)}
    </div>
  `).join('');
  modal.style.display = 'flex';
}

const closeRemainingDeckModalBtn = document.getElementById('closeRemainingDeckModalBtn');
if (closeRemainingDeckModalBtn) {
  closeRemainingDeckModalBtn.addEventListener('click', () => {
    const modal = document.getElementById('remainingDeckModal');
    if (modal) modal.style.display = 'none';
  });
}

const closeRemainingDeckModalBottomBtn = document.getElementById('closeRemainingDeckModalBottomBtn');
if (closeRemainingDeckModalBottomBtn) {
  closeRemainingDeckModalBottomBtn.addEventListener('click', () => {
    const modal = document.getElementById('remainingDeckModal');
    if (modal) modal.style.display = 'none';
  });
}

const sekaWinLobbyBtn = document.getElementById('sekaWinLobbyBtn');
if (sekaWinLobbyBtn) {
  sekaWinLobbyBtn.addEventListener('click', () => {
    switchToLobbyView();
  });
}

returnToLobbyBtn.addEventListener('click', () => {
  switchToLobbyView();
});

const closeResultModalBtn = document.getElementById('closeResultModalBtn');
if (closeResultModalBtn) {
  closeResultModalBtn.addEventListener('click', () => {
    gameResultModal.style.display = 'none';
  });
}

function renderOpponentCards(count, isInitialDeal = false) {
  // Opponent cards ALWAYS remain face-down (never reveal opponent cards face-up)
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
  } else if (w <= 1400) {
    // Standard Desktop / Laptops (769px - 1400px)
    maxAngle = 28;
    spacing = Math.min(42, Math.max(28, Math.floor(520 / count)));
  } else {
    // Large Desktop Screens (1401px+)
    maxAngle = 28;
    spacing = Math.min(46, Math.max(30, Math.floor(580 / count)));
  }

  return { maxAngle, spacing };
}

function renderPlayerHand(hand) {
  if (!hand) return;

  const isInitialDeal = !hasPlayedDealingAnim && currentGameState && currentGameState.status === 'PLAYING';
  if (isInitialDeal) {
    hasPlayedDealingAnim = true;
    runDealingSequence(hand);
    return;
  }

  if (isDealingInProgress) return;

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
    playerCardsContainer.removeAttribute('style');
    playerCardsContainer.style.display = 'block';
    playerCardsContainer.className = 'fan player-cards';
    const playerHandFanContainer = document.getElementById('playerHandFanContainer');
    if (playerHandFanContainer) {
      playerHandFanContainer.removeAttribute('style');
    }

    const total = hand.length;
    const middle = (total - 1) / 2;
    const { maxAngle, spacing } = getResponsiveFanGeometry(total);

    playerCardsContainer.innerHTML = hand.map((card, idx) => {
      const isSelected = selectedCardsSet.has(card.id) || selectedCardsSet.has(String(card.id)) || String(card.id) === String(selectedCardId);
      const angle = middle > 0 ? ((idx - middle) / middle) * maxAngle : 0;
      const offset = (idx - middle) * spacing;
      const fanStyle = `--angle: ${angle.toFixed(1)}deg; --offset: ${offset.toFixed(0)}px;`;

      return createCardHTML(card, isSelected, false, idx + 1, '', '', fanStyle);
    }).join('');
  }

  updateTakeGroundButton();
  bindCardInteractions(hand);
}

// Dealing animation: Cards fly in one by one from deck face-down, then flip face-up in front of player
function runDealingSequence(hand) {
  if (!hand || hand.length === 0) return;
  isDealingInProgress = true;
  playerCardsContainer.innerHTML = '';
  playerCardsContainer.style.display = 'block';
  if (meldGroupsContainer) meldGroupsContainer.style.display = 'none';

  const total = hand.length;
  const middle = (total - 1) / 2;
  const { maxAngle, spacing } = getResponsiveFanGeometry(total);

  hand.forEach((card, idx) => {
    setTimeout(() => {
      const angle = middle > 0 ? ((idx - middle) / middle) * maxAngle : 0;
      const offset = (idx - middle) * spacing;
      const fanStyle = `--angle: ${angle.toFixed(1)}deg; --offset: ${offset.toFixed(0)}px;`;

      const cardHtml = createCardHTML(card, false, false, idx + 1, 'face-down dealing-anim', '', fanStyle);
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = cardHtml.trim();
      const cardEl = tempDiv.firstElementChild;
      playerCardsContainer.appendChild(cardEl);
      playCardSound();

      // Card lands and flips face-up to reveal rank & suit!
      setTimeout(() => {
        if (cardEl && cardEl.parentNode) {
          cardEl.classList.remove('face-down');
          cardEl.classList.remove('dealing-anim');
          cardEl.classList.add('flip-reveal');
          playCardSound();
        }
      }, 240);

      // Once all cards have been dealt and flipped, finalize interactive hand!
      if (idx === hand.length - 1) {
        setTimeout(() => {
          isDealingInProgress = false;
          hasPlayedDealingAnim = true;
          renderPlayerHand(hand);
        }, 550);
      }
    }, idx * 75);
  });
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

      // Multi-select in Conquer (for selecting Tris/Quatris to ወረድ) or when Ground Meld Bar is open
      const isConquerMode = currentGameState && currentGameState.gameType !== 'SEKA';
      if (isConquerMode || (groundMeldBar && groundMeldBar.style.display !== 'none')) {
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
        cardEl.classList.toggle('selected', selectedCardsSet.has(cId));
        updateTakeGroundButton();
        updateGroundMeldBar();
        return;
      }

      // Normal selection: tapping a card selects it (or deselects if already selected)
      if (selectedCardsSet.has(cId) && selectedCardId === cId) {
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
  const isPrintedWildJoker = (card.rank === 'JOKER' || card.suit === '🃏' || card.suitName === 'joker') && !isFalse;
  const isDesignatedJoker = !isPrintedWildJoker && !isFalse && (card.isMainJoker || card.isJoker);
  const isRed = card.suit === '♥' || card.suit === '♦' || card.color === 'red' || (isFalse && card.color === 'red');
  const colorClass = isRed ? 'red' : 'black';
  const selectedClass = isSelected ? 'selected' : '';
  const groupStartClass = card.isGroupStart ? 'group-start' : '';
  const delayStyle = animDelay ? `animation-delay: ${animDelay};` : '';

  const baseBadge = isBaseJoker ? `<div class="card-base-badge">BASE ⭐</div>` : '';
  const tetayBadge = '';

  if (isPrintedWildJoker || isFalse) {
    const starHTML = `<div class="card-joker-star">⭐</div>`;
    const falseHTML = isFalse ? `<div class="card-false-badge ${isRed ? 'red' : 'black'}">FALSE</div>` : '';
    const jokerImgSrc = isRed ? '/images/joker_red.png' : '/images/joker_black.png';

    return `
      <div class="card card-joker-authentic ${colorClass} ${selectedClass} ${groupStartClass} ${animClass}" data-id="${card.id}" style="z-index: ${zIndex}; ${delayStyle} ${extraStyle}">
        <img src="${jokerImgSrc}" class="joker-full-art" alt="Joker" />
        ${starHTML}
        ${falseHTML}
        ${tetayBadge}
        ${baseBadge}
      </div>
    `;
  }

  let displayRank = card.rank;
  let cornerSuit = card.suit;
  let centerHTML = `<div class="card-center-suit">${card.suit}</div>`;
  let starHTML = '';

  if (isDesignatedJoker) {
    // Conquer natural card designated as wild Joker (e.g. 7♠ or 7♣)
    displayRank = card.rank;
    cornerSuit = card.suit;
    centerHTML = `<div class="card-center-suit">${card.suit}</div>`;
    starHTML = `<div class="card-joker-star">⭐</div>`;
  }

  return `
    <div class="card ${colorClass} ${selectedClass} ${groupStartClass} ${animClass}" data-id="${card.id}" style="z-index: ${zIndex}; ${delayStyle} ${extraStyle}">
      ${starHTML}
      ${tetayBadge}
      <div class="card-corner top-left">
        <div class="corner-rank">${displayRank}</div>
        <div class="corner-suit">${cornerSuit}</div>
      </div>
      ${centerHTML}
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
          ${group.map(c => createCardHTML(c, false, false)).join('')}
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
          ${group.map(c => createCardHTML(c, false, false)).join('')}
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

  const isPrintedJoker = (card.rank === 'JOKER' || card.suit === '🃏' || card.suitName === 'joker') && !isFalse;
  if (isPrintedJoker) {
    return `
      <div class="mini-card ${colorClass}" style="padding: 1px; overflow: hidden; background: #ffffff; min-width: 32px; height: 44px; border: 1px solid rgba(0,0,0,0.2);">
        <img src="/images/${isRed ? 'joker_red.png' : 'joker_black.png'}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 3px;" alt="Joker" />
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

