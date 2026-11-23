// engine/depositManager.js
// Handles deposit requests with graceful offline/JSON fallback and Supabase sync

const fs = require('fs');
const path = require('path');
const { supabase } = require('./supabaseClient');

const DATA_FILE = path.join(__dirname, '..', 'data', 'deposits.json');

class DepositManager {
  constructor() {
    this.deposits = [];
    this.hasSupabaseTable = null; // null = untested, true/false
    this._loadFromFile();
    this._initSupabaseCheck();
  }

  _loadFromFile() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        this.deposits = JSON.parse(raw);
      }
    } catch (e) {
      this.deposits = [];
    }
  }

  _saveToFile() {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.deposits, null, 2), 'utf8');
    } catch (e) {
      console.error('[DepositManager] Error saving to file:', e.message);
    }
  }

  async _initSupabaseCheck() {
    try {
      const { data, error } = await supabase.from('deposits').select('id').limit(1);
      if (!error) {
        this.hasSupabaseTable = true;
        // Optionally load latest from Supabase
        const { data: remote } = await supabase.from('deposits').select('*').order('created_at', { ascending: false }).limit(200);
        if (remote && remote.length > 0) {
          const map = new Map();
          // Keep local first, merge remote
          this.deposits.forEach(d => map.set(String(d.id), d));
          remote.forEach(r => {
            const id = String(r.id);
            if (!map.has(id)) {
              map.set(id, {
                id: r.id,
                userId: r.user_id,
                userName: r.user_name || '',
                userPhone: r.user_phone || '',
                amount: r.amount,
                method: r.method,
                transactionId: r.transaction_id,
                status: r.status,
                adminNote: r.admin_note || '',
                createdAt: r.created_at,
                reviewedAt: r.reviewed_at
              });
            }
          });
          this.deposits = Array.from(map.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          this._saveToFile();
        }
      } else {
        this.hasSupabaseTable = false;
      }
    } catch (e) {
      this.hasSupabaseTable = false;
    }
  }

  isDuplicateTxn(transactionId) {
    if (!transactionId) return false;
    const clean = transactionId.trim().toLowerCase();
    return this.deposits.some(d => d.transactionId && d.transactionId.trim().toLowerCase() === clean && d.status !== 'REJECTED');
  }

  async createDeposit({ userId, userName = '', userPhone = '', amount, method = 'telebirr', transactionId }) {
    const txnTrimmed = transactionId.trim();
    if (this.isDuplicateTxn(txnTrimmed)) {
      throw new Error(`ይህ Transaction ID (${txnTrimmed}) ቀድሞ ገብቷል! እባክዎ ትክክለኛውን ያስገቡ።`);
    }

    const newDeposit = {
      id: 'dep_' + Date.now() + '_' + Math.floor(100 + Math.random() * 900),
      userId,
      userName: userName || '',
      userPhone: userPhone || '',
      amount: Number(amount),
      method,
      transactionId: txnTrimmed,
      status: 'PENDING',
      adminNote: '',
      createdAt: new Date().toISOString(),
      reviewedAt: null
    };

    this.deposits.unshift(newDeposit);
    this._saveToFile();

    // Fire-and-forget sync to Supabase if table exists
    if (this.hasSupabaseTable !== false) {
      supabase.from('deposits').insert({
        id: newDeposit.id,
        user_id: newDeposit.userId,
        user_name: newDeposit.userName,
        user_phone: newDeposit.userPhone,
        amount: newDeposit.amount,
        method: newDeposit.method,
        transaction_id: newDeposit.transactionId,
        status: newDeposit.status,
        created_at: newDeposit.createdAt
      }).then(() => {}).catch(() => {});
    }

    return newDeposit;
  }

  getPendingDeposits() {
    return this.deposits.filter(d => d.status === 'PENDING');
  }

  getUserDeposits(userId) {
    return this.deposits.filter(d => d.userId === userId).slice(0, 10);
  }

  getAllDeposits(limit = 100) {
    return this.deposits.slice(0, limit);
  }

  getDepositById(id) {
    return this.deposits.find(d => String(d.id) === String(id));
  }

  async approveDeposit(id, adminNote = '') {
    const deposit = this.getDepositById(id);
    if (!deposit) throw new Error('Deposit not found');
    if (deposit.status !== 'PENDING') throw new Error(`Deposit already ${deposit.status}`);

    deposit.status = 'APPROVED';
    deposit.adminNote = adminNote || 'Approved by Admin';
    deposit.reviewedAt = new Date().toISOString();

    this._saveToFile();

    // Sync to Supabase
    if (this.hasSupabaseTable !== false) {
      supabase.from('deposits').update({
        status: 'APPROVED',
        admin_note: deposit.adminNote,
        reviewed_at: deposit.reviewedAt
      }).eq('id', deposit.id).then(() => {}).catch(() => {});
    }

    return deposit;
  }

  async rejectDeposit(id, reason = 'ተቀባይነት አላገኘም (Invalid TXN)') {
    const deposit = this.getDepositById(id);
    if (!deposit) throw new Error('Deposit not found');
    if (deposit.status !== 'PENDING') throw new Error(`Deposit already ${deposit.status}`);

    deposit.status = 'REJECTED';
    deposit.adminNote = reason;
    deposit.reviewedAt = new Date().toISOString();

    this._saveToFile();

    // Sync to Supabase
    if (this.hasSupabaseTable !== false) {
      supabase.from('deposits').update({
        status: 'REJECTED',
        admin_note: deposit.adminNote,
        reviewed_at: deposit.reviewedAt
      }).eq('id', deposit.id).then(() => {}).catch(() => {});
    }

    return deposit;
  }
}

const depositManager = new DepositManager();
module.exports = depositManager;
