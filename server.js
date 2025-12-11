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

// --- Line Bot Configuration ---
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  channelSecret: process.env.LINE_CHANNEL_SECRET || '',
};

// 只有在設定了 Line 環境變數時才啟用 Client
const lineClient = (lineConfig.channelAccessToken && lineConfig.channelSecret) 
  ? new Client(lineConfig) 
  : null;

// 注意：Line 的 middleware 需要 raw body，所以我們調整 middleware 的順序
// 如果請求路徑是 /callback，使用 Line middleware，否則使用 express.json
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

// 處理 Line Webhook 事件
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

  // 簡單的指令解析： "綁定 [戶號]"
  if (userMessage.startsWith('綁定') || userMessage.toLowerCase().startsWith('reg')) {
    const parts = userMessage.split(' ');
    if (parts.length < 2) {
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: '指令格式錯誤。請輸入：「綁定 您的戶號」，例如：「綁定 11A1」'
      });
    }

    const householdId = parts[1].toUpperCase();
    await registerLineUser(userId, householdId);

    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: `綁定成功！\n戶號：${householdId}\n\n當有包裹送達時，您將會收到 Line 通知。`
    });
  }

  // 預設回應
  return lineClient.replyMessage(event.replyToken, {
    type: 'text',
    text: '您好！我是社區包裹小幫手。\n請輸入「綁定 戶號」來接收到貨通知。\n例如：綁定 11A1'
  });
}

// 將 Line User 寫入 Google Sheet (Users 分頁)
async function registerLineUser(lineUserId, householdId) {
  try {
    const auth = await getAuthClient();
    if (!auth) return;
    const sheets = google.sheets({ version: 'v4', auth });
    
    // 寫入 Users 分頁: LineID, HouseholdID, CreatedAt
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

// 根據戶號查找 Line User ID 並發送通知
async function notifyUser(householdId, barcode) {
  if (!lineClient) return;

  try {
    const auth = await getAuthClient();
    if (!auth) return;
    const sheets = google.sheets({ version: 'v4', auth });

    // 讀取 Users 分頁
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Users!A:B', // A: LineID, B: HouseholdId
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) return;

    // 找出所有符合該戶號的 Line ID (可能有多人綁定同一戶)
    const targetUsers = rows
      .filter(row => row[1] === householdId)
      .map(row => row[0]); // row[0] is LineUserId

    // 移除重複 ID
    const uniqueUsers = [...new Set(targetUsers)];

    if (uniqueUsers.length > 0) {
      const message = {
        type: 'text',
        text: `📦 包裹到貨通知！\n\n戶號：${householdId}\n條碼：${barcode}\n時間：${new Date().toLocaleString('zh-TW', {hour12: false})}\n\n請盡快至管理室領取。`
      };

      // 逐一發送 (Line Multicast 也可以，但這裡用 Loop 簡單處理)
      await Promise.all(uniqueUsers.map(uid => lineClient.pushMessage(uid, message)));
      console.log(`已發送 Line 通知給 ${uniqueUsers.length} 位用戶 (戶號: ${householdId})`);
    } else {
      console.log(`戶號 ${householdId} 尚未綁定 Line 帳號`);
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

// 新增包裹 (包含 Line 通知邏輯)
app.post('/api/packages', async (req, res) => {
  const { householdId, barcode } = req.body;
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

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Packages!A:I',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [newPackage] },
    });

    // --- 觸發 Line 通知 ---
    // 不等待通知結果直接回傳 API 成功，避免前端轉圈圈
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
