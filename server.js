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

// Middleware for Line Webhook
app.use('/callback', middleware(lineConfig));

// Middleware for JSON body parsing
app.use(express.json());

// CORS configuration
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

// Helper: Get Sheet ID (GID) by Title
async function getSheetId(sheets, spreadsheetId, title) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const sheet = meta.data.sheets.find(s => s.properties.title === title);
    return sheet ? sheet.properties.sheetId : null;
}

// --- Admin Initialization ---
async function checkAndSeedAdmin() {
  try {
    const auth = await getAuthClient();
    if (!auth) return;
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // Check if admin sheet has data
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'admin!A:B', 
    });

    const rows = response.data.values || [];
    
    // If empty (or just header), seed default admin
    const hasAdmin = rows.some(r => r[0] === 'admin');

    if (!hasAdmin) {
      console.log("Seeding default admin account...");
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'admin!A:B',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [['admin', 'admin']] // Default credentials
        }
      });
    }
  } catch (error) {
    // console.warn("Admin Sheet Check Failed (Normal if sheet doesn't exist yet):", error.message);
  }
}

// Run admin check on startup (Note: In serverless, this runs on every cold start)
checkAndSeedAdmin();

// --- Helper: Find Line User IDs ---
async function getLineUsersByHousehold(householdId, recipientName = null) {
  try {
    const auth = await getAuthClient();
    if (!auth) return [];
    const sheets = google.sheets({ version: 'v4', auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Users!A:C', // A:LineID, B:Household, C:Name
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) return [];

    const targetUsers = rows
      .filter(row => {
        const matchHousehold = row[1] === householdId;
        const matchName = recipientName ? row[2] === recipientName : true;
        return matchHousehold && matchName;
      })
      .map(row => row[0]);

    return [...new Set(targetUsers)];
  } catch (error) {
    console.error("Get Line Users Error:", error);
    return [];
  }
}

// --- Helper: Generate Unique OTP (4 Digits) ---
function generateUniqueOTP(existingOtps) {
    let otp;
    let isUnique = false;
    let attempts = 0;
    
    while (!isUnique && attempts < 10) {
        otp = Math.floor(1000 + Math.random() * 9000).toString();
        const collision = existingOtps.some(entry => entry && entry.startsWith(otp + ':'));
        if (!collision) {
            isUnique = true;
        }
        attempts++;
    }
    return otp;
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

  // 1. Handle Registration
  if (userMessage.startsWith('綁定') || userMessage.toLowerCase().startsWith('reg')) {
    const parts = userMessage.split(/\s+/); 
    if (parts.length < 3) {
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: '指令格式：\n請輸入：「綁定 您的戶號 您的姓名」\n例如：「綁定 11A1 王小明」'
      });
    }

    const householdId = parts[1].toUpperCase();
    const userName = parts[2];

    if (!validateHouseholdId(householdId)) {
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: `戶號格式錯誤！\n\n規則：\n1. 樓層 3-19 (不需補0)\n2. 棟別 A, B, C (大寫)\n3. A/C棟門牌 1-3；B棟門牌 1-4\n\n範例：11A1, 3B4`
      });
    }

    const result = await registerLineUser(userId, householdId, userName);
    
    if (!result.success) {
         return lineClient.replyMessage(event.replyToken, {
            type: 'text',
            text: result.message
          });
    }

    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: `綁定成功！\n戶號：${householdId}\n姓名：${userName}\n\n當有您的包裹送達時，將會收到通知。`
    });
  }

  // 2. Handle Pickup Request
  if (['領取', 'pickup', '取件'].includes(userMessage.toLowerCase())) {
      return handleUserPickupRequest(event, userId);
  }

  // 3. Handle Check Request
  if (['查詢', '查詢包裹', 'check', 'query'].includes(userMessage.toLowerCase())) {
      return handleUserQueryPackages(event, userId);
  }

  return lineClient.replyMessage(event.replyToken, {
    type: 'text',
    text: '您好！我是社區包裹小幫手。\n\n指令列表：\n1. 「綁定 戶號 姓名」\n2. 「查詢包裹」: 查看待領清單\n3. 「領取」: 產生取件驗證碼'
  });
}

// Logic functions (Same as before, abbreviated for clarity, but logic preserved)
async function handleUserQueryPackages(event, userId) {
    // ... logic remains same ...
    try {
        const auth = await getAuthClient();
        if (!auth) return;
        const sheets = google.sheets({ version: 'v4', auth });
        const userResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:C' });
        const userRows = userResp.data.values || [];
        const user = userRows.find(r => r[0] === userId);

        if (!user) {
            return lineClient.replyMessage(event.replyToken, { type: 'text', text: '您尚未綁定戶號，請先輸入「綁定 戶號 姓名」' });
        }
        const householdId = user[1];
        const pkgResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!A:J' });
        const pkgRows = pkgResp.data.values || [];
        const pendingPkgs = pkgRows.slice(1).filter(r => r[2] === householdId && r[3] === 'Pending');

        if (pendingPkgs.length === 0) {
            return lineClient.replyMessage(event.replyToken, { type: 'text', text: `查詢結果：${householdId}\n\n目前沒有待領取的包裹。` });
        }
        let replyText = `查詢結果：${householdId}\n待領包裹共 ${pendingPkgs.length} 件：\n`;
        pendingPkgs.forEach((pkg, index) => {
            const barcode = pkg[1];
            const date = new Date(pkg[4]);
            const dateStr = `${(date.getMonth()+1)}/${date.getDate()}`;
            const recipient = pkg[9] ? `(${pkg[9]})` : '';
            const shortCode = barcode.length > 5 ? `...${barcode.slice(-5)}` : barcode;
            replyText += `\n${index + 1}. [${dateStr}] ${shortCode} ${recipient}`;
        });
        replyText += `\n\n輸入「領取」可獲取驗證碼。`;
        return lineClient.replyMessage(event.replyToken, { type: 'text', text: replyText });
    } catch (e) {
        console.error("Query Package Error", e);
        return lineClient.replyMessage(event.replyToken, { type: 'text', text: '系統忙碌中' });
    }
}

async function handleUserPickupRequest(event, userId) {
    // ... logic remains same ...
    try {
        const auth = await getAuthClient();
        if (!auth) return;
        const sheets = google.sheets({ version: 'v4', auth });
        const userResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:E' });
        const userRows = userResp.data.values || [];
        const userRowIndex = userRows.findIndex(r => r[0] === userId);

        if (userRowIndex === -1) {
            return lineClient.replyMessage(event.replyToken, { type: 'text', text: '您尚未綁定戶號，請先輸入「綁定 戶號 姓名」' });
        }
        const householdId = userRows[userRowIndex][1];
        const userName = userRows[userRowIndex][2];
        const allOtps = userRows.map(r => r[4]).filter(val => val);
        const pkgResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!B:D' });
        const pkgRows = pkgResp.data.values || [];
        const pendingCount = pkgRows.filter(r => r[1] === householdId && r[2] === 'Pending').length;

        if (pendingCount === 0) {
            return lineClient.replyMessage(event.replyToken, { type: 'text', text: `查詢結果：${householdId} (${userName})\n\n目前沒有您的待領包裹。` });
        }
        const otp = generateUniqueOTP(allOtps);
        const expiry = Date.now() + 10 * 60 * 1000;
        const otpString = `${otp}:${expiry}`;
        const sheetRow = userRowIndex + 1;
        await sheets.spreadsheets.values.update({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `Users!E${sheetRow}`, valueInputOption: 'USER_ENTERED', requestBody: { values: [[otpString]] } });

        return lineClient.replyMessage(event.replyToken, { type: 'text', text: `🔐 取件驗證碼：【 ${otp} 】\n\n待領包裹：${pendingCount} 件\n有效時間：10 分鐘\n\n請將此號碼出示給管理室人員。` });
    } catch (e) {
        console.error("Handle Pickup Error", e);
        return lineClient.replyMessage(event.replyToken, { type: 'text', text: '系統繁忙中，請稍後再試。' });
    }
}

async function registerLineUser(lineUserId, householdId, name) {
    // ... logic remains same ...
    try {
        const auth = await getAuthClient();
        if (!auth) return { success: false, message: "System Error" };
        const sheets = google.sheets({ version: 'v4', auth });
        const existing = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:C' });
        const rows = existing.data.values || [];
        const isDuplicate = rows.some(row => row[1] === householdId && row[2] === name);
        if (isDuplicate) return { success: false, message: `綁定失敗：住戶「${name}」已在戶號「${householdId}」綁定過。` };
        await sheets.spreadsheets.values.append({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:A', valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS', requestBody: { values: [[lineUserId, householdId, name, new Date().toISOString(), '']] } });
        return { success: true };
    } catch (error) {
        console.error("Register User Error:", error);
        return { success: false, message: "系統連線錯誤，請稍後再試。" };
    }
}

async function notifyUser(householdId, barcode, recipientName = null) {
  if (!lineClient) return;
  const uniqueUsers = await getLineUsersByHousehold(householdId, recipientName);
  if (uniqueUsers.length > 0) {
    const message = {
      type: 'text',
      text: `📦 包裹到貨通知！\n\n戶號：${householdId}\n收件人：${recipientName || '全體'}\n條碼：${barcode}\n時間：${new Date().toLocaleString('zh-TW', {hour12: false})}\n\n請盡快輸入「領取」以獲取驗證碼。`
    };
    await Promise.all(uniqueUsers.map(uid => lineClient.pushMessage(uid, message)));
  }
}

// --- API Routes (Prefix /api is optional here if handling in index.js, but kept for structure) ---
// Note: In Vercel serverless, this app object handles the request.

// Login API
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing credentials" });
  try {
    const auth = await getAuthClient();
    if (!auth) throw new Error("No Credentials");
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'admin!A:B' });
    const rows = response.data.values || [];
    const isValid = rows.some(r => r[0] === username && r[1] === password);
    if (isValid) {
      res.json({ success: true, token: 'session_ok' });
    } else {
      res.status(401).json({ error: "帳號或密碼錯誤" });
    }
  } catch (error) {
    console.error("Login Error:", error.message);
    res.status(500).json({ error: "Login failed" });
  }
});

// Other APIs (Users, Packages, Pickup, etc.)
// ... (The rest of API endpoints remain exactly the same as previous version)
// Just copying one for brevity, assume all app.get/post/delete are here.

app.get('/api/users', async (req, res) => {
    try {
        const auth = await getAuthClient();
        if (!auth) throw new Error("No Credentials");
        const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:D' });
        const rows = response.data.values || [];
        const users = rows.map(row => ({ lineId: row[0], householdId: row[1], name: row[2], joinDate: row[3], status: 'APPROVED' }));
        res.json(users);
    } catch (error) {
        console.error("Get Users Error:", error.message);
        res.status(500).json([]);
    }
});

app.delete('/api/users/:lineId', async (req, res) => {
    const { lineId } = req.params;
    try {
        const auth = await getAuthClient();
        if (!auth) throw new Error("No Credentials");
        const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:A' });
        const rows = response.data.values || [];
        const rowIndex = rows.findIndex(r => r[0] === lineId);
        if (rowIndex === -1) return res.status(404).json({ error: "User not found" });
        const sheetId = await getSheetId(sheets, process.env.GOOGLE_SHEET_ID, 'Users');
        if (sheetId === null) throw new Error("Sheet 'Users' not found");
        await sheets.spreadsheets.batchUpdate({ spreadsheetId: process.env.GOOGLE_SHEET_ID, requestBody: { requests: [{ deleteDimension: { range: { sheetId: sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 } } }] } });
        res.json({ success: true });
    } catch (error) {
        console.error("Delete User Error:", error.message);
        res.status(500).json({ error: "Delete failed" });
    }
});

app.get('/api/households/:id/residents', async (req, res) => {
    const householdId = req.params.id.toUpperCase();
    try {
        const auth = await getAuthClient();
        if (!auth) throw new Error("No Credentials");
        const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!B:C' });
        const rows = response.data.values || [];
        const residents = rows.filter(row => row[0] === householdId && row[1]).map(row => row[1]);
        const uniqueResidents = [...new Set(residents)];
        res.json(uniqueResidents);
    } catch (error) {
        console.error("Get Residents Error:", error.message);
        res.status(500).json([]);
    }
});

app.get('/api/packages', async (req, res) => {
  try {
    const auth = await getAuthClient();
    if (!auth) throw new Error("No Credentials");
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!A:J' });
    const rows = response.data.values;
    if (!rows || rows.length === 0) return res.json([]);
    const packages = rows.slice(1).map(row => ({
      packageId: row[0], barcode: row[1], householdId: row[2], status: row[3], receivedTime: row[4], pickupTime: row[5], pickupOTP: row[6] ? row[6].split(':')[0] : '', signatureDataURL: row[7], isOverdueNotified: row[8] === 'TRUE', recipientName: row[9] || ''
    })).reverse();
    res.json(packages);
  } catch (error) {
    console.error("API Error (Get Packages):", error.message);
    res.status(500).json({ error: "Fetch failed", details: error.message });
  }
});

app.post('/api/packages', async (req, res) => {
  const { householdId, barcode, recipientName } = req.body;
  if (!validateHouseholdId(householdId)) {
    return res.status(400).json({ error: "戶號格式錯誤。請確認：樓層3-19、棟別A/B/C、門牌1-4。" });
  }
  try {
    const auth = await getAuthClient();
    if (!auth) throw new Error("No Credentials");
    const sheets = google.sheets({ version: 'v4', auth });
    const existingData = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!B:D' });
    const existingRows = existingData.data.values || [];
    const isDuplicate = existingRows.some(row => row[0] === barcode && row[2] === 'Pending');
    if (isDuplicate) return res.status(400).json({ error: "此條碼已存在且尚未被領取，無法重複登錄。" });
    const newPackage = [`PKG${Date.now()}`, barcode, householdId, 'Pending', new Date().toISOString(), '', '', '', 'FALSE', recipientName || ''];
    await sheets.spreadsheets.values.append({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!A:A', valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS', requestBody: { values: [newPackage] } });
    notifyUser(householdId, barcode, recipientName).catch(err => console.error("Async Notify Error:", err));
    res.json({ success: true, packageId: newPackage[0] });
  } catch (error) {
    console.error("API Error (Add Package):", error.message);
    res.status(500).json({ error: "Add failed" });
  }
});

app.delete('/api/packages/:packageId', async (req, res) => {
    const { packageId } = req.params;
    try {
        const auth = await getAuthClient();
        if (!auth) throw new Error("No Credentials");
        const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!A:A' });
        const rows = response.data.values || [];
        const rowIndex = rows.findIndex(r => r[0] === packageId);
        if (rowIndex === -1) return res.status(404).json({ error: "Package not found" });
        const sheetId = await getSheetId(sheets, process.env.GOOGLE_SHEET_ID, 'Packages');
        if (sheetId === null) throw new Error("Sheet 'Packages' not found");
        await sheets.spreadsheets.batchUpdate({ spreadsheetId: process.env.GOOGLE_SHEET_ID, requestBody: { requests: [{ deleteDimension: { range: { sheetId: sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 } } }] } });
        res.json({ success: true });
    } catch (error) {
        console.error("Delete Package Error:", error.message);
        res.status(500).json({ error: "Delete failed" });
    }
});

app.post('/api/pickup/verify', async (req, res) => {
    const { otp } = req.body;
    if (!otp) return res.status(400).json({ error: "Missing OTP" });
    try {
        const auth = await getAuthClient();
        if (!auth) throw new Error("No Credentials");
        const sheets = google.sheets({ version: 'v4', auth });
        const userResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:E' });
        const userRows = userResp.data.values || [];
        const user = userRows.find(r => {
             if (!r[4] || !r[4].includes(':')) return false;
             const [code, expiry] = r[4].split(':');
             return code === otp && Date.now() < parseInt(expiry);
        });
        if (!user) return res.status(400).json({ error: "驗證碼無效或已過期" });
        const householdId = user[1];
        const userName = user[2];
        const pkgResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!A:J' });
        const pkgRows = pkgResp.data.values || [];
        const pendingPackages = pkgRows.slice(1).filter(r => r[2] === householdId && r[3] === 'Pending').map(row => ({
                packageId: row[0], barcode: row[1], householdId: row[2], status: row[3], receivedTime: row[4], recipientName: row[9] || ''
            }));
        if (pendingPackages.length === 0) return res.status(400).json({ error: "該住戶目前無待領包裹" });
        res.json({ user: { name: userName, householdId: householdId }, packages: pendingPackages });
    } catch (error) {
        console.error("Verify OTP Error:", error);
        res.status(500).json({ error: "Verification failed" });
    }
});

app.post('/api/pickup/confirm', async (req, res) => {
    const { packageIds, signatureDataURL } = req.body;
    if (!packageIds || !Array.isArray(packageIds) || packageIds.length === 0) return res.status(400).json({ error: "No packages selected" });
    try {
        const auth = await getAuthClient();
        if (!auth) throw new Error("No Credentials");
        const sheets = google.sheets({ version: 'v4', auth });
        const list = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!A:A' });
        const rows = list.data.values || [];
        const updates = [];
        const now = new Date().toISOString();
        for (const pid of packageIds) {
            const rowIndex = rows.findIndex(r => r[0] === pid);
            if (rowIndex !== -1) {
                const sheetRow = rowIndex + 1;
                updates.push(
                    { range: `Packages!D${sheetRow}`, values: [['Picked Up']] },
                    { range: `Packages!F${sheetRow}`, values: [[now]] },
                    { range: `Packages!H${sheetRow}`, values: [[signatureDataURL]] }
                );
            }
        }
        if (updates.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: process.env.GOOGLE_SHEET_ID, requestBody: { valueInputOption: 'USER_ENTERED', data: updates } });
        }
        res.json({ success: true, count: updates.length / 3 });
    } catch (error) {
        console.error("Batch Confirm Error:", error);
        res.status(500).json({ error: "Confirmation failed" });
    }
});

app.post('/api/packages/:id/otp', async (req, res) => {
    const packageId = req.params.id;
    try {
        const auth = await getAuthClient();
        if (!auth) throw new Error("No Credentials");
        const sheets = google.sheets({ version: 'v4', auth });
        const pkgResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!A:C' });
        const pkgRows = pkgResp.data.values || [];
        const pkg = pkgRows.find(r => r[0] === packageId);
        if (!pkg) return res.status(404).json({ error: "Package not found" });
        const householdId = pkg[2];
        const userResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:E' });
        const userRows = userResp.data.values || [];
        const userRowIndex = userRows.findIndex(r => r[1] === householdId); 
        if (userRowIndex === -1) return res.status(400).json({ error: "No user bound to this household" });
        const userId = userRows[userRowIndex][0];
        const allOtps = userRows.map(r => r[4]).filter(val => val);
        const otp = generateUniqueOTP(allOtps);
        const expiry = Date.now() + 10 * 60 * 1000;
        const otpString = `${otp}:${expiry}`;
        const sheetRow = userRowIndex + 1;
        await sheets.spreadsheets.values.update({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `Users!E${sheetRow}`, valueInputOption: 'USER_ENTERED', requestBody: { values: [[otpString]] } });
        if (lineClient) {
             await lineClient.pushMessage(userId, { type: 'text', text: `🔐 管理室已發送領取驗證碼：【 ${otp} 】\n\n有效時間：10 分鐘\n請出示給管理員。` });
        }
        res.json({ success: true });
    } catch (e) {
        console.error("Generate OTP Error:", e);
        res.status(500).json({ error: "Failed to generate OTP" });
    }
});

app.post('/api/packages/:id/pickup', async (req, res) => {
    const packageId = req.params.id;
    const { otp, signatureDataURL } = req.body;
    try {
        const auth = await getAuthClient();
        if (!auth) throw new Error("No Credentials");
        const sheets = google.sheets({ version: 'v4', auth });
        const pkgResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!A:C' });
        const pkgRows = pkgResp.data.values || [];
        const pkgIndex = pkgRows.findIndex(r => r[0] === packageId);
        if (pkgIndex === -1) return res.status(404).json({ error: "Package not found" });
        const householdId = pkgRows[pkgIndex][2];
        const userResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:E' });
        const userRows = userResp.data.values || [];
        const user = userRows.find(r => {
             if (r[1] !== householdId) return false;
             if (!r[4] || !r[4].includes(':')) return false;
             const [code, expiry] = r[4].split(':');
             return code === otp && Date.now() < parseInt(expiry);
        });
        if (!user) return res.status(400).json({ error: "驗證碼無效或過期" });
        const now = new Date().toISOString();
        const sheetRow = pkgIndex + 1;
        await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: process.env.GOOGLE_SHEET_ID, requestBody: { valueInputOption: 'USER_ENTERED', data: [ { range: `Packages!D${sheetRow}`, values: [['Picked Up']] }, { range: `Packages!F${sheetRow}`, values: [[now]] }, { range: `Packages!H${sheetRow}`, values: [[signatureDataURL]] }, { range: `Packages!G${sheetRow}`, values: [[otp]] } ] } });
        res.json({ success: true });
    } catch (e) {
        console.error("Verify and Pickup Error:", e);
        res.status(500).json({ error: "Failed to pickup" });
    }
});

// IMPORTANT: Export app for Vercel
export default app;

// Only listen if running locally (Vercel ignores this)
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}
