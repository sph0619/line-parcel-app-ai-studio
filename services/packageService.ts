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

// Log configuration status (helpful for debugging in Vercel)
if (!lineConfig.channelAccessToken || !lineConfig.channelSecret) {
  console.warn('⚠️ [WARNING] LINE_CHANNEL_ACCESS_TOKEN or LINE_CHANNEL_SECRET is missing!');
}

const lineClient = (lineConfig.channelAccessToken && lineConfig.channelSecret) 
  ? new Client(lineConfig) 
  : null;

// Middleware for LINE must come BEFORE express.json() for the /callback path
app.use('/callback', middleware(lineConfig));

app.use(express.json());
app.use(cors());

// --- Validation Logic ---
function validateHouseholdId(id) {
  if (!id) return false;
  // Floors 3-19, Blocks A/C units 1-3, Block B units 1,2,3,5 (No 4)
  const regex = /^([3-9]|1[0-9])([AC][1-3]|B[1235])$/;
  return regex.test(id);
}

app.get('/health', (req, res) => {
  res.status(200).send('OK - Service is running');
});

// --- Google Sheets Configuration ---
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

async function getAuthClient() {
  const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;
  
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    console.error('❌ [ERROR] Google Sheets Credentials missing in env!');
    return null;
  }

  try {
    // Robust private key parsing for multi-line support in various environments
    const formattedKey = GOOGLE_PRIVATE_KEY
      .replace(/\\n/g, '\n')
      .replace(/"/g, ''); // Remove potential double quotes

    const jwt = new google.auth.JWT(
      GOOGLE_SERVICE_ACCOUNT_EMAIL,
      null,
      formattedKey,
      SCOPES
    );
    await jwt.authorize();
    return jwt;
  } catch (error) {
    console.error("❌ [ERROR] Google Auth Error:", error.message);
    return null;
  }
}

async function getSheetId(sheets, spreadsheetId, title) {
    try {
      const meta = await sheets.spreadsheets.get({ spreadsheetId });
      const sheet = meta.data.sheets.find(s => s.properties.title === title);
      return sheet ? sheet.properties.sheetId : null;
    } catch (e) {
      console.error(`❌ [ERROR] Could not find sheet with title: ${title}`);
      return null;
    }
}

async function checkAndSeedAdmin() {
  try {
    const auth = await getAuthClient();
    if (!auth) return;
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) return;

    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'admin!A:B' });
    const rows = response.data.values || [];
    const hasAdmin = rows.some(r => r[0] === 'admin');
    if (!hasAdmin) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'admin!A:B',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['admin', 'admin']] }
      });
    }
  } catch (error) {
    console.error('❌ [ERROR] checkAndSeedAdmin failed:', error.message);
  }
}

checkAndSeedAdmin();

// --- LINE Webhook Handler ---
app.post('/callback', async (req, res) => {
  if (!lineClient) {
    console.error('❌ [ERROR] LINE client not initialized. Check your Environment Variables.');
    return res.status(500).send('LINE Bot not configured');
  }

  try {
    const events = req.body.events;
    // LINE Verification sends an empty event list or a special verify event
    if (!events || events.length === 0) {
      return res.status(200).send('OK - No events to process');
    }

    await Promise.all(events.map(handleLineEvent));
    res.json({});
  } catch (err) {
    console.error('❌ [ERROR] Webhook Error:', err);
    res.status(500).end();
  }
});

async function handleLineEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return null;
  const userMessage = event.message.text.trim();
  const userId = event.source.userId;

  if (userMessage === '綁定住戶' || userMessage === '綁定') {
    return lineClient.replyMessage(event.replyToken, { type: 'text', text: '請依照以下格式輸入: 綁定 戶號 姓名 (範例: 綁定 10A1 王小明)' });
  }

  if (userMessage.startsWith('綁定') || userMessage.toLowerCase().startsWith('reg')) {
    const parts = userMessage.split(/\s+/); 
    if (parts.length < 3) return lineClient.replyMessage(event.replyToken, { type: 'text', text: '指令格式不完整。\n請依照: 綁定 戶號 姓名 (範例: 綁定 10A1 王小明)' });
    const householdId = parts[1].toUpperCase();
    const userName = parts[2];
    if (!validateHouseholdId(householdId)) return lineClient.replyMessage(event.replyToken, { type: 'text', text: `戶號格式錯誤！` });
    const result = await registerLineUser(userId, householdId, userName);
    if (!result.success) return lineClient.replyMessage(event.replyToken, { type: 'text', text: result.message });
    return lineClient.replyMessage(event.replyToken, { type: 'text', text: `綁定成功！\n戶號：${householdId}\n姓名：${userName}\n\n當有您的包裹送達時，將會收到通知。` });
  }

  if (['領取', 'pickup', '取件'].includes(userMessage.toLowerCase())) return handleUserPickupRequest(event, userId);
  if (['查詢', '查詢包裹', 'check', 'query'].includes(userMessage.toLowerCase())) return handleUserQueryPackages(event, userId);

  return lineClient.replyMessage(event.replyToken, { type: 'text', text: '您好！我是社區包裹小幫手。\n\n指令列表：\n1. 「綁定 戶號 姓名」\n2. 「查詢包裹」: 查看待領清單\n3. 「領取」: 產生取件驗證碼' });
}

async function handleUserQueryPackages(event, userId) {
    try {
        const auth = await getAuthClient();
        if (!auth) return;
        const sheets = google.sheets({ version: 'v4', auth });
        const userResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:C' });
        const userRows = userResp.data.values || [];
        const user = userRows.find(r => r[0] === userId);
        if (!user) return lineClient.replyMessage(event.replyToken, { type: 'text', text: '您尚未綁定戶號' });
        const householdId = user[1];
        const pkgResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!A:L' });
        const pkgRows = pkgResp.data.values || [];
        const pendingPkgs = pkgRows.slice(1).filter(r => r[2] === householdId && r[3] === 'Pending');
        if (pendingPkgs.length === 0) return lineClient.replyMessage(event.replyToken, { type: 'text', text: `目前沒有待領取的包裹。` });
        let replyText = `待領包裹共 ${pendingPkgs.length} 件：\n`;
        pendingPkgs.forEach((pkg, index) => {
            const dateStr = `${(new Date(pkg[4]).getMonth()+1)}/${new Date(pkg[4]).getDate()}`;
            const typeMap = { 'frozen': '🧊 冷凍', 'letter': '✉️ 信件', 'general': '📦 一般' };
            const typeStr = pkg[10] ? (typeMap[pkg[10]] || '') : ''; 
            replyText += `\n${index + 1}. [${dateStr}] ${typeStr} ${pkg[1].slice(-5)} ${pkg[9] || ''}`;
        });
        return lineClient.replyMessage(event.replyToken, { type: 'text', text: replyText + '\n\n輸入「領取」獲取碼' });
    } catch (e) { return null; }
}

async function handleUserPickupRequest(event, userId) {
    try {
        const auth = await getAuthClient();
        if (!auth) return;
        const sheets = google.sheets({ version: 'v4', auth });
        const userResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:E' });
        const userRows = userResp.data.values || [];
        const userRowIndex = userRows.findIndex(r => r[0] === userId);
        if (userRowIndex === -1) return lineClient.replyMessage(event.replyToken, { type: 'text', text: '尚未綁定' });
        const householdId = userRows[userRowIndex][1];
        const otp = generateUniqueOTP(userRows.map(r => r[4]).filter(val => val));
        const otpString = `${otp}:${Date.now() + 600000}`;
        await sheets.spreadsheets.values.update({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `Users!E${userRowIndex + 1}`, valueInputOption: 'USER_ENTERED', requestBody: { values: [[otpString]] } });
        return lineClient.replyMessage(event.replyToken, { type: 'text', text: `🔐 取件驗證碼：【 ${otp} 】` });
    } catch (e) { return null; }
}

async function registerLineUser(lineUserId, householdId, name) {
    try {
        const auth = await getAuthClient();
        if (!auth) return { success: false, message: "System Error" };
        const sheets = google.sheets({ version: 'v4', auth });
        await sheets.spreadsheets.values.append({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:A', valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS', requestBody: { values: [[lineUserId, householdId, name, new Date().toISOString(), '']] } });
        return { success: true };
    } catch (error) { return { success: false, message: "Error" }; }
}

async function notifyUser(householdId, barcode, recipientName = null, packageType = 'general', logisticsCompany = '') {
  if (!lineClient) return;
  const uniqueUsers = await getLineUsersByHousehold(householdId, recipientName);
  const typeMap = { 'frozen': '🧊 冷凍包裹', 'letter': '✉️ 信件/掛號', 'general': '📦 一般包裹' };
  const typeText = typeMap[packageType] || '📦 包裹';
  const logisticsText = logisticsCompany ? `\n物流：${logisticsCompany}` : '';
  if (uniqueUsers.length > 0) {
    const message = { type: 'text', text: `${typeText}到貨通知！\n\n戶號：${householdId}\n收件人：${recipientName || '全體'}${logisticsText}\n條碼：${barcode}` };
    await Promise.all(uniqueUsers.map(uid => lineClient.pushMessage(uid, message)));
  }
}

function generateUniqueOTP(existingOtps) {
    let otp;
    let isUnique = false;
    let attempts = 0;
    while (!isUnique && attempts < 10) {
        otp = Math.floor(1000 + Math.random() * 9000).toString();
        const collision = existingOtps.some(entry => entry && entry.startsWith(otp + ':'));
        if (!collision) isUnique = true;
        attempts++;
    }
    return otp;
}

async function getLineUsersByHousehold(householdId, recipientName = null) {
  try {
    const auth = await getAuthClient();
    if (!auth) return [];
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:C' });
    const rows = response.data.values;
    if (!rows || rows.length === 0) return [];
    const targetUsers = rows.filter(row => {
        const matchHousehold = row[1] === householdId;
        const matchName = recipientName ? row[2] === recipientName : true;
        return matchHousehold && matchName;
    }).map(row => row[0]);
    return [...new Set(targetUsers)];
  } catch (error) {
    console.error("Get Line Users Error:", error);
    return [];
  }
}

// --- API Routes ---

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'admin!A:B' });
    const rows = response.data.values || [];
    const isValid = rows.some(r => r[0] === username && r[1] === password);
    if (isValid) res.json({ success: true, token: 'session_ok' });
    else res.status(401).json({ error: "帳號或密碼錯誤" });
  } catch (error) { res.status(500).end(); }
});

app.get('/api/users', async (req, res) => {
    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:D' });
        const rows = response.data.values || [];
        res.json(rows.map(row => ({ lineId: row[0], householdId: row[1], name: row[2], joinDate: row[3], status: 'APPROVED' })));
    } catch (error) { res.status(500).json([]); }
});

app.delete('/api/users/:lineId', async (req, res) => {
    const { lineId } = req.params;
    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:A' });
        const rowIndex = (response.data.values || []).findIndex(r => r[0] === lineId);
        if (rowIndex === -1) return res.status(404).end();
        const sheetId = await getSheetId(sheets, process.env.GOOGLE_SHEET_ID, 'Users');
        await sheets.spreadsheets.batchUpdate({ spreadsheetId: process.env.GOOGLE_SHEET_ID, requestBody: { requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 } } }] } });
        res.json({ success: true });
    } catch (error) { res.status(500).end(); }
});

app.get('/api/households/:id/residents', async (req, res) => {
    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!B:C' });
        const rows = response.data.values || [];
        const residents = rows.filter(row => row[0] === req.params.id.toUpperCase() && row[1]).map(row => row[1]);
        res.json([...new Set(residents)]);
    } catch (error) { res.json([]); }
});

app.get('/api/packages', async (req, res) => {
  try {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!A:M' });
    const rows = response.data.values || [];
    res.json(rows.slice(1).map(row => ({
      packageId: row[0], barcode: row[1], householdId: row[2], status: row[3], receivedTime: row[4], pickupTime: row[5], pickupOTP: row[6] ? row[6].split(':')[0] : '', signatureDataURL: row[7], isOverdueNotified: row[8] === 'TRUE', recipientName: row[9] || '', packageType: row[10] || 'general', logisticsCompany: row[11] || '', managerCode: row[12] || ''
    })).reverse());
  } catch (error) { res.status(500).end(); }
});

app.post('/api/packages', async (req, res) => {
  const { householdId, barcode, recipientName, packageType = 'general', logisticsCompany = '' } = req.body;
  if (!validateHouseholdId(householdId)) return res.status(400).end();
  try {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const newPackage = [`PKG${Date.now()}`, barcode, householdId, 'Pending', new Date().toISOString(), '', '', '', 'FALSE', recipientName || '', packageType, logisticsCompany, ''];
    await sheets.spreadsheets.values.append({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!A:A', valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS', requestBody: { values: [newPackage] } });
    await notifyUser(householdId, barcode, recipientName, packageType, logisticsCompany);
    res.json({ success: true, packageId: newPackage[0] });
  } catch (error) { res.status(500).end(); }
});

app.delete('/api/packages/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!A:A' });
        const rowIndex = (response.data.values || []).findIndex(r => r[0] === id);
        if (rowIndex === -1) return res.status(404).json({ error: "Package not found" });
        
        const sheetId = await getSheetId(sheets, process.env.GOOGLE_SHEET_ID, 'Packages');
        if (sheetId === null) return res.status(500).json({ error: "Could not find Packages sheet" });

        await sheets.spreadsheets.batchUpdate({ 
            spreadsheetId: process.env.GOOGLE_SHEET_ID, 
            requestBody: { 
                requests: [{ 
                    deleteDimension: { 
                        range: { 
                            sheetId, 
                            dimension: 'ROWS', 
                            startIndex: rowIndex, 
                            endIndex: rowIndex + 1 
                        } 
                    } 
                }] 
            } 
        });
        res.json({ success: true });
    } catch (error) { 
        console.error("Delete Package Error:", error);
        res.status(500).end(); 
    }
});

app.post('/api/packages/:id/manual-pickup', async (req, res) => {
    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!A:A' });
        const rowIndex = (response.data.values || []).findIndex(r => r[0] === req.params.id);
        if (rowIndex === -1) return res.status(404).end();
        const sheetRow = rowIndex + 1;
        await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: process.env.GOOGLE_SHEET_ID, requestBody: { valueInputOption: 'USER_ENTERED', data: [ { range: `Packages!D${sheetRow}`, values: [['Picked Up']] }, { range: `Packages!F${sheetRow}`, values: [[new Date().toISOString()]] }, { range: `Packages!H${sheetRow}`, values: [['Manual Pickup']] }, { range: `Packages!M${sheetRow}`, values: [['admin']] } ] } });
        res.json({ success: true });
    } catch (e) { res.status(500).end(); }
});

app.post('/api/pickup/verify', async (req, res) => {
    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const userResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:E' });
        const userRows = userResp.data.values || [];
        const user = userRows.find(r => {
             if (!r[4] || !r[4].includes(':')) return false;
             const [code, expiry] = r[4].split(':');
             return code === req.body.otp && Date.now() < parseInt(expiry);
        });
        if (!user) return res.status(400).json({ error: "驗證碼無效或已過期" });
        const householdId = user[1];
        const pkgResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!A:M' });
        const pkgRows = pkgResp.data.values || [];
        const pendingPackages = pkgRows.slice(1).filter(r => r[2] === householdId && r[3] === 'Pending').map(row => ({
                packageId: row[0], barcode: row[1], householdId: row[2], status: row[3], receivedTime: row[4], recipientName: row[9] || '', packageType: row[10] || 'general', logisticsCompany: row[11] || '', managerCode: row[12] || ''
            }));
        res.json({ user: { name: user[2], householdId: householdId }, packages: pendingPackages });
    } catch (error) { res.status(500).end(); }
});

app.post('/api/pickup/confirm', async (req, res) => {
    const { packageIds, signatureDataURL, managerCode } = req.body;
    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        
        const adminResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'admin!A:A' });
        const admins = adminResp.data.values || [];
        const isValidManager = admins.some(r => r[0] === managerCode);
        if (!isValidManager) return res.status(403).json({ error: "承辦人代碼無效" });

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
                    { range: `Packages!H${sheetRow}`, values: [[signatureDataURL]] },
                    { range: `Packages!M${sheetRow}`, values: [[managerCode]] } 
                );
            }
        }
        await sheets.spreadsheets.batchUpdate({ spreadsheetId: process.env.GOOGLE_SHEET_ID, requestBody: { valueInputOption: 'USER_ENTERED', data: updates } });
        res.json({ success: true });
    } catch (error) { res.status(500).end(); }
});

app.post('/api/packages/:id/otp', async (req, res) => {
    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const pkgResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!A:C' });
        const pkg = pkgResp.data.values.find(r => r[0] === req.params.id);
        const userResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:E' });
        const userRowIndex = userResp.data.values.findIndex(r => r[1] === pkg[2]); 
        const otp = generateUniqueOTP(userResp.data.values.map(r => r[4]).filter(v => v));
        const otpString = `${otp}:${Date.now() + 600000}`;
        await sheets.spreadsheets.values.update({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `Users!E${userRowIndex + 1}`, valueInputOption: 'USER_ENTERED', requestBody: { values: [[otpString]] } });
        if (lineClient) await lineClient.pushMessage(userResp.data.values[userRowIndex][0], { type: 'text', text: `🔐 驗證碼：【 ${otp} 】` });
        res.json({ success: true });
    } catch (e) { res.status(500).end(); }
});

app.post('/api/packages/:id/pickup', async (req, res) => {
    const { otp, signatureDataURL, managerCode } = req.body;
    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        
        const adminResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'admin!A:A' });
        if (!(adminResp.data.values || []).some(r => r[0] === managerCode)) return res.status(403).end();

        const pkgResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!A:C' });
        const pkgIndex = pkgResp.data.values.findIndex(r => r[0] === req.params.id);
        const userResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:E' });
        const user = userResp.data.values.find(r => r[1] === pkgResp.data.values[pkgIndex][2] && r[4] && r[4].split(':')[0] === otp);
        if (!user) return res.status(400).end();
        const sheetRow = pkgIndex + 1;
        await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: process.env.GOOGLE_SHEET_ID, requestBody: { valueInputOption: 'USER_ENTERED', data: [ { range: `Packages!D${sheetRow}`, values: [['Picked Up']] }, { range: `Packages!F${sheetRow}`, values: [[new Date().toISOString()]] }, { range: `Packages!H${sheetRow}`, values: [[signatureDataURL]] }, { range: `Packages!G${sheetRow}`, values: [[otp]] }, { range: `Packages!M${sheetRow}`, values: [[managerCode]] } ] } });
        res.json({ success: true });
    } catch (e) { res.status(500).end(); }
});

export default app;
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`🚀 Server is running on port ${PORT}`));
}
