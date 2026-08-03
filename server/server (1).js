/**
 * HimalPay Bank Transfer - Server
 * ---------------------------------
 * Serves index.html and proxies the 3-step HimalPay bank transfer flow:
 *   1. List banks               -> BANK_TRANSFER_LIST
 *   2. Verify destination acc.  -> BANK_TRANSFER_VERIFICATION
 *   3. Calculate charge         -> reseller-calculate-cashback-and-charge
 *   4. Process transfer         -> BANK_TRANSFER (payment)
 *   5. Check transaction status -> wallet-service-reseller-status
 *
 * Requires Node.js 18+ (uses the built-in global fetch).
 *
 * Setup:
 *   npm init -y
 *   npm install express
 *   node server.js
 *
 * Then open http://localhost:7890
 */

const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(__dirname)); // serves index.html from the same folder

// ------------------------------------------------------------------
// CONFIG - fill in your HimalPay API key below
// ------------------------------------------------------------------
const HIMALPAY_BASE_URL = "https://uatapi.himalpay.com.np/api/v1";
const HIMALPAY_API_KEY = "e479cc2b-af36-459e-8585-c42f6dcc1f2a"; // <-- put your HimalPay API key here
// ------------------------------------------------------------------

const PORT = 7890;

/**
 * Small helper to call the HimalPay API.
 */
async function himalpayRequest(method, endpoint, body) {
  const res = await fetch(`${HIMALPAY_BASE_URL}${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": HIMALPAY_API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    data = { raw: text };
  }

  return { status: res.status, ok: res.ok, data };
}

function generateMerchantTxnId() {
  return `TXN-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

// ------------------------------------------------------------------
// 1. List available banks (BANK_TRANSFER_LIST)
// ------------------------------------------------------------------
app.get("/api/banks", async (req, res) => {
  try {
    const result = await himalpayRequest(
      "POST",
      "/details/wallet-service-reseller-detail",
      { wallet_service_name: "BANK_TRANSFER_LIST" }
    );
    res.status(result.status).json(result.data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch bank list", details: err.message });
  }
});

// ------------------------------------------------------------------
// 2. Verify destination account (BANK_TRANSFER_VERIFICATION)
// ------------------------------------------------------------------
app.post("/api/verify-account", async (req, res) => {
  try {
    const { bank_code, account_name, account_number, is_mobile } = req.body;

    if (!bank_code || !account_name || !account_number) {
      return res.status(400).json({ error: "bank_code, account_name and account_number are required" });
    }

    const merchant_txn_id = generateMerchantTxnId();

    const result = await himalpayRequest(
      "POST",
      "/details/wallet-service-reseller-detail",
      {
        wallet_service_name: "BANK_TRANSFER_VERIFICATION",
        data: {
          bank_code,
          account_name,
          account_number,
          merchant_txn_id,
          is_mobile: is_mobile === "y" ? "y" : "n",
        },
      }
    );

    res.status(result.status).json({ merchant_txn_id, ...result.data });
  } catch (err) {
    res.status(500).json({ error: "Failed to verify account", details: err.message });
  }
});

// ------------------------------------------------------------------
// 3. Calculate charge/cashback for a BANK_TRANSFER amount
// ------------------------------------------------------------------
app.post("/api/calculate-charge", async (req, res) => {
  try {
    const { amount } = req.body; // amount in paisa

    if (!amount) {
      return res.status(400).json({ error: "amount (in paisa) is required" });
    }

    const result = await himalpayRequest(
      "POST",
      "/details/reseller-calculate-cashback-and-charge",
      {
        wallet_service_name: "BANK_TRANSFER",
        amount,
      }
    );

    res.status(result.status).json(result.data);
  } catch (err) {
    res.status(500).json({ error: "Failed to calculate charge", details: err.message });
  }
});

// ------------------------------------------------------------------
// 4. Process the bank transfer payment (BANK_TRANSFER)
// ------------------------------------------------------------------
app.post("/api/transfer", async (req, res) => {
  try {
    const {
      amount, // in paisa
      destination_bank,
      destination_acc_no,
      destination_acc_name,
      is_destination_mobile,
      transaction_remarks,
      transaction_remarks_2,
      transaction_remarks_3,
    } = req.body;

    if (!amount || !destination_bank || !destination_acc_no || !destination_acc_name) {
      return res.status(400).json({
        error: "amount, destination_bank, destination_acc_no and destination_acc_name are required",
      });
    }

    const merchant_transaction_id = generateMerchantTxnId();

    const result = await himalpayRequest(
      "POST",
      "/payments/wallet-service-reseller-payment",
      {
        wallet_service_name: "BANK_TRANSFER",
        amount,
        merchant_transaction_id,
        data: {
          destination_bank,
          destination_acc_no,
          destination_acc_name,
          is_destination_mobile: is_destination_mobile === "y" ? "y" : "n",
          transaction_remarks: transaction_remarks || "Fund Transfer",
          transaction_remarks_2: transaction_remarks_2 || "",
          transaction_remarks_3: transaction_remarks_3 || "",
        },
      }
    );

    res.status(result.status).json({ merchant_transaction_id, ...result.data });
  } catch (err) {
    res.status(500).json({ error: "Failed to process transfer", details: err.message });
  }
});

// ------------------------------------------------------------------
// 5. Check transaction status
// ------------------------------------------------------------------
app.post("/api/status", async (req, res) => {
  try {
    const { merchant_transaction_id } = req.body;

    if (!merchant_transaction_id) {
      return res.status(400).json({ error: "merchant_transaction_id is required" });
    }

    const result = await himalpayRequest(
      "POST",
      "/transactions/wallet-service-reseller-status",
      { merchant_transaction_id }
    );

    res.status(result.status).json(result.data);
  } catch (err) {
    res.status(500).json({ error: "Failed to check status", details: err.message });
  }
});

// ------------------------------------------------------------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const HOST = "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`HimalPay Bank Transfer server running at http://localhost:${PORT}`);
  if (!HIMALPAY_API_KEY) {
    console.warn("⚠️  HIMALPAY_API_KEY is empty. Set it in server.js before making real requests.");
  }
});
