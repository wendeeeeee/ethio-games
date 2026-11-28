// engine/telebirrVerifier.js
// Verifies Telebirr receipts directly from https://transactioninfo.ethiotelecom.et/receipt/<TXN_ID>

const RECEIVER_LAST4 = (process.env.TELEBIRR_RECEIVER_LAST4 || '5213').trim();
const RECEIVER_NAME = (process.env.TELEBIRR_RECEIVER_NAME || '').trim().toLowerCase();

/**
 * Extracts a clean Telebirr Transaction ID even if the user pastes the full receipt URL.
 */
function extractTelebirrTxnId(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') return '';
  let s = rawInput.trim();
  const urlMatch = s.match(/transactioninfo\.ethiotelecom\.et\/receipt\/([A-Za-z0-9]+)/i);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1].trim().toUpperCase();
  }
  // Strip any trailing whitespace or query/path fragments
  s = s.split(/[?#\s]/)[0].trim();
  return s.toUpperCase();
}

/**
 * Parses HTML text from Telebirr receipt page into key fields.
 */
function parseTelebirrReceiptHtml(html) {
  const flatText = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const findNextValue = (labelRegex) => {
    for (let i = 0; i < flatText.length; i++) {
      if (labelRegex.test(flatText[i])) {
        // Check if value is on the same line or the next non-empty line
        for (let j = i + 1; j < Math.min(i + 4, flatText.length); j++) {
          if (flatText[j] && !flatText[j].startsWith('-->')) {
            return flatText[j];
          }
        }
      }
    }
    return '';
  };

  const creditedPartyName = findNextValue(/Credited Party name/i);
  const creditedPartyAccount = findNextValue(/Credited party account no/i);
  const status = findNextValue(/transaction status/i);

  // Invoice table: headers are Invoice No. | Payment date | Settled Amount, followed by row values
  let invoiceNo = '';
  let paymentDate = '';
  let settledAmountRaw = '';
  for (let i = 0; i < flatText.length; i++) {
    if (/Settled Amount/i.test(flatText[i])) {
      invoiceNo = flatText[i + 1] || '';
      paymentDate = flatText[i + 2] || '';
      settledAmountRaw = flatText[i + 3] || '';
      break;
    }
  }

  const amtMatch = settledAmountRaw.replace(/,/g, '').match(/([0-9]+(?:\.[0-9]+)?)/);
  const settledAmount = amtMatch ? Number(amtMatch[1]) : NaN;

  return {
    invoiceNo: invoiceNo.trim(),
    paymentDate: paymentDate.trim(),
    settledAmount,
    settledAmountRaw: settledAmountRaw.trim(),
    creditedPartyName: creditedPartyName.trim(),
    creditedPartyAccount: creditedPartyAccount.trim(),
    status: status.trim()
  };
}

/**
 * Fetches and verifies a Telebirr receipt against expected amount and our receiver account.
 * Returns:
 *   { ok: true, receipt }
 *   { ok: false, unreachable: boolean, message: string }
 */
async function verifyTelebirrReceipt(rawTxnId, expectedAmount) {
  const txnId = extractTelebirrTxnId(rawTxnId);
  if (!txnId || txnId.length < 6 || !/^[A-Z0-9]+$/i.test(txnId)) {
    return {
      ok: false,
      unreachable: false,
      message: '⚠️ እባክዎ ትክክለኛ የTelebirr Transaction ID ያስገቡ (ለምሳሌ፡ DKS7R7QHC3)።'
    };
  }

  const url = `https://transactioninfo.ethiotelecom.et/receipt/${encodeURIComponent(txnId)}`;
  let html = '';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) {
      // Treat ANY non-200 as unreachable so deposit falls through to PENDING
      // (Render servers are outside Ethiopia and may get 403/blocked from ethiotelecom.et)
      return {
        ok: false,
        unreachable: true,
        message: `Telebirr receipt endpoint returned HTTP ${res.status}`
      };
    }
    html = await res.text();
  } catch (err) {
    return {
      ok: false,
      unreachable: true,
      message: `Telebirr receipt check timeout/error: ${err.message}`
    };
  }

  if (!html || html.length < 500 || /not found|no data|invalid/i.test(html) && !/Settled Amount/i.test(html)) {
    return {
      ok: false,
      unreachable: false,
      message: `⚠️ ይህ Transaction ID (${txnId}) ትክክለኛ የTelebirr ደረሰኝ አይደለም!`
    };
  }

  const receipt = parseTelebirrReceiptHtml(html);

  if (!receipt.invoiceNo || receipt.invoiceNo.toUpperCase() !== txnId.toUpperCase()) {
    return {
      ok: false,
      unreachable: false,
      message: `⚠️ የTelebirr ደረሰኙ (${txnId}) አልተገኘም ወይም ትክክል አይደለም!`
    };
  }

  if (!receipt.status || receipt.status.toLowerCase() !== 'completed') {
    return {
      ok: false,
      unreachable: false,
      message: `⚠️ የዚህ Transaction ID (${txnId}) ክፍያ አልተጠናቀቀም (${receipt.status || 'Unknown'})!`
    };
  }

  const acctDigits = receipt.creditedPartyAccount.replace(/\s+/g, '');
  if (!acctDigits.endsWith(RECEIVER_LAST4)) {
    return {
      ok: false,
      unreachable: false,
      message: `⚠️ ይህ ክፍያ ወደ እኛ Telebirr አካውንት (096099${RECEIVER_LAST4}) የተላከ አይደለም!`
    };
  }

  if (RECEIVER_NAME && !receipt.creditedPartyName.toLowerCase().includes(RECEIVER_NAME)) {
    return {
      ok: false,
      unreachable: false,
      message: '⚠️ የክፍያ ተቀባይ ስም ከአካውንታችን ጋር አይመሳሰልም!'
    };
  }

  const expAmt = Number(expectedAmount);
  if (!Number.isFinite(receipt.settledAmount) || Math.abs(receipt.settledAmount - expAmt) >= 0.01) {
    return {
      ok: false,
      unreachable: false,
      message: `⚠️ በደረሰኙ ላይ የተላከው ብር ${Number.isFinite(receipt.settledAmount) ? receipt.settledAmount : '?'} ETB ነው እንጂ ${expAmt} ETB አይደለም!`
    };
  }

  return { ok: true, txnId, receipt };
}

module.exports = {
  extractTelebirrTxnId,
  parseTelebirrReceiptHtml,
  verifyTelebirrReceipt
};
