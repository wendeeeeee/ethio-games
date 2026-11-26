// engine/withdrawManager.js
// Handles withdraw requests with graceful offline/JSON fallback and Supabase sync

const fs = require('fs');
const path = require('path');
const { supabase } = require('./supabaseClient');

const DATA_FILE = path.join(__dirname, '..', 'data', 'withdrawals.json');

class WithdrawManager {
  constructor() {
    this.withdrawals = [];
    this.hasSupabaseTable = null; // null = untested, true/false
    this._loadFromFile();
    this._initSupabaseCheck();
  }

  _loadFromFile() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        this.withdrawals = JSON.parse(raw);
      }
    } catch (e) {
      this.withdrawals = [];
    }
  }

  _saveToFile() {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.withdrawals, null, 2), 'utf8');
    } catch (e) {
      console.error('[WithdrawManager] Error saving to file:', e.message);
    }
  }

  async _initSupabaseCheck() {
    try {
      const { error } = await supabase.from('withdrawals').select('id').limit(1);
      if (!error) {
        this.hasSupabaseTable = true;
        const { data: remote } = await supabase
          .from('withdrawals')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200);
        if (remote && remote.length > 0) {
          const map = new Map();
          this.withdrawals.forEach(w => map.set(String(w.id), w));
          remote.forEach(r => {
            const id = String(r.id);
            if (!map.has(id)) {
              map.set(id, {
                id: r.id,
                userId: r.user_id,
                userName: r.user_name || '',
                userPhone: r.user_phone || '',
                amount: r.amount,
                method: r.method || 'telebirr',
                accountNumber: r.account_number || '',
                accountName: r.account_name || '',
                status: r.status,
                payoutTxnId: r.payout_txn_id || '',
                adminNote: r.admin_note || '',
                createdAt: r.created_at,
                reviewedAt: r.reviewed_at
              });
            }
          });
          this.withdrawals = Array.from(map.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          this._saveToFile();
        }
      } else {
        this.hasSupabaseTable = false;
      }
    } catch (e) {
      this.hasSupabaseTable = false;
    }
  }

  async createWithdraw({ userId, userName = '', userPhone = '', amount, method = 'telebirr', accountNumber, accountName = '' }) {
    const newWithdraw = {
      id: 'wd_' + Date.now() + '_' + Math.floor(100 + Math.random() * 900),
      userId,
      userName: userName || '',
      userPhone: userPhone || '',
      amount: Number(amount),
      method,
      accountNumber: String(accountNumber || '').trim(),
      accountName: String(accountName || '').trim(),
      status: 'PENDING',
      payoutTxnId: '',
      adminNote: '',
      createdAt: new Date().toISOString(),
      reviewedAt: null
    };

    this.withdrawals.unshift(newWithdraw);
    this._saveToFile();

    if (this.hasSupabaseTable !== false) {
      supabase.from('withdrawals').insert({
        id: newWithdraw.id,
        user_id: newWithdraw.userId,
        user_name: newWithdraw.userName,
        user_phone: newWithdraw.userPhone,
        amount: newWithdraw.amount,
        method: newWithdraw.method,
        account_number: newWithdraw.accountNumber,
        account_name: newWithdraw.accountName,
        status: newWithdraw.status,
        created_at: newWithdraw.createdAt
      }).then(() => {}).catch(() => {});
    }

    return newWithdraw;
  }

  getPendingWithdrawals() {
    return this.withdrawals.filter(w => w.status === 'PENDING');
  }

  getUserWithdrawals(userId) {
    return this.withdrawals.filter(w => w.userId === userId).slice(0, 10);
  }

  getAllWithdrawals(limit = 150) {
    return this.withdrawals.slice(0, limit);
  }

  getWithdrawById(id) {
    return this.withdrawals.find(w => String(w.id) === String(id));
  }

  async approveWithdraw(id, payoutTxnId = '', adminNote = '') {
    const w = this.getWithdrawById(id);
    if (!w) throw new Error('Withdraw request not found');
    if (w.status !== 'PENDING') throw new Error(`Withdraw already ${w.status}`);

    w.status = 'APPROVED';
    w.payoutTxnId = String(payoutTxnId || '').trim();
    w.adminNote = adminNote || 'Paid & Approved by Admin';
    w.reviewedAt = new Date().toISOString();

    this._saveToFile();

    if (this.hasSupabaseTable !== false) {
      supabase.from('withdrawals').update({
        status: 'APPROVED',
        payout_txn_id: w.payoutTxnId,
        admin_note: w.adminNote,
        reviewed_at: w.reviewedAt
      }).eq('id', w.id).then(() => {}).catch(() => {});
    }

    return w;
  }

  async rejectWithdraw(id, adminNote = '') {
    const w = this.getWithdrawById(id);
    if (!w) throw new Error('Withdraw request not found');
    if (w.status !== 'PENDING') throw new Error(`Withdraw already ${w.status}`);

    w.status = 'REJECTED';
    w.adminNote = adminNote || 'Rejected by Admin';
    w.reviewedAt = new Date().toISOString();

    this._saveToFile();

    if (this.hasSupabaseTable !== false) {
      supabase.from('withdrawals').update({
        status: 'REJECTED',
        admin_note: w.adminNote,
        reviewed_at: w.reviewedAt
      }).eq('id', w.id).then(() => {}).catch(() => {});
    }

    return w;
  }
}

module.exports = new WithdrawManager();
