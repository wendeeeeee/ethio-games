// engine/smsParser.js
// Robust parser for Ethio Telecom Telebirr, CBE Birr, and CBE Bank SMS messages
// Handles English and Amharic formats

function cleanTxnId(id) {
  if (!id) return '';
  return id.trim().replace(/[.፣፤፡\s]+$/, '');
}

function parseSms(rawText, sender = '') {
  if (!rawText || typeof rawText !== 'string') return null;
  const text = rawText.trim();

  // -------------------------------------------------------------
  // 1. TELEBIRR (English)
  // "You have received 500.00 ETB from Abebe Kebede (0912345678). Transaction number is: FT240523.1425.A12345. Current balance is 5400.00 ETB."
  // -------------------------------------------------------------
  const tbEngTxn = text.match(/Transaction\s*(?:number|ID|No|no\.?|id)?(?:\s+is)?[\s:፡]+([A-Za-z0-9._-]+)/i);
  const tbEngAmt = text.match(/(?:received|credited)\s+([0-9,]+(?:\.[0-9]+)?)\s*ETB/i) || text.match(/([0-9,]+(?:\.[0-9]+)?)\s*ETB/i);
  const tbEngSender = text.match(/from\s+([^.(0-9]+)(?:\s*\(([0-9+]+)\))?/i);

  if ((sender === '127' || sender.toLowerCase().includes('telebirr') || text.toLowerCase().includes('telebirr') || text.toLowerCase().includes('transaction number')) && tbEngTxn && tbEngAmt) {
    return {
      success: true,
      method: 'telebirr',
      amount: parseFloat(tbEngAmt[1].replace(/,/g, '')),
      senderName: tbEngSender ? tbEngSender[1].trim() : '',
      senderPhone: tbEngSender && tbEngSender[2] ? tbEngSender[2].trim() : '',
      transactionId: cleanTxnId(tbEngTxn[1]),
      rawText: text
    };
  }

  // -------------------------------------------------------------
  // 2. TELEBIRR (Amharic)
  // "ከ አበበ ከበደ (0911223344) 250.00 ብር ደርሶዎታል። የግብይት ቁጥር፡ OCC7ABC123። ቀሪ ሂሳብዎ 1,250.00 ብር ነው።"
  // -------------------------------------------------------------
  const tbAmhTxn = text.match(/(?:የግብይት|ግብይት)\s*ቁጥር[\s:፡]+([A-Za-z0-9._-]+)/i);
  const tbAmhAmt = text.match(/([0-9,]+(?:\.[0-9]+)?)\s*ብር\s*ደርሶዎታ/i) || text.match(/([0-9,]+(?:\.[0-9]+)?)\s*ብር/i);
  const tbAmhSender = text.match(/ከ\s+([^(0-9]+?)(?:\s*\(([0-9+]+)\))?\s*[0-9]/i);

  if (tbAmhTxn && tbAmhAmt) {
    return {
      success: true,
      method: 'telebirr',
      amount: parseFloat(tbAmhAmt[1].replace(/,/g, '')),
      senderName: tbAmhSender ? tbAmhSender[1].trim() : '',
      senderPhone: tbAmhSender && tbAmhSender[2] ? tbAmhSender[2].trim() : '',
      transactionId: cleanTxnId(tbAmhTxn[1]),
      rawText: text
    };
  }

  // -------------------------------------------------------------
  // 3. CBE / Commercial Bank of Ethiopia (English)
  // "Dear Customer, your account 1000*** was credited with ETB 1000.00 on 23/11/2026. Ref No: CBE987654321."
  // -------------------------------------------------------------
  const cbeEngAmt = text.match(/credited\s+with\s+(?:ETB\s*)?([0-9,]+(?:\.[0-9]+)?)/i) || text.match(/ETB\s*([0-9,]+(?:\.[0-9]+)?)/i);
  const cbeEngTxn = text.match(/(?:Ref\s*(?:No|ID|no\.?)|Txn\s*ID|Transaction\s*(?:ID|number|No))[\s:.]*([A-Za-z0-9._-]+)/i);

  if (cbeEngAmt && cbeEngTxn) {
    return {
      success: true,
      method: 'cbebirr',
      amount: parseFloat(cbeEngAmt[1].replace(/,/g, '')),
      senderName: '',
      senderPhone: '',
      transactionId: cleanTxnId(cbeEngTxn[1]),
      rawText: text
    };
  }

  // -------------------------------------------------------------
  // 4. CBE / Commercial Bank of Ethiopia (Amharic)
  // "የሒሳብ ቁጥር 1000*** በ 300.00 ብር ገቢ ሆኗል። የግብይት መለያ ቁጥር፡ TXN554433"
  // -------------------------------------------------------------
  const cbeAmhAmt = text.match(/በ\s*([0-9,]+(?:\.[0-9]+)?)\s*ብር\s*ገቢ\s*ሆኗል/i) || text.match(/([0-9,]+(?:\.[0-9]+)?)\s*ብር/i);
  const cbeAmhTxn = text.match(/(?:የግብይት\s*መለያ\s*ቁጥር|መለያ\s*ቁጥር|የግብይት\s*ቁጥር)[\s:፡]+([A-Za-z0-9._-]+)/i);

  if (cbeAmhAmt && cbeAmhTxn) {
    return {
      success: true,
      method: 'cbebirr',
      amount: parseFloat(cbeAmhAmt[1].replace(/,/g, '')),
      senderName: '',
      senderPhone: '',
      transactionId: cleanTxnId(cbeAmhTxn[1]),
      rawText: text
    };
  }

  return {
    success: false,
    message: 'Could not extract transaction details from SMS',
    rawText: text
  };
}

module.exports = { parseSms, cleanTxnId };
