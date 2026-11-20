// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const GameRoom = require('./engine/gameRoom');
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
// Socket to player map: { socketId: { userId, roomId } }
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

app.get('/api/rooms', (req, res) => {
  const list = [];
  rooms.forEach((room) => {
    if (room.status === 'WAITING') {
      list.push({
        roomId: room.roomId,
        creatorName: room.creator.name,
        stakeAmount: room.stakeAmount
      });
    }
  });
  res.json(list);
});

// Socket.io Events
io.on('connection', (socket) => {
  // Join Lobby / Register Player
  socket.on('register_user', ({ userId, name }) => {
    socketPlayerMap.set(socket.id, { userId, name });
    const wallet = walletManager.getWallet(userId, name);
    socket.emit('wallet_update', wallet);
  });

  // Create Table
  socket.on('create_room', ({ userId, name, stakeAmount }) => {
    const roomId = `room_${Math.floor(1000 + Math.random() * 9000)}`;
    const room = new GameRoom(roomId, { id: userId, name, socketId: socket.id }, Number(stakeAmount) || 100);
    rooms.set(roomId, room);
    socketPlayerMap.set(socket.id, { userId, name, roomId });

    socket.join(roomId);
    socket.emit('room_created', { roomId });
    broadcastRoomUpdate(room);
  });

  // Join Table
  socket.on('join_room', ({ roomId, userId, name }) => {
    const room = rooms.get(roomId);
    if (!room) return socket.emit('error_msg', 'Room not found');

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
      // Bot always picks 'high' for simplicity
      room.setJokerHighLow(botId, 'high');
      broadcastRoomUpdate(room);
    }, 1500);
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

  socket.on('disconnect', () => {
    const playerInfo = socketPlayerMap.get(socket.id);
    if (playerInfo && playerInfo.roomId) {
      const room = rooms.get(playerInfo.roomId);
      if (room && room.status === 'WAITING') {
        walletManager.refundEscrow(room.roomId);
        rooms.delete(playerInfo.roomId);
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` Ethiopian Conquer Card & Betting Server Running!`);
  console.log(` URL: http://localhost:${PORT}`);
  console.log(`====================================================`);
});

