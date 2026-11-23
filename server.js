// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const GameRoom = require('./engine/gameRoom');
const { SekaGameRoom, SekaBotPlayer } = require('./engine/sekaGameRoom');
const walletManager = require('./engine/walletManager');
const depositManager = require('./engine/depositManager');
const { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } = require('./engine/supabaseClient');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory rooms: { roomId: GameRoom }
const rooms = new Map();
// In-memory Seka rooms: { roomId: SekaGameRoom }
const sekaRooms = new Map();
// Socket to player map: { socketId: { userId, roomId, gameType } }
const socketPlayerMap = new Map();

// Supabase config endpoint (for frontend — anon key only)
app.get('/api/config/supabase', (req, res) => {
  res.json({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
});

// REST API for Wallet
app.get('/api/wallet/:userId', (req, res) => {
  const wallet = walletManager.getWallet(req.params.userId);
  res.json(wallet);
});

app.post('/api/wallet/deposit', async (req, res) => {
  const { userId, amount, method, transactionId } = req.body;
  const num = Number(amount);
  if (!userId || !num || num <= 0) {
    return res.status(400).json({ success: false, message: 'እባክዎ ትክክለኛ የገንዘብ መጠን ያስገቡ (Invalid amount)' });
  }
  if (!transactionId || transactionId.trim().length < 4) {
    return res.status(400).json({ success: false, message: 'እባክዎ Transaction ID ያስገቡ (ቢያንስ 4 ፊደል)' });
  }

  const txnTrimmed = transactionId.trim();
  const methodName = method || 'telebirr';

  try {
    // Lookup user name & phone for admin visibility
    const userWallet = walletManager.getWallet(userId);
    const userName = (userWallet && userWallet.name) ? userWallet.name : '';
    const userPhone = (userWallet && userWallet.phone) ? userWallet.phone : '';

    const deposit = await depositManager.createDeposit({
      userId,
      userName,
      userPhone,
      amount: num,
      method: methodName,
      transactionId: txnTrimmed
    });

    // Notify admins listening via socket
    io.emit('new_deposit_request', deposit);

    res.json({
      success: true,
      status: 'PENDING',
      deposit,
      message: `📋 ${num} ETB deposit ጥያቄ ተልኳል! Transaction ID: ${txnTrimmed}`
    });
  } catch (err) {
    console.error('[Deposit] Error:', err.message);
    res.status(400).json({ success: false, message: err.message || 'ስህተት ተከስቷል፤ እባክዎ እንደገና ይሞክሩ' });
  }
});

// Get user's deposit history
app.get('/api/wallet/deposits/:userId', (req, res) => {
  try {
    const list = depositManager.getUserDeposits(req.params.userId);
    res.json({ success: true, deposits: list });
  } catch (err) {
    res.json({ success: true, deposits: [] });
  }
});

// Helper: check admin auth
function isAdminAuthorized(key) {
  return key === 'wende3428' || key === 'ethio-games-admin-2024';
}

// Admin: List pending deposits
app.get('/api/admin/deposits/pending', (req, res) => {
  const adminKey = req.query.adminKey || req.headers['x-admin-key'];
  if (!isAdminAuthorized(adminKey)) {
    return res.status(403).json({ success: false, message: 'Unauthorized. Invalid admin key.' });
  }
  const pending = depositManager.getPendingDeposits();
  res.json({ success: true, deposits: pending });
});

// Admin: List all deposits (history)
app.get('/api/admin/deposits/all', (req, res) => {
  const adminKey = req.query.adminKey || req.headers['x-admin-key'];
  if (!isAdminAuthorized(adminKey)) {
    return res.status(403).json({ success: false, message: 'Unauthorized. Invalid admin key.' });
  }
  const all = depositManager.getAllDeposits(150);
  res.json({ success: true, deposits: all });
});

// Admin: Approve a deposit (credits user balance)
app.post('/api/admin/deposit/approve', async (req, res) => {
  const { depositId, adminKey, note } = req.body;
  if (!isAdminAuthorized(adminKey)) {
    return res.status(403).json({ success: false, message: 'Unauthorized. Invalid admin key.' });
  }

  try {
    const deposit = await depositManager.approveDeposit(depositId, note);
    // Credit the user's wallet
    const wallet = walletManager.deposit(deposit.userId, deposit.amount);

    // Notify user via socket
    io.emit(`wallet_${deposit.userId}`, wallet);
    io.emit(`deposit_approved_${deposit.userId}`, {
      amount: deposit.amount,
      transactionId: deposit.transactionId,
      depositId: deposit.id
    });
    // Notify admin panel
    io.emit('deposit_status_changed', { id: deposit.id, status: 'APPROVED' });

    res.json({ success: true, deposit, wallet });
  } catch (err) {
    console.error('[Admin Approve] Error:', err.message);
    res.status(400).json({ success: false, message: err.message });
  }
});

// Admin: Reject a deposit
app.post('/api/admin/deposit/reject', async (req, res) => {
  const { depositId, adminKey, reason } = req.body;
  if (!isAdminAuthorized(adminKey)) {
    return res.status(403).json({ success: false, message: 'Unauthorized. Invalid admin key.' });
  }

  try {
    const deposit = await depositManager.rejectDeposit(depositId, reason || 'Transaction ID አልተገኘም / ትክክል አይደለም');

    // Notify user via socket
    io.emit(`deposit_rejected_${deposit.userId}`, {
      depositId: deposit.id,
      transactionId: deposit.transactionId,
      reason: deposit.adminNote
    });
    // Notify admin panel
    io.emit('deposit_status_changed', { id: deposit.id, status: 'REJECTED' });

    res.json({ success: true, deposit });
  } catch (err) {
    console.error('[Admin Reject] Error:', err.message);
    res.status(400).json({ success: false, message: err.message });
  }
});

// Fast favicon response to prevent 404
app.get('/favicon.ico', (req, res) => res.status(204).end());

// REST API for User Registration & Profile
app.post('/api/user/register', async (req, res) => {
  const { userId, name, phone } = req.body;
  if (!userId) return res.status(400).json({ success: false, message: 'userId is required' });
  if (!name || name.trim().length < 2 || name.trim().toLowerCase() === 'player' || name.trim().toLowerCase().startsWith('player ')) {
    return res.status(400).json({ success: false, message: 'እባክዎ ትክክለኛ ስም ያስገቡ (Player መጠቀም አይቻልም)' });
  }
  if (!phone || phone.trim().length < 9) {
    return res.status(400).json({ success: false, message: 'እባክዎ ትክክለኛ ስልክ ቁጥር ያስገቡ' });
  }
  const wallet = await walletManager.updateProfileAsync(userId, { name: name.trim(), phone: phone.trim() });
  res.json({ success: true, wallet });
});

app.get('/api/user/profile/:userId', async (req, res) => {
  const wallet = await walletManager.getWalletAsync(req.params.userId);
  res.json({ success: true, wallet });
});

app.get('/api/rooms', (req, res) => {
  const list = [];
  rooms.forEach((room) => {
    if (room.status === 'WAITING') {
      const expiresIn = room.expiresAt ? Math.max(0, Math.round((room.expiresAt - Date.now()) / 1000)) : 60;
      list.push({
        roomId: room.roomId,
        creatorName: room.creator.name,
        stakeAmount: room.stakeAmount,
        expiresIn
      });
    }
  });
  res.json(list);
});

// REST API for Seka Rooms
app.get('/api/seka/rooms', (req, res) => {
  const list = [];
  sekaRooms.forEach((room) => {
    if (room.status === 'WAITING') {
      const expiresIn = room.expiresAt ? Math.max(0, Math.round((room.expiresAt - Date.now()) / 1000)) : 60;
      list.push({
        roomId: room.roomId,
        creatorId: room.creator ? room.creator.id : null,
        creatorName: room.creator ? room.creator.name : 'Host',
        stakeAmount: room.stakeAmount,
        maxPlayers: room.maxPlayers || 2,
        playersCount: room.players ? room.players.length : 1,
        expiresIn
      });
    }
  });
  res.json(list);
});

// Socket.io Events
io.on('connection', (socket) => {
  // Join Lobby / Register Player
  socket.on('register_user', async ({ userId, name, phone }) => {
    socketPlayerMap.set(socket.id, { userId, name, phone });
    const wallet = await walletManager.getWalletAsync(userId, name, phone);
    socket.emit('wallet_update', wallet);
  });

  // Update Profile
  socket.on('update_profile', async ({ userId, name, phone }) => {
    socketPlayerMap.set(socket.id, { userId, name, phone });
    const wallet = await walletManager.updateProfileAsync(userId, { name, phone });
    socket.emit('wallet_update', wallet);
  });

  // Create Table
  socket.on('create_room', ({ userId, name, stakeAmount }) => {
    const roomId = `room_${Math.floor(1000 + Math.random() * 9000)}`;
    const room = new GameRoom(roomId, { id: userId, name, socketId: socket.id }, Number(stakeAmount) || 100);
    room.createdAt = Date.now();
    room.expiresAt = Date.now() + 60 * 1000; // 1-minute expiration if no opponent joins
    room.expireTimeout = setTimeout(() => {
      if (room.status === 'WAITING') {
        room.status = 'EXPIRED';
        walletManager.refundEscrow(room.roomId);
        io.to(roomId).emit('room_expired', {
          roomId,
          message: '⏳ የጨዋታው ጊዜ አልቋል! በ1 ደቂቃ ውስጥ ተጋጣሚ ስላልገባ ጠረጴዛው ፈርሷል (Game expired: No opponent joined within 1 minute).'
        });
        rooms.delete(roomId);
        io.emit('rooms_updated');
      }
    }, 60 * 1000);

    rooms.set(roomId, room);
    socketPlayerMap.set(socket.id, { userId, name, roomId });

    socket.join(roomId);
    socket.emit('room_created', { roomId, expiresAt: room.expiresAt });
    broadcastRoomUpdate(room);
  });

  // Join Table
  socket.on('join_room', ({ roomId, userId, name }) => {
    const room = rooms.get(roomId);
    if (!room || room.status === 'EXPIRED') return socket.emit('error_msg', 'Room expired or not found');

    if (room.expireTimeout) {
      clearTimeout(room.expireTimeout);
      room.expireTimeout = null;
    }

    const result = room.join({ id: userId, name, socketId: socket.id });
    if (!result.success) return socket.emit('error_msg', result.message);

    socketPlayerMap.set(socket.id, { userId, name, roomId });
    socket.join(roomId);

    // Update wallet states
    broadcastWallet(room.creator.id);
    broadcastWallet(room.joiner.id);

    broadcastRoomUpdate(room);
  });

  // Play Against AI Bot (Single Player mode for instant testing)
  socket.on('play_vs_bot', ({ userId, name, stakeAmount }) => {
    const roomId = `bot_room_${Math.floor(1000 + Math.random() * 9000)}`;
    const room = new GameRoom(roomId, { id: userId, name, socketId: socket.id }, Number(stakeAmount) || 100);
    rooms.set(roomId, room);
    socketPlayerMap.set(socket.id, { userId, name, roomId });
    socket.join(roomId);

    const botId = `bot_${uuidv4().slice(0, 6)}`;
    const botResult = room.join({ id: botId, name: 'Abebe (AI Bot)', socketId: null });
    if (!botResult.success) return socket.emit('error_msg', botResult.message);

    // Bot is Joiner, so Bot automatically calls High/Low after 1.5 seconds
    broadcastRoomUpdate(room);

    setTimeout(() => {
      // Bot picks randomly among 'high', 'low', 'same', 'gon'
      const botChoices = ['high', 'low', 'same', 'gon'];
      const pick = botChoices[Math.floor(Math.random() * botChoices.length)];
      room.setJokerHighLow(botId, pick);
      broadcastRoomUpdate(room);
    }, 1200);
  });

  // Rule 2: Cut Joker (Joiner action) — legacy single-click (auto High)
  socket.on('cut_joker', ({ roomId, userId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const res = room.cutJoker(userId);
    if (!res.success) return socket.emit('error_msg', res.message);
    broadcastRoomUpdate(room);
  });

  // Rule 2b: Set Joker High/Low (Joiner sees 28th card and chooses)
  socket.on('set_joker_high_low', ({ roomId, userId, choice }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const res = room.setJokerHighLow(userId, choice);
    if (!res.success) return socket.emit('error_msg', res.message);
    broadcastRoomUpdate(room);

    // If next turn belongs to Bot after joker selection, trigger Bot move
    if (room.status === 'PLAYING' && room.currentTurnPlayerId && room.currentTurnPlayerId.startsWith('bot_')) {
      handleBotTurn(room);
    }
  });

  // Draw Card (from 'deck' or 'ground')
  socket.on('draw_card', ({ roomId, userId, source }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const res = room.drawCard(userId, source);
    if (!res.success) return socket.emit('error_msg', res.message);

    broadcastRoomUpdate(room);
  });

  // Rule 4: Draw ground with table melds
  socket.on('draw_ground_with_melds', ({ roomId, userId, melds }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const res = room.drawCardFromGroundWithMelds(userId, melds);
    broadcastRoomUpdate(room);
    if (room.status === 'FINISHED') {
      if (room.creator) broadcastWallet(room.creator.id);
      if (room.joiner) broadcastWallet(room.joiner.id);
    }
  });

  // Lay down melds onto the table ("ውረድ")
  socket.on('lay_down_melds', ({ roomId, userId, melds }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const res = room.layDownMelds(userId, melds);
    if (!res.success) return socket.emit('error_msg', res.message);
    broadcastRoomUpdate(room);
  });

  // Penalty: Player committed to ground but could not reach 41 -> FORFEIT!
  socket.on('forfeit_ground_fail', ({ roomId, userId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    room.forfeitFromFailedGround(userId);
    broadcastRoomUpdate(room);
    if (room.creator) broadcastWallet(room.creator.id);
    if (room.joiner) broadcastWallet(room.joiner.id);
  });

  // Discard Card (to ground or to Gebi)
  socket.on('discard_card', ({ roomId, userId, cardId, toGebi, melds }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const res = room.discardCard(userId, cardId, toGebi, melds);
    if (!res.success) return socket.emit('error_msg', res.message);

    broadcastRoomUpdate(room);

    // If next turn belongs to Bot, trigger Bot move!
    if (room.status === 'PLAYING' && room.currentTurnPlayerId && room.currentTurnPlayerId.startsWith('bot_')) {
      handleBotTurn(room);
    }
  });

  // Rule 8: Poke Player
  socket.on('poke_player', ({ roomId, userId }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const res = room.triggerPoke(userId, (winnerId, reason, payout) => {
      broadcastRoomUpdate(room);
      if (room.creator) broadcastWallet(room.creator.id);
      if (room.joiner) broadcastWallet(room.joiner.id);
    });

    if (!res.success) return socket.emit('error_msg', res.message);
    broadcastRoomUpdate(room);
  });

  // Rule 9 & 13: Joker Swap
  socket.on('swap_joker', ({ roomId, userId, targetOwnerId, meldIndex, naturalCardId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const res = room.swapJoker(userId, targetOwnerId, meldIndex, naturalCardId);
    if (!res.success) return socket.emit('error_msg', res.message);
    broadcastRoomUpdate(room);
  });

  // Rule: Attach card to table meld (ገቢ ማድረግ)
  socket.on('attach_gebi_card', ({ roomId, userId, targetOwnerId, meldIndex, cardId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const res = room.attachGebiCard(userId, targetOwnerId, meldIndex, cardId);
    if (!res.success) return socket.emit('error_msg', res.message);
    broadcastRoomUpdate(room);
  });

  // ==========================================
  // SEKA (ሴካ) SOCKET EVENTS
  // ==========================================

  // Create Seka Table
  socket.on('create_seka_room', ({ userId, name, stakeAmount, maxPlayers }) => {
    const roomId = `seka_${Math.floor(1000 + Math.random() * 9000)}`;
    const numPlayers = Number(maxPlayers) === 3 ? 3 : 2;
    const room = new SekaGameRoom(roomId, { id: userId, name, socketId: socket.id }, Number(stakeAmount) || 100, numPlayers);
    attachSekaRoomCallbacks(room);
    room.createdAt = Date.now();
    room.expiresAt = Date.now() + 60 * 1000; // 1-minute expiration if no opponent joins
    room.expireTimeout = setTimeout(() => {
      if (room.status === 'WAITING') {
        room.status = 'EXPIRED';
        walletManager.refundEscrow(room.roomId);
        io.to(roomId).emit('room_expired', {
          roomId,
          message: '⏳ የሴካ ጨዋታ ጊዜ አልቋል! በ1 ደቂቃ ውስጥ ተጋጣሚ ስላልገባ ጠረጴዛው ፈርሷል (Seka game expired: No opponent joined within 1 minute).'
        });
        sekaRooms.delete(roomId);
        io.emit('rooms_updated');
      }
    }, 60 * 1000);

    sekaRooms.set(roomId, room);
    socketPlayerMap.set(socket.id, { userId, name, roomId, gameType: 'SEKA' });

    socket.join(roomId);
    socket.emit('seka_room_created', { roomId, expiresAt: room.expiresAt, stakeAmount: room.stakeAmount });
    broadcastSekaRoomUpdate(room);
    io.emit('rooms_updated');
  });

  // Join Seka Table
  socket.on('join_seka_room', ({ roomId, userId, name }) => {
    const room = sekaRooms.get(roomId);
    if (!room || room.status === 'EXPIRED') return socket.emit('error_msg', 'Seka room expired or not found');

    const result = room.join({ id: userId, name, socketId: socket.id });
    if (!result.success) return socket.emit('error_msg', result.message);

    if (room.status === 'PLAYING' && room.expireTimeout) {
      clearTimeout(room.expireTimeout);
      room.expireTimeout = null;
    }

    socketPlayerMap.set(socket.id, { userId, name, roomId, gameType: 'SEKA' });
    socket.join(roomId);

    for (const p of room.players) {
      if (p.id) broadcastWallet(p.id);
    }
    broadcastSekaRoomUpdate(room);
  });

  // Play Seka against AI Bot
  socket.on('play_seka_bot', ({ userId, name, stakeAmount }) => {
    const roomId = `seka_bot_${Math.floor(1000 + Math.random() * 9000)}`;
    const room = new SekaGameRoom(roomId, { id: userId, name, socketId: socket.id }, Number(stakeAmount) || 100);
    attachSekaRoomCallbacks(room);
    sekaRooms.set(roomId, room);
    socketPlayerMap.set(socket.id, { userId, name, roomId, gameType: 'SEKA' });
    socket.join(roomId);

    const botId = `bot_${uuidv4().slice(0, 6)}`;
    const botResult = room.join({ id: botId, name: 'Seka Bot (AI)', socketId: null, isBot: true });
    if (!botResult.success) return socket.emit('error_msg', botResult.message);

    socket.emit('seka_room_created', { roomId, isBot: true });
    broadcastWallet(room.creator.id);
    broadcastSekaRoomUpdate(room);

    // If bot has the first turn (e.g. if bot were creator), trigger bot
    if (room.currentTurnPlayerId === botId) {
      handleSekaBotTurn(room);
    }
  });

  // Draw Card in Seka (free draw from deck or ground)
  socket.on('draw_seka_card', ({ roomId, userId, source }) => {
    const room = sekaRooms.get(roomId);
    if (!room) return;
    const res = room.drawCard(userId, source);
    if (!res.success) return socket.emit('error_msg', res.message);
    broadcastSekaRoomUpdate(room);
  });

  // Discard Card in Seka
  socket.on('discard_seka_card', ({ roomId, userId, cardId, melds }) => {
    const room = sekaRooms.get(roomId);
    if (!room) return;
    const res = room.discardCard(userId, cardId, melds);
    if (!res.success) return socket.emit('error_msg', res.message);
    broadcastSekaRoomUpdate(room);

    if (room.status === 'PLAYING' && room.currentTurnPlayerId && room.currentTurnPlayerId.startsWith('bot_')) {
      handleSekaBotTurn(room);
    }
  });

  // Claim Seka Win (2 Tris + 1 Quatris + 1 Discard)
  socket.on('claim_seka_win', ({ roomId, userId, discardCardId }) => {
    const room = sekaRooms.get(roomId);
    if (!room) return;
    const res = room.claimWin(userId, discardCardId);
    if (!res.success) return socket.emit('error_msg', res.message);
    broadcastSekaRoomUpdate(room);
  });

  socket.on('leave_seka_room', ({ roomId, userId }) => {
    const room = sekaRooms.get(roomId);
    if (room && room.status === 'WAITING') {
      if (room.expireTimeout) clearTimeout(room.expireTimeout);
      walletManager.refundEscrow(room.roomId);
      sekaRooms.delete(roomId);
      io.emit('rooms_updated');
      if (userId) broadcastWallet(userId);
    }
  });

  // Player temporarily leaves playing Seka table (1-minute return window)
  socket.on('leave_seka_table_temp', ({ roomId, userId }) => {
    const room = sekaRooms.get(roomId);
    if (!room || room.status !== 'PLAYING') return;
    room.playerLeaveTemp(userId, room.onLeaveTimeoutCallback);
    broadcastSekaRoomUpdate(room);
  });

  // Player returns to Seka table within 1-minute window
  socket.on('return_to_seka_table', ({ roomId, userId }) => {
    const room = sekaRooms.get(roomId);
    if (!room) return;
    room.playerReturn(userId);
    socket.join(roomId);
    broadcastSekaRoomUpdate(room);
  });

  socket.on('disconnect', () => {
    const playerInfo = socketPlayerMap.get(socket.id);
    if (playerInfo && playerInfo.roomId) {
      const room = rooms.get(playerInfo.roomId);
      if (room && room.status === 'WAITING') {
        walletManager.refundEscrow(room.roomId);
        rooms.delete(playerInfo.roomId);
      }
      const sRoom = sekaRooms.get(playerInfo.roomId);
      if (sRoom && sRoom.status === 'WAITING') {
        walletManager.refundEscrow(sRoom.roomId);
        sekaRooms.delete(playerInfo.roomId);
      } else if (sRoom && sRoom.status === 'PLAYING') {
        sRoom.playerLeaveTemp(playerInfo.userId, sRoom.onLeaveTimeoutCallback);
        broadcastSekaRoomUpdate(sRoom);
      }
    }
    socketPlayerMap.delete(socket.id);
  });
});

function attachSekaRoomCallbacks(room) {
  room.onTurnTimeoutCallback = (r, winner, loser) => {
    for (const p of r.players) {
      if (p && p.id) broadcastWallet(p.id);
    }
    broadcastSekaRoomUpdate(r);
    io.to(r.roomId).emit('player_timed_out', {
      winnerName: winner ? winner.name : 'Opponent',
      loserName: loser ? loser.name : 'Player',
      message: `⏰ ${loser ? loser.name : 'ተጫዋች'} በ1 ደቂቃ ውስጥ ካርታ ስላልጣለ ተሸንፏል! ${winner ? winner.name : 'ተጋጣሚ'} አሸነፈ!`
    });
  };
  room.onLeaveTimeoutCallback = (r, winner, loser) => {
    for (const p of r.players) {
      if (p && p.id) broadcastWallet(p.id);
    }
    broadcastSekaRoomUpdate(r);
    io.to(r.roomId).emit('player_abandoned', {
      winnerName: winner ? winner.name : 'Opponent',
      loserName: loser ? loser.name : 'Player',
      message: `❌ ${loser ? loser.name : 'ተጫዋች'} በ1 ደቂቃ ውስጥ ስላልተመለሰ ተሸንፏል! ${winner ? winner.name : 'ተጋጣሚ'} አሸነፈ!`
    });
  };
}

// Broadcast room state individually to players (hiding opponent's cards)
function broadcastRoomUpdate(room) {
  if (room.creator && room.creator.socketId) {
    io.to(room.creator.socketId).emit('game_state', room.getClientState(room.creator.id));
  }
  if (room.joiner && room.joiner.socketId) {
    io.to(room.joiner.socketId).emit('game_state', room.getClientState(room.joiner.id));
  }
}

function broadcastSekaRoomUpdate(room) {
  const players = room.players || [room.creator, room.joiner].filter(Boolean);
  for (const p of players) {
    if (p && p.socketId) {
      io.to(p.socketId).emit('seka_game_state', room.getPublicState(p.id));
    }
  }
  if (room.status === 'FINISHED') {
    for (const p of players) {
      if (p && p.id) broadcastWallet(p.id);
    }
  }
}

function handleSekaBotTurn(room) {
  if (!room || room.status !== 'PLAYING') return;
  const botId = (room.joiner && room.joiner.isBot) ? room.joiner.id : (room.creator && room.creator.isBot ? room.creator.id : null);
  if (!botId || room.currentTurnPlayerId !== botId) return;

  const botPlayer = new SekaBotPlayer(room, botId, 'Seka Bot (AI)');
  botPlayer.takeTurn(io, () => {
    broadcastSekaRoomUpdate(room);
  });
}

function broadcastWallet(userId) {
  const wallet = walletManager.getWallet(userId);
  io.emit(`wallet_${userId}`, wallet);
}

// Simple AI Bot Logic to play Ethiopian Conquer turns
function handleBotTurn(room) {
  setTimeout(() => {
    if (room.status !== 'PLAYING') return;
    const botId = room.joiner.id.startsWith('bot_') ? room.joiner.id : room.creator.id;
    if (room.currentTurnPlayerId !== botId) return;

    const botHand = room.getHand(botId);

    // If turn state is AWAITING_DISCARD (e.g. creator starts with 14 cards, must discard first)
    if (room.turnState === 'AWAITING_DISCARD') {
      const nonJokers = botHand.filter(c => !c.isJoker && c.rank !== room.jokerRank);
      const cardToDiscard = nonJokers.length > 0 ? nonJokers[0] : botHand[0];
      room.discardCard(botId, cardToDiscard.id, false);
      broadcastRoomUpdate(room);
      return;
    }

    // AWAITING_DRAW: Bot draws from deck
    const drawRes = room.drawCard(botId, 'deck');
    broadcastRoomUpdate(room);

    // Bot waits 1.5 seconds then discards worst non-joker card
    setTimeout(() => {
      if (room.status !== 'PLAYING' || room.currentTurnPlayerId !== botId) return;
      const updatedHand = room.getHand(botId);
      const nonJokers = updatedHand.filter(c => !c.isJoker && c.rank !== room.jokerRank);
      const cardToDiscard = nonJokers.length > 0 ? nonJokers[0] : updatedHand[0];

      room.discardCard(botId, cardToDiscard.id, false);
      broadcastRoomUpdate(room);
    }, 1500);
  }, 1200);
}

// Start server only when NOT running on Vercel (Vercel uses serverless)
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(` Ethiopian Conquer Card & Betting Server Running!`);
    console.log(` URL: http://localhost:${PORT}`);
    console.log(`====================================================`);
  });
}

module.exports = app;

