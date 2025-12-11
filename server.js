import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import { Client, middleware } from '@line/bot-sdk';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Validation Logic ---
function validateHouseholdId(id) {
  if (!id) return false;
  const regex = /^([3-9]|1[0-9])([AC][1-3]|B[1-4])$/;
  return regex.test(id);
}

// --- Line Bot Configuration ---
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  channelSecret: process.env.LINE_CHANNEL_SECRET || '',
};

const lineClient = (lineConfig.channelAccessToken && lineConfig.channelSecret) 
  ? new Client(lineConfig) 
  : null;

app.use('/callback', middleware(lineConfig));
app.use(express.json());
app.use(cors());

// Health Check
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// --- Google Sheets Configuration ---
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

async function getAuthClient() {
  const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;
  
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    console.warn("缺少 Google Credentials");
    return null;
  }

  try {
    const jwt = new google.auth.JWT(
      GOOGLE_SERVICE_ACCOUNT_EMAIL,
      null,
      GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      SCOPES
    );
    await jwt.authorize();
    return jwt;
  } catch (error) {
    console.error("Google Auth Error:", error.message);
    return null;
  }
}

// --- Helper: Find Line User IDs by Household ---
async function getLineUsersByHousehold(householdId) {
  try {
    const auth = await getAuthClient();
    if (!auth) return [];
    const sheets = google.sheets({ version: 'v4', auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Users!A:B', 
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) return [];

    const targetUsers = rows
      .filter(row => row[1] === householdId)
      .map(row => row[0]);

    return [...new Set(targetUsers)];
  } catch (error) {
    console.error("Get Line Users Error:", error);
    return [];
  }
}

// --- Line Bot Webhook & Logic ---
app.post('/callback', async (req, res) => {
  if (!lineClient) return res.status(500).end();

  try {
    const events = req.body.events;
    await Promise.all(events.map(handleLineEvent));
    res.json({});
  } catch (err) {
    console.error('Line Webhook Error:', err);
    res.status(500).end();
  }
});

async function handleLineEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const userMessage = event.message.text.trim();
  const userId = event.source.userId;

  if (userMessage.startsWith('綁定') || userMessage.toLowerCase().startsWith('reg')) {
    const parts = userMessage.split(' ');
    if (parts.length < 2) {
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: '指令格式錯誤。請輸入：「綁定 您的戶號」，例如：「綁定 11A1」'
      });
    }

    const householdId = parts[1].toUpperCase();

    if (!validateHouseholdId(householdId)) {
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: `戶號格式錯誤！\n\n規則：\n1. 樓層 3-19 (不需補0)\n2. 棟別 A, B, C (大寫)\n3. A/C棟門牌 1-3；B棟門牌 1-4\n\n範例：11A1, 3B4`
      });
    }

    await registerLineUser(userId, householdId);

    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: `綁定成功！\n戶號：${householdId}\n\n當有包裹送達時，您將會收到 Line 通知。`
    });
  }

  return lineClient.replyMessage(event.replyToken, {
    type: 'text',
    text: '您好！我是社區包裹小幫手。\n請輸入「綁定 戶號」來接收到貨通知。\n例如：綁定 11A1'
  });
}

async function registerLineUser(lineUserId, householdId) {
  try {
    const auth = await getAuthClient();
    if (!auth) return;
    const sheets = google.sheets({ version: 'v4', auth });
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Users!A:C',
      valueInputOption: 'USER_ENTERED',
      requestBody: { 
        values: [[lineUserId, householdId, new Date().toISOString()]] 
      },
    });
  } catch (error) {
    console.error("Register User Error:", error);
  }
}

async function notifyUser(householdId, barcode) {
  if (!lineClient) return;

  const uniqueUsers = await getLineUsersByHousehold(householdId);

  if (uniqueUsers.length > 0) {
    const message = {
      type: 'text',
      text: `📦 包裹到貨通知！\n\n戶號：${householdId}\n條碼：${barcode}\n時間：${new Date().toLocaleString('zh-TW', {hour12: false})}\n\n請盡快至管理室領取。`
    };

    await Promise.all(uniqueUsers.map(uid => lineClient.pushMessage(uid, message)));
    console.log(`已發送 Line 通知給 ${uniqueUsers.length} 位用戶`);
  }
}

// --- API Routes ---

app.get('/api/packages', async (req, res) => {
  try {
    const auth = await getAuthClient();
    if (!auth) throw new Error("No Credentials");

    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Packages!A:I',
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) return res.json([]);

    const packages = rows.slice(1).map(row => ({
      packageId: row[0],
      barcode: row[1],
      householdId: row[2],
      status: row[3],
      receivedTime: row[4],
      pickupTime: row[5],
      pickupOTP: row[6] ? row[6].split(':')[0] : '', // Hide expiry from frontend
      signatureDataURL: row[7],
      isOverdueNotified: row[8] === 'TRUE'
    })).reverse();

    res.json(packages);
  } catch (error) {
    console.error("API Error (Get Packages):", error.message);
    res.status(500).json({ error: "Fetch failed", details: error.message });
  }
});

app.post('/api/packages', async (req, res) => {
  const { householdId, barcode } = req.body;

  if (!validateHouseholdId(householdId)) {
    return res.status(400).json({ error: "戶號格式錯誤。請確認：樓層3-19、棟別A/B/C、門牌1-4。" });
  }

  try {
    const auth = await getAuthClient();
    if (!auth) throw new Error("No Credentials");

    const sheets = google.sheets({ version: 'v4', auth });
    const newPackage = [
      `PKG${Date.now()}`,
      barcode,
      householdId,
      'Pending',
      new Date().toISOString(),
      '',
      '',
      '',
      'FALSE'
    ];

    // FIX: 明確指定 Range 為 A:I，強制從第一欄開始寫入
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Packages!A:I', 
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [newPackage] },
    });

    notifyUser(householdId, barcode).catch(err => console.error("Async Notify Error:", err));

    res.json({ success: true, packageId: newPackage[0] });
  } catch (error) {
    console.error("API Error (Add Package):", error.message);
    res.status(500).json({ error: "Add failed" });
  }
});

// 生成 OTP 並發送 Line
app.post('/api/packages/:id/otp', async (req, res) => {
  const packageId = req.params.id;
  console.log(`Generating OTP for package ${packageId}`);

  try {
    const auth = await getAuthClient();
    if (!auth) throw new Error("No Credentials");
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Find the package row
    const list = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Packages!A:C', // Get ID, Barcode, Household
    });

    const rows = list.data.values;
    const rowIndex = rows.findIndex(r => r[0] === packageId);
    if (rowIndex === -1) return res.status(404).json({ error: "Package not found" });

    const householdId = rows[rowIndex][2];
    const sheetRow = rowIndex + 1;

    // 2. Generate OTP and Expiry
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = Date.now() + 5 * 60 * 1000; // 5 minutes
    const storedValue = `${otp}:${expiry}`;

    // 3. Save to Sheet (Column G / Index 6)
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `Packages!G${sheetRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[storedValue]] }
    });

    // 4. Send Line Notification
    if (lineClient) {
      const users = await getLineUsersByHousehold(householdId);
      if (users.length > 0) {
        const message = {
          type: 'text',
          text: `🔐 領取驗證碼通知\n\n戶號：${householdId}\n包裹ID：${packageId}\n\n您的驗證碼為：【${otp}】\n\n有效期限為 5 分鐘，請出示給櫃台人員。`
        };
        await Promise.all(users.map(uid => lineClient.pushMessage(uid, message)));
        console.log(`OTP Sent to ${users.length} users`);
      } else {
        console.log("No Line user found for this household");
      }
    }

    res.json({ success: true });

  } catch (error) {
    console.error("OTP Error:", error);
    res.status(500).json({ error: "Failed to generate/send OTP" });
  }
});

// 驗證 OTP 並完成領取
app.post('/api/packages/:id/pickup', async (req, res) => {
  const { otp: inputOtp, signatureDataURL } = req.body;
  const packageId = req.params.id;

  try {
    const auth = await getAuthClient();
    if (!auth) throw new Error("No Credentials");
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Find the package row and current OTP
    const list = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Packages!A:G', // Need Status(D) and OTP(G)
    });
    
    const rows = list.data.values;
    const rowIndex = rows.findIndex(r => r[0] === packageId);
    if (rowIndex === -1) return res.status(404).json({ error: "Package not found" });

    const sheetRow = rowIndex + 1;
    const storedData = rows[rowIndex][6] || ""; // Column G is OTP
    
    // 2. Verify OTP
    if (!storedData.includes(':')) {
       return res.status(400).json({ error: "OTP invalid or not generated" });
    }

    const [validOtp, expiryStr] = storedData.split(':');
    const expiry = parseInt(expiryStr);

    if (inputOtp !== validOtp) {
      return res.status(400).json({ error: "驗證碼錯誤" });
    }

    if (Date.now() > expiry) {
      return res.status(400).json({ error: "驗證碼已過期，請重新發送" });
    }

    // 3. Update Sheet: Status, PickupTime, Clear OTP, Save Signature
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: `Packages!D${sheetRow}`, values: [['Picked Up']] }, // Status
          { range: `Packages!F${sheetRow}`, values: [[new Date().toISOString()]] }, // PickupTime
          { range: `Packages!G${sheetRow}`, values: [['']] }, // Clear OTP
          { range: `Packages!H${sheetRow}`, values: [[signatureDataURL]] } // Signature
        ]
      }
    });

    res.json({ success: true });
  } catch (error) {
    console.error("API Error (Pickup):", error.message);
    res.status(500).json({ error: "Pickup failed" });
  }
});

// --- Serve Frontend ---
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  console.log("No dist folder found. Running in API-only mode or build failed.");
  app.get('/', (req, res) => {
    res.send('Server is running, but frontend build not found.');
  });
}

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
