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

// REST API for Wallet
app.get('/api/wallet/:userId', (req, res) => {
  const wallet = walletManager.getWallet(req.params.userId);
  res.json(wallet);
});

app.post('/api/wallet/deposit', (req, res) => {
  const { userId, amount } = req.body;
  const wallet = walletManager.deposit(userId, Number(amount) || 100);
  res.json(wallet);
});

// REST API for User Registration & Profile
app.post('/api/user/register', (req, res) => {
  const { userId, name, phone } = req.body;
  if (!userId) return res.status(400).json({ success: false, message: 'userId is required' });
  const wallet = walletManager.updateProfile(userId, { name, phone });
  res.json({ success: true, wallet });
});

app.get('/api/user/profile/:userId', (req, res) => {
  const wallet = walletManager.getWallet(req.params.userId);
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
        creatorName: room.creator.name,
        stakeAmount: room.stakeAmount,
        expiresIn
      });
    }
  });
  res.json(list);
});

// Socket.io Events
io.on('connection', (socket) => {
  // Join Lobby / Register Player
  socket.on('register_user', ({ userId, name, phone }) => {
    socketPlayerMap.set(socket.id, { userId, name, phone });
    const wallet = walletManager.getWallet(userId, name, phone);
    socket.emit('wallet_update', wallet);
  });

  // Update Profile
  socket.on('update_profile', ({ userId, name, phone }) => {
    socketPlayerMap.set(socket.id, { userId, name, phone });
    const wallet = walletManager.updateProfile(userId, { name, phone });
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
  socket.on('create_seka_room', ({ userId, name, stakeAmount }) => {
    const roomId = `seka_${Math.floor(1000 + Math.random() * 9000)}`;
    const room = new SekaGameRoom(roomId, { id: userId, name, socketId: socket.id }, Number(stakeAmount) || 100);
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
    socket.emit('seka_room_created', { roomId, expiresAt: room.expiresAt });
    broadcastSekaRoomUpdate(room);
  });

  // Join Seka Table
  socket.on('join_seka_room', ({ roomId, userId, name }) => {
    const room = sekaRooms.get(roomId);
    if (!room || room.status === 'EXPIRED') return socket.emit('error_msg', 'Seka room expired or not found');

    if (room.expireTimeout) {
      clearTimeout(room.expireTimeout);
      room.expireTimeout = null;
    }

    const result = room.join({ id: userId, name, socketId: socket.id });
    if (!result.success) return socket.emit('error_msg', result.message);

    socketPlayerMap.set(socket.id, { userId, name, roomId, gameType: 'SEKA' });
    socket.join(roomId);

    broadcastWallet(room.creator.id);
    broadcastWallet(room.joiner.id);
    broadcastSekaRoomUpdate(room);
  });

  // Play Seka against AI Bot
  socket.on('play_seka_bot', ({ userId, name, stakeAmount }) => {
    const roomId = `seka_bot_${Math.floor(1000 + Math.random() * 9000)}`;
    const room = new SekaGameRoom(roomId, { id: userId, name, socketId: socket.id }, Number(stakeAmount) || 100);
    sekaRooms.set(roomId, room);
    socketPlayerMap.set(socket.id, { userId, name, roomId, gameType: 'SEKA' });
    socket.join(roomId);

    const botId = `bot_${uuidv4().slice(0, 6)}`;
    const botResult = room.join({ id: botId, name: 'Seka Bot (AI)', socketId: null, isBot: true });
    if (!botResult.success) return socket.emit('error_msg', botResult.message);

    socket.emit('seka_room_created', { roomId });
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
      walletManager.refundEscrow(room.roomId);
      sekaRooms.delete(roomId);
    }
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
      }
    }
    socketPlayerMap.delete(socket.id);
  });
});

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
  if (room.creator && room.creator.socketId) {
    io.to(room.creator.socketId).emit('seka_game_state', room.getPublicState(room.creator.id));
  }
  if (room.joiner && room.joiner.socketId) {
    io.to(room.joiner.socketId).emit('seka_game_state', room.getPublicState(room.joiner.id));
  }
  if (room.status === 'FINISHED') {
    if (room.creator) broadcastWallet(room.creator.id);
    if (room.joiner) broadcastWallet(room.joiner.id);
  }
}

function handleSekaBotTurn(room) {
  if (!room || room.status !== 'PLAYING') return;
  const botId = (room.joiner && room.joiner.isBot) ? room.joiner.id : (room.creator && room.creator.isBot ? room.creator.id : null);
  if (!botId || room.currentTurnPlayerId !== botId) return;

  const botPlayer = new SekaBotPlayer(room, botId, 'Seka Bot (AI)');
  botPlayer.takeTurn(io, () => {
    broadcastSekaRoomUpdate(room);
    if (room.status === 'PLAYING' && room.currentTurnPlayerId === botId) {
      handleSekaBotTurn(room);
    }
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

