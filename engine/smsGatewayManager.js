// engine/smsGatewayManager.js
// Manages incoming SMS payment notifications and handles automatic matching with user deposits

const fs = require('fs');
const path = require('path');
const { parseSms, cleanTxnId } = require('./smsParser');

const DATA_FILE = path.join(__dirname, '..', 'data', 'incoming_payments.json');

class SmsGatewayManager {
  constructor() {
    this.payments = [];
    this.secretKey = process.env.SMS_GATEWAY_SECRET || 'wende3428_sms_secret';
    this._loadFromFile();
  }

  _loadFromFile() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        this.payments = JSON.parse(raw);
      }
    } catch (e) {
      this.payments = [];
    }
  }

  _saveToFile() {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.payments, null, 2), 'utf8');
    } catch (e) {
      console.error('[SmsGatewayManager] Error saving to file:', e.message);
    }
  }

  // Record an incoming payment (from raw SMS or structured JSON)
  processIncomingSms({ text, sender = '', transactionId = '', amount = 0, senderPhone = '', senderName = '', method = 'telebirr' }) {
    let paymentData = null;

    if (text) {
      const parsed = parseSms(text, sender);
      if (parsed && parsed.success) {
        paymentData = parsed;
      }
    }

    const txnId = cleanTxnId(transactionId || (paymentData ? paymentData.transactionId : ''));
    const parsedAmount = Number(amount || (paymentData ? paymentData.amount : 0));
    const parsedMethod = method || (paymentData ? paymentData.method : 'telebirr');
    const phone = senderPhone || (paymentData ? paymentData.senderPhone : '');
    const name = senderName || (paymentData ? paymentData.senderName : '');

    if (!txnId || parsedAmount <= 0) {
      return {
        success: false,
        message: 'Could not extract valid Transaction ID or Amount from SMS',
        rawText: text
      };
    }

    // Check if this transaction was already recorded
    const existing = this.payments.find(p => p.transactionId.toLowerCase() === txnId.toLowerCase());
    if (existing) {
      return {
        success: true,
        isDuplicate: true,
        payment: existing,
        message: 'Payment already recorded'
      };
    }

    const newPayment = {
      id: 'pay_' + Date.now() + '_' + Math.floor(100 + Math.random() * 900),
      transactionId: txnId,
      amount: parsedAmount,
      method: parsedMethod,
      senderPhone: phone,
      senderName: name,
      rawText: text || '',
      status: 'UNCLAIMED', // UNCLAIMED | CLAIMED
      claimedBy: null,
      claimedAt: null,
      receivedAt: new Date().toISOString()
    };

    this.payments.unshift(newPayment);
    this._saveToFile();

    return {
      success: true,
      isNew: true,
      payment: newPayment
    };
  }

  // Find an unclaimed payment by Transaction ID
  findUnclaimedPayment(transactionId) {
    if (!transactionId) return null;
    const clean = cleanTxnId(transactionId).toLowerCase();
    return this.payments.find(p => p.transactionId.toLowerCase() === clean && p.status === 'UNCLAIMED') || null;
  }

  // Claim a payment for a user
  claimPayment(transactionId, userId) {
    const payment = this.findUnclaimedPayment(transactionId);
    if (!payment) return null;

    payment.status = 'CLAIMED';
    payment.claimedBy = userId;
    payment.claimedAt = new Date().toISOString();
    this._saveToFile();

    return payment;
  }

  // Get all payments (for admin overview)
  getAllPayments(limit = 100) {
    return this.payments.slice(0, limit);
  }

  // Get stats
  getStats() {
    const unclaimed = this.payments.filter(p => p.status === 'UNCLAIMED');
    const claimed = this.payments.filter(p => p.status === 'CLAIMED');
    const totalReceived = this.payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    return {
      totalCount: this.payments.length,
      unclaimedCount: unclaimed.length,
      claimedCount: claimed.length,
      totalReceivedETB: totalReceived,
      lastReceivedAt: this.payments.length > 0 ? this.payments[0].receivedAt : null
    };
  }
}

const smsGatewayManager = new SmsGatewayManager();
module.exports = smsGatewayManager;
