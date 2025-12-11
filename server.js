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
// 規則: 樓層(3-19) + 棟別(A,B,C) + 門牌
// A, C 棟: 1-3
// B 棟: 1-4
// Regex 說明:
// ^([3-9]|1[0-9]) : 3-9 或 10-19 (不補0)
// ([AC][1-3]|B[1-4])$ : (A或C接1-3) 或 (B接1-4)
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

    // 驗證戶號格式
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

  try {
    const auth = await getAuthClient();
    if (!auth) return;
    const sheets = google.sheets({ version: 'v4', auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Users!A:B', 
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) return;

    const targetUsers = rows
      .filter(row => row[1] === householdId)
      .map(row => row[0]);

    const uniqueUsers = [...new Set(targetUsers)];

    if (uniqueUsers.length > 0) {
      const message = {
        type: 'text',
        text: `📦 包裹到貨通知！\n\n戶號：${householdId}\n條碼：${barcode}\n時間：${new Date().toLocaleString('zh-TW', {hour12: false})}\n\n請盡快至管理室領取。`
      };

      await Promise.all(uniqueUsers.map(uid => lineClient.pushMessage(uid, message)));
      console.log(`已發送 Line 通知給 ${uniqueUsers.length} 位用戶`);
    }

  } catch (error) {
    console.error("Notify User Error:", error);
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
      pickupOTP: row[6],
      signatureDataURL: row[7],
      isOverdueNotified: row[8] === 'TRUE'
    })).reverse();

    res.json(packages);
  } catch (error) {
    console.error("API Error (Get Packages):", error.message);
    res.status(500).json({ error: "Fetch failed", details: error.message });
  }
});

// 新增包裹
app.post('/api/packages', async (req, res) => {
  const { householdId, barcode } = req.body;

  // 後端驗證戶號
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

    // 修改 range 為 'Packages'，讓 Google 自動判斷插入位置
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Packages', 
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

app.post('/api/packages/:id/otp', async (req, res) => {
  console.log(`Generating OTP for package ${req.params.id}`);
  res.json({ success: true });
});

app.post('/api/packages/:id/pickup', async (req, res) => {
  const { signatureDataURL } = req.body;
  const packageId = req.params.id;

  try {
    const auth = await getAuthClient();
    if (!auth) throw new Error("No Credentials");
    const sheets = google.sheets({ version: 'v4', auth });

    const list = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Packages!A:A',
    });
    
    const rowIndex = list.data.values.findIndex(r => r[0] === packageId);
    if (rowIndex === -1) throw new Error("Package not found");
    
    const sheetRow = rowIndex + 1;

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: `Packages!D${sheetRow}`, values: [['Picked Up']] },
          { range: `Packages!F${sheetRow}`, values: [[new Date().toISOString()]] },
          { range: `Packages!H${sheetRow}`, values: [[signatureDataURL]] },
          { range: `Packages!G${sheetRow}`, values: [['']] }
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
