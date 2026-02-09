
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

const lineClient = (lineConfig.channelAccessToken && lineConfig.channelSecret) 
  ? new Client(lineConfig) 
  : null;

app.use('/callback', middleware(lineConfig));
app.use(express.json({ limit: '5mb' }));
app.use(cors());

function validateHouseholdId(id) {
  if (!id) return false;
  const str = id.toString().trim().toUpperCase();
  const regex = /^([3-9]|1[0-9])([AC][1-3]|B[1235])$/;
  return regex.test(str);
}

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

async function getAuthClient() {
  const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) return null;
  try {
    const formattedKey = GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n').replace(/"/g, '');
    const jwt = new google.auth.JWT(GOOGLE_SERVICE_ACCOUNT_EMAIL, null, formattedKey, SCOPES);
    await jwt.authorize();
    return jwt;
  } catch (error) { return null; }
}

async function getSheetId(sheets, spreadsheetId, title) {
    try {
      const meta = await sheets.spreadsheets.get({ spreadsheetId });
      const sheet = meta.data.sheets.find(s => s.properties.title === title);
      return sheet ? sheet.properties.sheetId : null;
    } catch (e) { return null; }
}

async function ensureArchiveSheet(sheets, spreadsheetId) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const exists = meta.data.sheets.some(s => s.properties.title === 'Archive_Packages');
    if (!exists) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests: [{ addSheet: { properties: { title: 'Archive_Packages' } } }] }
        });
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: 'Archive_Packages!A1:M1',
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [['pkgId', 'barcode', 'household', 'status', 'received', 'pickup', 'otp', 'sign', 'notified', 'recipient', 'type', 'logistics', 'manager']] }
        });
    }
}

app.post('/callback', async (req, res) => {
  if (!lineClient) return res.status(500).send('LINE Bot not configured');
  try {
    const events = req.body.events;
    if (!events || events.length === 0) return res.status(200).send('OK');
    await Promise.all(events.map(handleLineEvent));
    res.json({});
  } catch (err) { res.status(500).end(); }
});

async function handleLineEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return null;
  const userMessage = event.message.text.trim();
  const userId = event.source.userId;
  if (userMessage === '綁定' || userMessage === '綁定住戶') {
    return lineClient.replyMessage(event.replyToken, { type: 'text', text: '請依照格式輸入: 綁定 戶號 姓名 (範例: 綁定 10A1 王小明)' });
  }
  if (userMessage.startsWith('綁定')) {
    const parts = userMessage.split(/\s+/); 
    if (parts.length < 3) return lineClient.replyMessage(event.replyToken, { type: 'text', text: '格式錯誤，請依照: 綁定 戶號 姓名' });
    const householdId = parts[1].toUpperCase();
    const userName = parts[2];
    if (!validateHouseholdId(householdId)) return lineClient.replyMessage(event.replyToken, { type: 'text', text: `戶號格式錯誤！` });
    const result = await registerLineUser(userId, householdId, userName);
    return lineClient.replyMessage(event.replyToken, { type: 'text', text: result.message || (result.success ? `綁定成功！\n戶號：${householdId}\n姓名：${userName}` : '系統忙碌中') });
  }
  if (['領取', '取件'].includes(userMessage)) return handleUserPickupRequest(event, userId);
  if (['查詢', '查詢包裹'].includes(userMessage)) return handleUserQueryPackages(event, userId);
  return null;
}

async function registerLineUser(lineUserId, householdId, name) {
    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:A' });
        const rows = response.data.values || [];
        if (rows.some(r => r[0] === lineUserId)) return { success: false, message: "此 LINE 帳號已綁定過。" };
        await sheets.spreadsheets.values.append({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:A', valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS', requestBody: { values: [[lineUserId, householdId.trim().toUpperCase(), name.trim(), new Date().toISOString(), '']] } });
        return { success: true };
    } catch (error) { return { success: false }; }
}

async function handleUserQueryPackages(event, userId) {
    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const userResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:C' });
        const user = (userResp.data.values || []).find(r => r[0] === userId);
        if (!user) return lineClient.replyMessage(event.replyToken, { type: 'text', text: '您尚未綁定戶號' });
        const pkgResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!A:L' });
        const pendingPkgs = (pkgResp.data.values || []).filter(r => r[2] === user[1] && r[3] === 'Pending');
        if (pendingPkgs.length === 0) return lineClient.replyMessage(event.replyToken, { type: 'text', text: `目前沒有待領取的包裹。` });
        let replyText = `待領包裹共 ${pendingPkgs.length} 件：\n`;
        pendingPkgs.forEach((pkg, index) => {
            const date = new Date(pkg[4]);
            replyText += `\n${index + 1}. [${date.getMonth()+1}/${date.getDate()}] ${pkg[1].slice(-5)}`;
        });
        return lineClient.replyMessage(event.replyToken, { type: 'text', text: replyText });
    } catch (e) { return null; }
}

async function handleUserPickupRequest(event, userId) {
    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const userResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:E' });
        const userRows = userResp.data.values || [];
        const idx = userRows.findIndex(r => r[0] === userId);
        if (idx === -1) return lineClient.replyMessage(event.replyToken, { type: 'text', text: '尚未綁定' });
        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        const expiry = Date.now() + 600000;
        await sheets.spreadsheets.values.update({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `Users!E${idx + 1}`, valueInputOption: 'USER_ENTERED', requestBody: { values: [[`${otp}:${expiry}`]] } });
        return lineClient.replyMessage(event.replyToken, { type: 'text', text: `🔐 取件驗證碼：【 ${otp} 】\n(10分鐘內有效)` });
    } catch (e) { return null; }
}

async function notifyUser(householdId, barcode, recipientName = null, packageType = 'general') {
  if (!lineClient) return;
  const auth = await getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:C' });
  const rows = response.data.values || [];
  const targetUsers = rows.filter(row => row[1] === householdId && (recipientName ? row[2] === recipientName : true)).map(row => row[0]);
  const typeMap = { 'frozen': '🧊 冷凍包裹', 'letter': '✉️ 信件/掛號', 'general': '📦 一般包裹' };
  const message = { type: 'text', text: `${typeMap[packageType] || '📦 包裹'}到貨通知！\n\n戶號：${householdId}\n條碼：${barcode}` };
  await Promise.all([...new Set(targetUsers)].map(uid => lineClient.pushMessage(uid, message)));
}

// --- API Routes ---

app.get('/api/users', async (req, res) => {
    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:D' });
        const rows = response.data.values || [];
        
        const mappedUsers = rows.map(r => {
            let lineId = '';
            let householdId = '';
            let name = '';
            let joinDate = '';

            // 嚴格識別邏輯：確保只有符合格式的才是戶號
            if (r[0] && validateHouseholdId(r[0])) {
                householdId = r[0].toString().trim();
                name = (r[1] || '').toString().trim();
                joinDate = (r[2] || '').toString().trim();
            } else if (r[1] && validateHouseholdId(r[1])) {
                lineId = (r[0] || '').toString().trim();
                householdId = r[1].toString().trim();
                name = (r[2] || '').toString().trim();
                joinDate = (r[3] || '').toString().trim();
            } else if (r[2] && validateHouseholdId(r[2])) {
                lineId = (r[0] || '').toString().trim();
                householdId = r[2].toString().trim();
                name = (r[1] || '').toString().trim();
                joinDate = (r[3] || '').toString().trim();
            } else {
                // 如果沒有任何一格像戶號，則這是一筆無效或格式錯誤的資料
                // 為了安全，將其標記為空，稍後會被 filter 掉
                householdId = '';
                name = (r[0] || r[1] || '').toString().trim();
            }

            return { 
                lineId, 
                householdId: householdId.toUpperCase(), 
                name, 
                joinDate, 
                status: 'APPROVED' 
            };
        }).filter(u => u.householdId && u.householdId !== 'HOUSEHOLDID'); 

        res.json(mappedUsers);
    } catch (error) { res.status(500).json([]); }
});

app.get('/api/packages', async (req, res) => {
  try {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!A:M' });
    const rows = response.data.values || [];
    const dataRows = rows.filter((row, idx) => idx > 0 && row[0]);
    res.json(dataRows.map(row => ({
      packageId: row[0], barcode: row[1], householdId: row[2], status: row[3], receivedTime: row[4], pickupTime: row[5], pickupOTP: row[6], signatureDataURL: row[7], recipientName: row[9] || '', packageType: row[10] || 'general', logisticsCompany: row[11] || '', managerCode: row[12] || ''
    })).reverse());
  } catch (error) { res.status(500).json([]); }
});

app.post('/api/packages', async (req, res) => {
  let { householdId, barcode, recipientName, packageType = 'general', logisticsCompany = '' } = req.body;
  householdId = householdId.trim().toUpperCase();
  barcode = barcode.trim();
  if (!validateHouseholdId(householdId)) return res.status(400).json({ error: "戶號格式錯誤" });
  try {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const existingResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!B:D' });
    const isDuplicate = (existingResp.data.values || []).some(r => r[0] === barcode && r[2] === 'Pending');
    if (isDuplicate) return res.status(409).json({ error: "此條碼已在待領清單中，請勿重複入庫" });
    const newPackage = [`PKG${Date.now()}`, barcode, householdId, 'Pending', new Date().toISOString(), '', '', '', 'FALSE', recipientName || '', packageType, logisticsCompany, ''];
    await sheets.spreadsheets.values.append({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!A:A', valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS', requestBody: { values: [newPackage] } });
    await notifyUser(householdId, barcode, recipientName, packageType);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: "伺服器錯誤" }); }
});

app.post('/api/packages/:id/generate-otp', async (req, res) => {
  try {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const pkgResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!A:J' });
    const pkg = (pkgResp.data.values || []).find(r => r[0] === req.params.id);
    if (!pkg) return res.status(404).json({ error: "包裹不存在" });
    const householdId = pkg[2];
    const recipientName = pkg[9];
    const userResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:C' });
    const users = (userResp.data.values || []).filter(r => r[1] === householdId && (recipientName ? r[2] === recipientName : true));
    if (users.length === 0) return res.status(404).json({ error: "找不到該戶號綁定的 Line 帳號" });
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const expiry = Date.now() + 600000;
    const allUsersResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:E' });
    const allUsers = allUsersResp.data.values || [];
    const updates = [];
    for (const targetUser of users) {
       const uIdx = allUsers.findIndex(r => r[0] === targetUser[0]);
       if (uIdx !== -1) { updates.push({ range: `Users!E${uIdx + 1}`, values: [[`${otp}:${expiry}`]] }); }
    }
    if (updates.length > 0) { 
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: process.env.GOOGLE_SHEET_ID, requestBody: { valueInputOption: 'USER_ENTERED', data: updates } }); 
    }
    if (lineClient) {
      const message = { type: 'text', text: `🔐 取件驗證碼：【 ${otp} 】\n(10分鐘內有效)` };
      await Promise.all(users.map(u => lineClient.pushMessage(u[0], message)));
    }
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: "發送失敗" }); }
});

app.post('/api/pickup/verify', async (req, res) => {
    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const userResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:E' });
        const user = (userResp.data.values || []).find(r => {
             if (!r[4] || !r[4].includes(':')) return false;
             const [code, expiry] = r[4].split(':');
             return code === req.body.otp && Date.now() < parseInt(expiry);
        });
        if (!user) return res.status(400).json({ error: "驗證碼無效或已過期" });
        const pkgResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!A:M' });
        const pending = (pkgResp.data.values || []).filter(r => r[2] === user[1] && r[3] === 'Pending').map(row => ({
            packageId: row[0], barcode: row[1], householdId: row[2], recipientName: row[9] || '', packageType: row[10] || 'general', logisticsCompany: row[11] || ''
        }));
        res.json({ user: { name: user[2], householdId: user[1] }, packages: pending });
    } catch (error) { res.status(500).end(); }
});

app.post('/api/pickup/confirm', async (req, res) => {
    const { packageIds, signatureDataURL, managerCode } = req.body;
    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const list = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!A:A' });
        const rows = list.data.values || [];
        const updates = [];
        const now = new Date().toISOString();
        for (const pid of packageIds) {
            const idx = rows.findIndex(r => r[0] === pid);
            if (idx !== -1) {
                const rowNum = idx + 1;
                updates.push(
                    { range: `Packages!D${rowNum}`, values: [['Picked Up']] },
                    { range: `Packages!F${rowNum}`, values: [[now]] },
                    { range: `Packages!H${rowNum}`, values: [[signatureDataURL]] },
                    { range: `Packages!M${rowNum}`, values: [[managerCode]] } 
                );
            }
        }
        await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: process.env.GOOGLE_SHEET_ID, requestBody: { valueInputOption: 'USER_ENTERED', data: updates } });
        res.json({ success: true });
    } catch (error) { res.status(500).end(); }
});

app.get('/api/households/:id/residents', async (req, res) => {
    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!B:C' });
        const residents = (response.data.values || []).filter(row => row[0] === req.params.id.toUpperCase()).map(row => row[1]);
        res.json([...new Set(residents)]);
    } catch (error) { res.json([]); }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'admin!A:B' });
    const isValid = (response.data.values || []).some(r => r[0] === username && r[1] === password);
    if (isValid) res.json({ success: true, token: 'session_ok' });
    else res.status(401).json({ error: "帳號或密碼錯誤" });
  } catch (error) { res.status(500).end(); }
});

app.post('/api/packages/:id/manual-pickup', async (req, res) => {
    const { signatureDataURL, managerCode } = req.body;
    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const list = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!A:A' });
        const idx = (list.data.values || []).findIndex(r => r[0] === req.params.id);
        if (idx === -1) return res.status(404).end();
        const rowNum = idx + 1;
        const now = new Date().toISOString();
        const updates = [
            { range: `Packages!D${rowNum}`, values: [['Picked Up']] },
            { range: `Packages!F${rowNum}`, values: [[now]] },
            { range: `Packages!G${rowNum}`, values: [['MANUAL']] },
            { range: `Packages!H${rowNum}`, values: [[signatureDataURL]] },
            { range: `Packages!M${rowNum}`, values: [[managerCode]] }
        ];
        await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: process.env.GOOGLE_SHEET_ID, requestBody: { valueInputOption: 'USER_ENTERED', data: updates } });
        res.json({ success: true });
    } catch (error) { res.status(500).end(); }
});

app.post('/api/maintenance/archive', async (req, res) => {
    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;
        await ensureArchiveSheet(sheets, spreadsheetId);
        const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Packages!A:M' });
        const rows = response.data.values || [];
        if (rows.length <= 1) return res.json({ count: 0 });
        const now = Date.now();
        const retentionDays = 7;
        const rowsToArchive = [];
        const indicesToDelete = [];
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const status = row[3];
            const pickupTime = row[5];
            if (status === 'Picked Up' && pickupTime) {
                const diffDays = (now - new Date(pickupTime).getTime()) / (1000 * 3600 * 24);
                if (diffDays > retentionDays) {
                    rowsToArchive.push(row);
                    indicesToDelete.push(i);
                }
            }
        }
        if (rowsToArchive.length === 0) return res.json({ count: 0 });
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'Archive_Packages!A:A',
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: rowsToArchive }
        });
        const sheetId = await getSheetId(sheets, spreadsheetId, 'Packages');
        const deleteRequests = indicesToDelete.reverse().map(idx => ({
            deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: idx, endIndex: idx + 1 } }
        }));
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests: deleteRequests }
        });
        res.json({ count: rowsToArchive.length });
    } catch (error) { res.status(500).json({ error: "歸檔失敗" }); }
});

export default app;
