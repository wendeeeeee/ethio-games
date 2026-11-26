// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { randomUUID: uuidv4 } = require('crypto');

const GameRoom = require('./engine/gameRoom');
const { SekaGameRoom, SekaBotPlayer } = require('./engine/sekaGameRoom');
const walletManager = require('./engine/walletManager');
const depositManager = require('./engine/depositManager');
const withdrawManager = require('./engine/withdrawManager');
const smsGatewayManager = require('./engine/smsGatewayManager');
const { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } = require('./engine/supabaseClient');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory rooms: { roomId: GameRoom }
const rooms = new Map();
// In-memory Seka rooms: { roomId: SekaGameRoom }
const sekaRooms = new Map();
// Socket to player map: { socketId: { userId, roomId, gameType } }
const socketPlayerMap = new Map();

// Prevent transient async errors (e.g. Supabase network hiccups) from crashing the server
process.on('unhandledRejection', (reason) => {
  console.error('[UnhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[UncaughtException]', err);
});

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, uptime: process.uptime() });
});

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

    // 1. Check if this payment was ALREADY received via SMS Gateway!
    const unclaimedPayment = smsGatewayManager.findUnclaimedPayment(txnTrimmed);
    if (unclaimedPayment && unclaimedPayment.amount >= num) {
      // Claim the payment
      smsGatewayManager.claimPayment(txnTrimmed, userId);

      // Create deposit record directly as APPROVED
      const deposit = await depositManager.createDeposit({
        userId,
        userName,
        userPhone,
        amount: num,
        method: unclaimedPayment.method || methodName,
        transactionId: txnTrimmed
      });
      await depositManager.approveDeposit(deposit.id, 'Auto-approved via SMS Gateway matching');

      // Credit user's wallet
      const wallet = walletManager.deposit(userId, num);

      // Broadcast socket events for instant update
      io.emit(`wallet_${userId}`, wallet);
      io.emit(`deposit_approved_${userId}`, { amount: num, transactionId: txnTrimmed });
      io.emit('deposit_status_changed', { id: deposit.id, status: 'APPROVED' });

      return res.json({
        success: true,
        status: 'APPROVED',
        instant: true,
        wallet,
        deposit,
        message: `🎉 ${num.toLocaleString()} ETB በቴሌብር SMS ተረጋግጦ ወዲያውኑ ገቢ ተደርጓል!`
      });
    }

    // 2. Otherwise create PENDING deposit (waiting for SMS or manual admin review)
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

// SMS Gateway Webhook: receives SMS notifications from Android phone
app.post('/api/sms/webhook', async (req, res) => {
  const secret = req.headers['x-sms-secret'] || req.query.secret || (req.body ? req.body.secret : '');
  if (secret !== 'wende3428_sms_secret' && !isAdminAuthorized(secret)) {
    return res.status(403).json({ success: false, message: 'Invalid SMS webhook secret' });
  }

  const text = req.body.text || req.body.message || req.body.body || req.body.content || req.body.msg || '';
  const sender = req.body.sender || req.body.from || req.body.phone || req.body.senderPhone || '';
  const transactionId = req.body.transactionId || req.body.txnId || '';
  const amount = req.body.amount || 0;

  console.log('[SMS Webhook Received]:', { text, sender, raw: req.body });

  // Handle Android app test clicks (e.g. "This is a test message from SMS Forwarder")
  const isTestPing = !transactionId && (!text || text.toLowerCase().includes('test') || text.includes('[msg]') || text.length < 15);

  try {
    const result = smsGatewayManager.processIncomingSms({
      text,
      sender,
      transactionId,
      amount,
      senderPhone: req.body.senderPhone || '',
      senderName: req.body.senderName || '',
      method: req.body.method || 'telebirr'
    });

    if (!result.success) {
      if (isTestPing) {
        return res.json({
          success: true,
          isTest: true,
          message: '✅ Connection Successful! Webhook is ready to receive Telebirr SMS.'
        });
      }
      return res.status(400).json(result);
    }

    const payment = result.payment;

    // Auto-Match: Check if a user is already waiting for this Transaction ID!
    const pendingDeposit = depositManager.findPendingByTxn(payment.transactionId);
    let autoMatched = false;

    if (pendingDeposit && payment.status === 'UNCLAIMED' && payment.amount >= pendingDeposit.amount) {
      autoMatched = true;
      await depositManager.approveDeposit(pendingDeposit.id, 'Auto-approved via SMS Gateway Webhook');
      smsGatewayManager.claimPayment(payment.transactionId, pendingDeposit.userId);
      const wallet = walletManager.deposit(pendingDeposit.userId, pendingDeposit.amount);

      io.emit(`wallet_${pendingDeposit.userId}`, wallet);
      io.emit(`deposit_approved_${pendingDeposit.userId}`, {
        amount: pendingDeposit.amount,
        transactionId: payment.transactionId
      });
      io.emit('deposit_status_changed', { id: pendingDeposit.id, status: 'APPROVED' });
    }

    // Broadcast new payment notification to admin dashboard
    io.emit('new_sms_payment', payment);

    res.json({
      success: true,
      isNew: result.isNew,
      payment,
      autoMatched
    });
  } catch (err) {
    console.error('[SMS Webhook Error]:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin: Get all SMS Gateway payments & stats
app.get('/api/admin/sms/payments', (req, res) => {
  const adminKey = req.query.adminKey || req.headers['x-admin-key'];
  if (!isAdminAuthorized(adminKey)) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }
  const payments = smsGatewayManager.getAllPayments(100);
  const stats = smsGatewayManager.getStats();
  res.json({ success: true, payments, stats });
});

// Admin: Simulate an incoming SMS (for easy testing without real money)
app.post('/api/admin/sms/simulate', async (req, res) => {
  const { adminKey, amount, transactionId, senderPhone, senderName } = req.body;
  if (!isAdminAuthorized(adminKey)) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }

  const amt = Number(amount) || 100;
  const txn = transactionId || ('FT_SIM_' + Date.now().toString().slice(-6));
  const simPhone = senderPhone || '0911223344';
  const simName = senderName || 'Abebe Kebede';

  const simText = `You have received ${amt.toFixed(2)} ETB from ${simName} (${simPhone}). Transaction number is: ${txn}. Current balance is 5,000.00 ETB.`;

  const result = smsGatewayManager.processIncomingSms({
    text: simText,
    sender: '127',
    transactionId: txn,
    amount: amt,
    senderPhone: simPhone,
    senderName: simName,
    method: 'telebirr'
  });

  // Check auto-match
  const pendingDeposit = depositManager.findPendingByTxn(txn);
  if (pendingDeposit && result.payment && result.payment.status === 'UNCLAIMED') {
    await depositManager.approveDeposit(pendingDeposit.id, 'Auto-approved via SMS Gateway Simulator');
    smsGatewayManager.claimPayment(txn, pendingDeposit.userId);
    const wallet = walletManager.deposit(pendingDeposit.userId, pendingDeposit.amount);

    io.emit(`wallet_${pendingDeposit.userId}`, wallet);
    io.emit(`deposit_approved_${pendingDeposit.userId}`, {
      amount: pendingDeposit.amount,
      transactionId: txn
    });
    io.emit('deposit_status_changed', { id: pendingDeposit.id, status: 'APPROVED' });
  }

  io.emit('new_sms_payment', result.payment);
  res.json({ success: true, payment: result.payment, simText });
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

// Submit a Withdraw Request (locks balance immediately until admin approves/rejects)
const MIN_WITHDRAW_ETB = 100;
app.post('/api/wallet/withdraw', async (req, res) => {
  const { userId, amount, method, accountNumber, accountName } = req.body;
  const num = Number(amount);
  if (!userId || !Number.isFinite(num) || num < MIN_WITHDRAW_ETB || num > 50000) {
    return res.status(400).json({
      success: false,
      message: `ዝቅተኛው የማውጫ መጠን ${MIN_WITHDRAW_ETB} ETB ነው (ከ ${MIN_WITHDRAW_ETB} እስከ 50,000 ETB)`
    });
  }
  const cleanAcc = String(accountNumber || '').trim();
  if (cleanAcc.length < 6) {
    return res.status(400).json({ success: false, message: 'እባክዎ ትክክለኛ ስልክ ቁጥር ወይም የባንክ አካውንት ያስገቡ' });
  }
  const cleanMethod = method === 'cbe' ? 'cbe' : 'telebirr';

  try {
    const lockRes = walletManager.lockForWithdraw(userId, num);
    if (!lockRes.success) {
      return res.status(400).json({ success: false, message: lockRes.message || 'በቂ ሂሳብ የለዎትም' });
    }

    const userWallet = lockRes.wallet;
    let withdraw;
    try {
      withdraw = await withdrawManager.createWithdraw({
        userId,
        userName: (userWallet && userWallet.name) ? userWallet.name : '',
        userPhone: (userWallet && userWallet.phone) ? userWallet.phone : '',
        amount: num,
        method: cleanMethod,
        accountNumber: cleanAcc,
        accountName: String(accountName || '').trim()
      });
    } catch (createErr) {
      // Refund if creating the withdraw record fails
      walletManager.refundWithdraw(userId, num);
      throw createErr;
    }

    io.emit(`wallet_${userId}`, userWallet);
    io.emit('new_withdraw_request', withdraw);

    res.json({
      success: true,
      withdraw,
      wallet: userWallet,
      message: `✅ የ ${num.toLocaleString()} ETB Withdraw ጥያቄዎ ተልኳል! Admin ካረጋገጠ በኋላ ብርዎ ይላክልዎታል።`
    });
  } catch (err) {
    console.error('[Withdraw] Error:', err.message);
    res.status(400).json({ success: false, message: err.message });
  }
});

// Get user's withdraw history
app.get('/api/wallet/withdrawals/:userId', (req, res) => {
  try {
    const list = withdrawManager.getUserWithdrawals(req.params.userId);
    res.json({ success: true, withdrawals: list });
  } catch (err) {
    res.json({ success: true, withdrawals: [] });
  }
});

// Helper: check admin auth
function isAdminAuthorized(key) {
  return key === 'wende3428@D' || key === 'wende3428' || key === 'ethio-games-admin-2024';
}

// Admin: Login endpoint (validates username & password)
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const u = (username || '').trim();
  const p = (password || '').trim();
  if (
    u === 'wondewossenbefikaduabebe' &&
    (p === 'wende3428@D' || p === 'wende3428')
  ) {
    return res.json({ success: true, adminKey: 'wende3428@D', username: u });
  }
  return res.status(401).json({ success: false, message: 'Invalid admin username or password' });
});

// Admin: List pending deposits
// Admin: Get all registered users and their balances
app.get('/api/admin/users', async (req, res) => {
  const adminKey = req.query.adminKey || req.headers['x-admin-key'];
  if (!isAdminAuthorized(adminKey)) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }
  try {
    const users = await walletManager.getAllUsersForAdmin();
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

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

// Admin: List all withdrawals
app.get('/api/admin/withdrawals/all', (req, res) => {
  const adminKey = req.query.adminKey || req.headers['x-admin-key'];
  if (!isAdminAuthorized(adminKey)) {
    return res.status(403).json({ success: false, message: 'Unauthorized. Invalid admin key.' });
  }
  const all = withdrawManager.getAllWithdrawals(150);
  res.json({ success: true, withdrawals: all });
});

// Admin: Approve a withdraw (finalizes locked balance after payout)
app.post('/api/admin/withdraw/approve', async (req, res) => {
  const { withdrawId, adminKey, payoutTxnId, note } = req.body;
  if (!isAdminAuthorized(adminKey)) {
    return res.status(403).json({ success: false, message: 'Unauthorized. Invalid admin key.' });
  }

  try {
    const w = await withdrawManager.approveWithdraw(withdrawId, payoutTxnId, note);
    const wallet = walletManager.completeWithdraw(w.userId, w.amount, w.method, w.accountNumber);

    io.emit(`wallet_${w.userId}`, wallet);
    io.emit(`withdraw_approved_${w.userId}`, {
      withdrawId: w.id,
      amount: w.amount,
      method: w.method,
      accountNumber: w.accountNumber,
      payoutTxnId: w.payoutTxnId
    });
    io.emit('withdraw_status_changed', { id: w.id, status: 'APPROVED' });

    res.json({ success: true, withdraw: w, wallet });
  } catch (err) {
    console.error('[Admin Withdraw Approve] Error:', err.message);
    res.status(400).json({ success: false, message: err.message });
  }
});

// Admin: Reject a withdraw (refunds locked amount back to user balance)
app.post('/api/admin/withdraw/reject', async (req, res) => {
  const { withdrawId, adminKey, reason } = req.body;
  if (!isAdminAuthorized(adminKey)) {
    return res.status(403).json({ success: false, message: 'Unauthorized. Invalid admin key.' });
  }

  try {
    const w = await withdrawManager.rejectWithdraw(withdrawId, reason || 'የተሰጠው መረጃ ትክክል አይደለም / አልተሳካም');
    const wallet = walletManager.refundWithdraw(w.userId, w.amount);

    io.emit(`wallet_${w.userId}`, wallet);
    io.emit(`withdraw_rejected_${w.userId}`, {
      withdrawId: w.id,
      amount: w.amount,
      reason: w.adminNote
    });
    io.emit('withdraw_status_changed', { id: w.id, status: 'REJECTED' });

    res.json({ success: true, withdraw: w, wallet });
  } catch (err) {
    console.error('[Admin Withdraw Reject] Error:', err.message);
    res.status(400).json({ success: false, message: err.message });
  }
});

// Fast favicon response to prevent 404
app.get('/favicon.ico', (req, res) => res.status(204).end());

// REST API for User Registration & Profile
app.post('/api/user/register', async (req, res) => {
  const { userId, name, phone, password } = req.body;
  try {
    const wallet = await walletManager.registerUser({
      name,
      phone,
      password: password || '1234',
      userId
    });
    res.json({ success: true, wallet });
  } catch (err) {
    console.error('[User Register Error]:', err.message);
    res.status(400).json({ success: false, message: err.message });
  }
});

// REST API for User Login
app.post('/api/user/login', async (req, res) => {
  const { phone, password } = req.body;
  try {
    const wallet = await walletManager.loginUser({ phone, password });
    res.json({
      success: true,
      wallet,
      user: { id: wallet.id, name: wallet.name, phone: wallet.phone, balance: wallet.balance }
    });
  } catch (err) {
    console.error('[User Login Error]:', err.message);
    res.status(400).json({ success: false, message: err.message });
  }
});

app.get('/api/user/profile/:userId', async (req, res) => {
  const wallet = await walletManager.getWalletAsync(req.params.userId);
  res.json({ success: true, wallet });
});

app.get('/api/rooms', (req, res) => {
  const list = [];
  const now = Date.now();
  rooms.forEach((room, rId) => {
    if (room.status === 'WAITING') {
      if (room.expiresAt && now >= room.expiresAt) {
        room.status = 'EXPIRED';
        if (room.expireTimeout) clearTimeout(room.expireTimeout);
        walletManager.refundEscrow(room.roomId);
        if (room.creator && room.creator.id) broadcastWallet(room.creator.id);
        rooms.delete(rId);
        return;
      }
      const expiresIn = room.expiresAt ? Math.max(0, Math.round((room.expiresAt - now) / 1000)) : 60;
      list.push({
        roomId: room.roomId,
        creatorName: room.creator.name,
        stakeAmount: room.stakeAmount,
        maxPlayers: room.maxPlayers || 2,
        playersCount: room.players ? room.players.length : 1,
        expiresIn
      });
    }
  });
  res.json(list);
});

// REST API for Seka Rooms
app.get('/api/seka/rooms', (req, res) => {
  const list = [];
  const now = Date.now();
  sekaRooms.forEach((room, rId) => {
    if (room.status === 'WAITING') {
      if (room.expiresAt && now >= room.expiresAt) {
        room.status = 'EXPIRED';
        if (room.expireTimeout) clearTimeout(room.expireTimeout);
        walletManager.refundEscrow(room.roomId);
        if (room.creator && room.creator.id) broadcastWallet(room.creator.id);
        sekaRooms.delete(rId);
        return;
      }
      const expiresIn = room.expiresAt ? Math.max(0, Math.round((room.expiresAt - now) / 1000)) : 60;
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

// Recent winners feed (shown below Create Game in lobbies)
const recentWinners = [];
function recordRecentWinner(room, gameType) {
  if (!room || room.status !== 'FINISHED' || room._winnerRecorded) return;
  room._winnerRecorded = true;
  const winnerId = (room.winner && typeof room.winner === 'object') ? room.winner.id : room.winner;
  if (!winnerId) return;
  const players = room.players || [room.creator, room.joiner].filter(Boolean);
  const wObj = players.find(p => p && p.id === winnerId);
  const winnerName = (room.winner && typeof room.winner === 'object' && room.winner.name)
    ? room.winner.name
    : (wObj ? wObj.name : 'ተጫዋች');
  const pot = Number(room.pot) || 0;
  const stake = Number(room.stakeAmount) || 0;
  const rake = Math.floor(Math.max(0, pot - stake) * 0.10);
  const netWin = pot - rake;
  recentWinners.unshift({
    roomId: room.roomId,
    gameType,
    winnerName,
    netWin,
    pot,
    stake,
    wonAt: Date.now()
  });
  if (recentWinners.length > 15) recentWinners.pop();
  io.emit('recent_winners_updated', recentWinners);
}

app.get('/api/recent-winners', (req, res) => {
  res.json(recentWinners);
});

// Socket.io Events
io.on('connection', (socket) => {
  // Join Lobby / Check Registered Player (never auto-creates unauthenticated users)
  socket.on('register_user', async ({ userId, name, phone }) => {
    socketPlayerMap.set(socket.id, { userId, name, phone });
    const wallet = await walletManager.findRegisteredUser(userId, phone);
    if (wallet) {
      socket.emit('wallet_update', wallet);
    } else {
      socket.emit('user_not_registered');
    }
  });

  // Update Profile
  socket.on('update_profile', async ({ userId, name, phone }) => {
    socketPlayerMap.set(socket.id, { userId, name, phone });
    const wallet = await walletManager.updateProfileAsync(userId, { name, phone });
    socket.emit('wallet_update', wallet);
  });

  // Create Table
  socket.on('create_room', ({ userId, name, stakeAmount, maxPlayers }) => {
    const stake = Math.floor(Number(stakeAmount) || 0);
    const numPlayers = Math.min(4, Math.max(2, Number(maxPlayers) || 2));
    if (stake < 5) {
      return socket.emit('error_msg', '⚠️ ዝቅተኛው የውርርድ መጠን 5 ብር ነው!');
    }
    const userWallet = walletManager.getWallet(userId);
    if (!userWallet || userWallet.balance < stake) {
      const bal = userWallet ? userWallet.balance : 0;
      return socket.emit('error_msg', `⚠️ በቂ balance የለዎትም! ያለዎት ሂሳብ ${bal.toLocaleString()} ETB ሲሆን የውርርድ መጠኑ ${stake.toLocaleString()} ETB ነው።`);
    }

    // 1. Clean up any existing waiting room created by this user
    rooms.forEach((r, rId) => {
      if (r.status === 'WAITING' && r.creator && r.creator.id === userId) {
        if (r.expireTimeout) clearTimeout(r.expireTimeout);
        walletManager.refundEscrow(r.roomId);
        rooms.delete(rId);
      }
    });
    sekaRooms.forEach((r, rId) => {
      if (r.status === 'WAITING' && r.creator && r.creator.id === userId) {
        if (r.expireTimeout) clearTimeout(r.expireTimeout);
        walletManager.refundEscrow(r.roomId);
        sekaRooms.delete(rId);
      }
    });

    const roomId = `room_${Math.floor(1000 + Math.random() * 9000)}`;
    const room = new GameRoom(roomId, { id: userId, name, socketId: socket.id }, stake, numPlayers);
    attachConquerRoomCallbacks(room);
    room.createdAt = Date.now();
    room.expiresAt = Date.now() + 60 * 1000; // 1-minute expiration if no opponent joins
    room.expireTimeout = setTimeout(() => {
      if (room.status === 'WAITING') {
        room.status = 'EXPIRED';
        walletManager.refundEscrow(room.roomId);
        if (room.creator && room.creator.id) {
          broadcastWallet(room.creator.id);
        }
        const expiredMsg = '⏳ በ 60 ሰከንድ ውስጥ ተጋጣሚ ስላልገባ ጨዋታው ተሰርዟል! አሁን አዲስ ጨዋታ መፍጠር ይችላሉ።';
        io.to(roomId).emit('room_expired', { roomId, message: expiredMsg });
        socketPlayerMap.forEach((p, sId) => {
          if (p.userId === (room.creator && room.creator.id)) {
            io.to(sId).emit('room_expired', { roomId, message: expiredMsg });
            if (p.roomId === roomId) p.roomId = null;
          }
        });
        rooms.delete(roomId);
        io.emit('rooms_updated');
      }
    }, 60 * 1000);

    rooms.set(roomId, room);
    socketPlayerMap.set(socket.id, { userId, name, roomId });

    socket.join(roomId);
    socket.emit('room_created', { roomId, expiresAt: room.expiresAt });
    io.emit('rooms_updated');
    broadcastRoomUpdate(room);
  });

  // Leave Conquer Waiting Room
  socket.on('leave_room', ({ roomId, userId }) => {
    const room = rooms.get(roomId);
    if (room && room.status === 'WAITING') {
      if (room.expireTimeout) clearTimeout(room.expireTimeout);
      walletManager.refundEscrow(room.roomId);
      rooms.delete(roomId);
      io.emit('rooms_updated');
      if (userId) broadcastWallet(userId);
      const pInfo = socketPlayerMap.get(socket.id);
      if (pInfo && pInfo.roomId === roomId) pInfo.roomId = null;
    }
  });

  // Join Table
  socket.on('join_room', ({ roomId, userId, name }) => {
    const room = rooms.get(roomId);
    if (!room || room.status === 'EXPIRED') return socket.emit('error_msg', 'Room expired or not found');

    const userWallet = walletManager.getWallet(userId);
    if (!userWallet || userWallet.balance < room.stakeAmount) {
      const bal = userWallet ? userWallet.balance : 0;
      return socket.emit('error_msg', `⚠️ በቂ balance የለዎትም! ያለዎት ሂሳብ ${bal.toLocaleString()} ETB ሲሆን የውርርድ መጠኑ ${room.stakeAmount.toLocaleString()} ETB ነው።`);
    }

    const result = room.join({ id: userId, name, socketId: socket.id });
    if (!result.success) return socket.emit('error_msg', result.message);

    if (room.players.length >= room.maxPlayers && room.expireTimeout) {
      clearTimeout(room.expireTimeout);
      room.expireTimeout = null;
    }

    socketPlayerMap.set(socket.id, { userId, name, roomId });
    socket.join(roomId);

    // Update wallet states for all players once table is full & escrow locked
    if (!result.waitingForMore) {
      for (const p of room.players) {
        if (p && p.id) broadcastWallet(p.id);
      }
    }

    io.emit('rooms_updated');
    broadcastRoomUpdate(room);
  });

  // Play Against AI Bot (Single Player mode for instant testing)
  socket.on('play_vs_bot', ({ userId, name, stakeAmount }) => {
    const stake = Math.floor(Number(stakeAmount) || 0);
    if (stake < 5) {
      return socket.emit('error_msg', '⚠️ ዝቅተኛው የውርርድ መጠን 5 ብር ነው!');
    }
    const userWallet = walletManager.getWallet(userId);
    if (!userWallet || userWallet.balance < stake) {
      const bal = userWallet ? userWallet.balance : 0;
      return socket.emit('error_msg', `⚠️ በቂ balance የለዎትም! ያለዎት ሂሳብ ${bal.toLocaleString()} ETB ሲሆን የውርርድ መጠኑ ${stake.toLocaleString()} ETB ነው።`);
    }

    const roomId = `bot_room_${Math.floor(1000 + Math.random() * 9000)}`;
    const room = new GameRoom(roomId, { id: userId, name, socketId: socket.id }, stake);
    attachConquerRoomCallbacks(room);
    rooms.set(roomId, room);
    socketPlayerMap.set(socket.id, { userId, name, roomId });
    socket.join(roomId);

    const botId = `bot_${uuidv4().slice(0, 6)}`;
    const botResult = room.join({ id: botId, name: 'Abebe (AI Bot)', socketId: null });
    if (!botResult.success) return socket.emit('error_msg', botResult.message);

    broadcastWallet(userId);
    // Bot is Joiner, so Bot automatically calls High/Low after 1.5 seconds
    broadcastRoomUpdate(room);

    setTimeout(() => {
      // Bot picks randomly among 'high', 'low', 'gon'
      const botChoices = ['high', 'low', 'gon'];
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

    if (res.reshuffled) {
      io.to(roomId).emit('deck_reshuffled', {
        message: '🔄 ዴኩ አልቋል! መሬት ላይ ያሉት ካርታዎች እየተበወዙ ነው...'
      });
    }
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

  // Client notifies server when visible 60s turn timer hits 0s
  socket.on('check_conquer_timeout', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room && room.status === 'PLAYING') {
      room.checkTurnTimeout();
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
    const stake = Math.floor(Number(stakeAmount) || 0);
    if (stake < 5) {
      return socket.emit('error_msg', '⚠️ ዝቅተኛው የውርርድ መጠን 5 ብር ነው!');
    }
    const userWallet = walletManager.getWallet(userId);
    if (!userWallet || userWallet.balance < stake) {
      const bal = userWallet ? userWallet.balance : 0;
      return socket.emit('error_msg', `⚠️ በቂ balance የለዎትም! ያለዎት ሂሳብ ${bal.toLocaleString()} ETB ሲሆን የውርርድ መጠኑ ${stake.toLocaleString()} ETB ነው። እባክዎ መጀመሪያ Deposit ያድርጉ ወይም አነስ ያለ ውርርድ ይምረጡ።`);
    }

    // 1. Clean up any existing waiting room created by this user
    sekaRooms.forEach((r, rId) => {
      if (r.status === 'WAITING' && r.creator && r.creator.id === userId) {
        if (r.expireTimeout) clearTimeout(r.expireTimeout);
        walletManager.refundEscrow(r.roomId);
        sekaRooms.delete(rId);
      }
    });
    rooms.forEach((r, rId) => {
      if (r.status === 'WAITING' && r.creator && r.creator.id === userId) {
        if (r.expireTimeout) clearTimeout(r.expireTimeout);
        walletManager.refundEscrow(r.roomId);
        rooms.delete(rId);
      }
    });

    const roomId = `seka_${Math.floor(1000 + Math.random() * 9000)}`;
    const numPlayers = Number(maxPlayers) === 3 ? 3 : 2;
    const room = new SekaGameRoom(roomId, { id: userId, name, socketId: socket.id }, stake, numPlayers);
    attachSekaRoomCallbacks(room);
    room.createdAt = Date.now();
    room.expiresAt = Date.now() + 60 * 1000; // 1-minute expiration if no opponent joins
    room.expireTimeout = setTimeout(() => {
      if (room.status === 'WAITING') {
        room.status = 'EXPIRED';
        walletManager.refundEscrow(room.roomId);
        if (room.creator && room.creator.id) {
          broadcastWallet(room.creator.id);
        }
        const expiredMsg = '⏳ በ 60 ሰከንድ ውስጥ ተጋጣሚ ስላልገባ የሴካ ጨዋታው ተሰርዟል! አሁን አዲስ ጨዋታ መፍጠር ይችላሉ።';
        io.to(roomId).emit('room_expired', { roomId, message: expiredMsg });
        socketPlayerMap.forEach((p, sId) => {
          if (p.userId === (room.creator && room.creator.id)) {
            io.to(sId).emit('room_expired', { roomId, message: expiredMsg });
            if (p.roomId === roomId) p.roomId = null;
          }
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

    const stake = room.stakeAmount || 100;
    const userWallet = walletManager.getWallet(userId);
    if (!userWallet || userWallet.balance < stake) {
      const bal = userWallet ? userWallet.balance : 0;
      return socket.emit('error_msg', `⚠️ በቂ balance የለዎትም! ያለዎት ሂሳብ ${bal.toLocaleString()} ETB ሲሆን የውርርድ መጠኑ ${stake.toLocaleString()} ETB ነው። እባክዎ መጀመሪያ Deposit ያድርጉ።`);
    }

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
    const stake = Math.floor(Number(stakeAmount) || 0);
    if (stake < 5) {
      return socket.emit('error_msg', '⚠️ ዝቅተኛው የውርርድ መጠን 5 ብር ነው!');
    }
    const userWallet = walletManager.getWallet(userId);
    if (!userWallet || userWallet.balance < stake) {
      const bal = userWallet ? userWallet.balance : 0;
      return socket.emit('error_msg', `⚠️ በቂ balance የለዎትም! ያለዎት ሂሳብ ${bal.toLocaleString()} ETB ሲሆን የውርርድ መጠኑ ${stake.toLocaleString()} ETB ነው። እባክዎ መጀመሪያ Deposit ያድርጉ ወይም አነስ ያለ ውርርድ ይምረጡ።`);
    }

    const roomId = `seka_bot_${Math.floor(1000 + Math.random() * 9000)}`;
    const room = new SekaGameRoom(roomId, { id: userId, name, socketId: socket.id }, stake);
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
      const pInfo = socketPlayerMap.get(socket.id);
      if (pInfo && pInfo.roomId === roomId) pInfo.roomId = null;
    }
  });

  // Player temporarily leaves playing table (1-minute return window)
  socket.on('leave_seka_table_temp', ({ roomId, userId }) => {
    const sRoom = sekaRooms.get(roomId);
    if (sRoom && sRoom.status === 'PLAYING') {
      sRoom.playerLeaveTemp(userId, sRoom.onLeaveTimeoutCallback);
      broadcastSekaRoomUpdate(sRoom);
      return;
    }
    const cRoom = rooms.get(roomId);
    if (cRoom && cRoom.status === 'PLAYING') {
      cRoom.playerLeaveTemp(userId, cRoom.onLeaveTimeoutCallback);
      broadcastRoomUpdate(cRoom);
    }
  });

  // Player returns to table within 1-minute window
  socket.on('return_to_seka_table', ({ roomId, userId }) => {
    const sRoom = sekaRooms.get(roomId);
    if (sRoom) {
      sRoom.playerReturn(userId);
      socket.join(roomId);
      broadcastSekaRoomUpdate(sRoom);
      return;
    }
    const cRoom = rooms.get(roomId);
    if (cRoom) {
      cRoom.playerReturn(userId);
      socket.join(roomId);
      broadcastRoomUpdate(cRoom);
    }
  });

  // Handle automatic reconnection on page refresh (F5 / reload)
  socket.on('reconnect_active_game', ({ roomId, userId }) => {
    if (!roomId || !userId) return;
    const sRoom = sekaRooms.get(roomId);
    if (sRoom) {
      const isPlayer = sRoom.players && sRoom.players.some(p => p.id === userId);
      if (isPlayer && (sRoom.status === 'PLAYING' || sRoom.status === 'WAITING')) {
        sRoom.playerReturn(userId);
        const p = sRoom.players.find(p => p.id === userId);
        if (p) p.socketId = socket.id;
        if (sRoom.creator && sRoom.creator.id === userId) sRoom.creator.socketId = socket.id;
        if (sRoom.joiner && sRoom.joiner.id === userId) sRoom.joiner.socketId = socket.id;
        socketPlayerMap.set(socket.id, { userId, name: p ? p.name : '', roomId, gameType: 'SEKA' });
        socket.join(roomId);
        socket.emit('seka_reconnect_success', { roomId, status: sRoom.status });
        socket.emit('seka_game_state', sRoom.getPublicState(userId));
        broadcastSekaRoomUpdate(sRoom);
        return;
      }
    }
    const cRoom = rooms.get(roomId);
    if (cRoom) {
      const pObj = cRoom.players ? cRoom.players.find(p => p.id === userId) : null;
      const isPlayer = !!pObj || (cRoom.creator && cRoom.creator.id === userId) || (cRoom.joiner && cRoom.joiner.id === userId);
      if (isPlayer && (cRoom.status === 'PLAYING' || cRoom.status === 'WAITING' || cRoom.status === 'CUTTING_JOKER')) {
        cRoom.playerReturn(userId);
        if (pObj) pObj.socketId = socket.id;
        if (cRoom.creator && cRoom.creator.id === userId) cRoom.creator.socketId = socket.id;
        if (cRoom.joiner && cRoom.joiner.id === userId) cRoom.joiner.socketId = socket.id;
        const pName = pObj ? pObj.name : ((cRoom.creator && cRoom.creator.id === userId) ? cRoom.creator.name : (cRoom.joiner ? cRoom.joiner.name : ''));
        socketPlayerMap.set(socket.id, { userId, name: pName, roomId, gameType: 'CONQUER' });
        socket.join(roomId);
        socket.emit('conquer_reconnect_success', { roomId, status: cRoom.status });
        socket.emit('game_state', cRoom.getClientState(userId));
        broadcastRoomUpdate(cRoom);
        return;
      }
    }
    socket.emit('active_room_expired', { roomId });
  });

  socket.on('disconnect', () => {
    const playerInfo = socketPlayerMap.get(socket.id);
    if (playerInfo && playerInfo.roomId) {
      const sRoom = sekaRooms.get(playerInfo.roomId);
      if (sRoom && sRoom.status === 'PLAYING') {
        sRoom.playerLeaveTemp(playerInfo.userId, sRoom.onLeaveTimeoutCallback);
        broadcastSekaRoomUpdate(sRoom);
      }
      const cRoom = rooms.get(playerInfo.roomId);
      if (cRoom && cRoom.status === 'PLAYING') {
        cRoom.playerLeaveTemp(playerInfo.userId, cRoom.onLeaveTimeoutCallback);
        broadcastRoomUpdate(cRoom);
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

function attachConquerRoomCallbacks(room) {
  room.onTurnTimeoutCallback = (r, winner, loser, gameFinished = true) => {
    for (const p of (r.players || [])) {
      if (p && p.id) broadcastWallet(p.id);
    }
    broadcastRoomUpdate(r);
    if (gameFinished) {
      io.to(r.roomId).emit('player_timed_out', {
        winnerName: winner ? winner.name : 'Opponent',
        loserName: loser ? loser.name : 'Player',
        message: `⏰ ${loser ? loser.name : 'ተጫዋች'} በ1 ደቂቃ ውስጥ ካርታ ስላልጣለ ተሸንፏል! ${winner ? winner.name : 'ተጋጣሚ'} አሸነፈ!`
      });
    } else {
      io.to(r.roomId).emit('player_eliminated', {
        loserName: loser ? loser.name : 'Player',
        message: `⏰ ${loser ? loser.name : 'ተጫዋች'} በ1 ደቂቃ ውስጥ ካርታ ስላልጣለ ተሸንፎ ወጥቷል! ቀሪዎቹ ተጫዋቾች ይቀጥላሉ!`
      });
    }
  };
  room.onLeaveTimeoutCallback = (r, winner, loser, gameFinished = true) => {
    for (const p of (r.players || [])) {
      if (p && p.id) broadcastWallet(p.id);
    }
    broadcastRoomUpdate(r);
    if (gameFinished) {
      io.to(r.roomId).emit('player_abandoned', {
        winnerName: winner ? winner.name : 'Opponent',
        loserName: loser ? loser.name : 'Player',
        message: `❌ ${loser ? loser.name : 'ተጫዋች'} በ1 ደቂቃ ውስጥ ስላልተመለሰ ተሸንፏል! ${winner ? winner.name : 'ተጋጣሚ'} አሸነፈ!`
      });
    } else {
      io.to(r.roomId).emit('player_eliminated', {
        loserName: loser ? loser.name : 'Player',
        message: `❌ ${loser ? loser.name : 'ተጫዋች'} በ1 ደቂቃ ውስጥ ስላልተመለሰ ተሸንፎ ወጥቷል! ቀሪዎቹ ተጫዋቾች ይቀጥላሉ!`
      });
    }
  };
}

// Broadcast room state individually to players (hiding opponent's cards)
function broadcastRoomUpdate(room) {
  const players = room.players || [room.creator, room.joiner].filter(Boolean);
  for (const p of players) {
    if (p && p.socketId) {
      io.to(p.socketId).emit('game_state', room.getClientState(p.id));
    }
  }
  if (room.status === 'FINISHED') {
    recordRecentWinner(room, 'CONQUER');
    for (const p of players) {
      if (p && p.id) broadcastWallet(p.id);
    }
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
    recordRecentWinner(room, 'SEKA');
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
  socketPlayerMap.forEach((p, sId) => {
    if (p.userId === userId) {
      io.to(sId).emit('wallet_update', wallet);
    }
  });
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

// Proactive background interval to expire waiting rooms older than 60 seconds
setInterval(() => {
  const now = Date.now();
  let changed = false;

  sekaRooms.forEach((room, rId) => {
    if (room.status === 'WAITING' && room.expiresAt && now >= room.expiresAt) {
      room.status = 'EXPIRED';
      if (room.expireTimeout) clearTimeout(room.expireTimeout);
      walletManager.refundEscrow(room.roomId);
      if (room.creator && room.creator.id) {
        broadcastWallet(room.creator.id);
      }
      const expiredMsg = '⏳ በ 60 ሰከንድ ውስጥ ተጋጣሚ ስላልገባ የሴካ ጨዋታው ተሰርዟል! አሁን አዲስ ጨዋታ መፍጠር ይችላሉ።';
      io.to(room.roomId).emit('room_expired', { roomId: room.roomId, message: expiredMsg });
      socketPlayerMap.forEach((p, sId) => {
        if (p.roomId === room.roomId) {
          io.to(sId).emit('room_expired', { roomId: room.roomId, message: expiredMsg });
          p.roomId = null;
        }
      });
      sekaRooms.delete(rId);
      changed = true;
    }
  });

  rooms.forEach((room, rId) => {
    if (room.status === 'WAITING' && room.expiresAt && now >= room.expiresAt) {
      room.status = 'EXPIRED';
      if (room.expireTimeout) clearTimeout(room.expireTimeout);
      walletManager.refundEscrow(room.roomId);
      if (room.creator && room.creator.id) {
        broadcastWallet(room.creator.id);
      }
      const expiredMsg = '⏳ በ 60 ሰከንድ ውስጥ ተጋጣሚ ስላልገባ ጨዋታው ተሰርዟል!';
      io.to(room.roomId).emit('room_expired', { roomId: room.roomId, message: expiredMsg });
      socketPlayerMap.forEach((p, sId) => {
        if (p.roomId === room.roomId) {
          io.to(sId).emit('room_expired', { roomId: room.roomId, message: expiredMsg });
          p.roomId = null;
        }
      });
      rooms.delete(rId);
      changed = true;
    }
  });

  if (changed) {
    io.emit('rooms_updated');
  }
}, 2000);

// Start server only when NOT running on Vercel (Vercel uses serverless)
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(` Ethiopian Conquer Card & Betting Server Running!`);
    console.log(` URL: http://localhost:${PORT}`);
    console.log(`====================================================`);
  });
}

module.exports = app;

