import express from 'express';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import cors from 'cors';
import dotenv from 'dotenv';
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

// --- Middleware ---
app.use(compression());
app.use(cors());

// NOTICE: /callback must be before express.json() if it uses line middleware
app.use('/callback', (req, res, next) => {
    // Only apply middleware to /callback
    return middleware(lineConfig)(req, res, next);
});
app.use(express.json({ limit: '10mb' }));

// --- Helper Functions ---
function getTaiwanTimestamp() {
  try {
    const now = new Date();
    // Using Intl for consistent Taiwan formatting
    return new Intl.DateTimeFormat('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'Asia/Taipei'
    }).format(now).replace(/\//g, '/');
  } catch (e) {
    // Fallback if Intl fails
    const now = new Date();
    const twTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    const Y = twTime.getUTCFullYear();
    const M = String(twTime.getUTCMonth() + 1).padStart(2, '0');
    const D = String(twTime.getUTCDate()).padStart(2, '0');
    const h = String(twTime.getUTCHours()).padStart(2, '0');
    const m = String(twTime.getUTCMinutes()).padStart(2, '0');
    const s = String(twTime.getUTCSeconds()).padStart(2, '0');
    return `${Y}/${M}/${D} ${h}:${m}:${s}`;
  }
}

function parseSheetDate(dateStr) {
  if (!dateStr) return new Date(NaN);
  const s = dateStr.toString().trim();
  if (!s || s === 'undefined' || s === 'null') return new Date(NaN);

  // 1. Try standard parsing
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  
  // 2. Try normalization (replace / with - and handle space)
  let normalized = s.replace(/\//g, '-').replace(' ', 'T');
  d = new Date(normalized);
  if (!isNaN(d.getTime())) return d;
  
  // 3. Handle Chinese locale PM/AM (下午/上午)
  if (s.includes('下午') || s.includes('上午')) {
      let clean = s
          .replace('下午', ' ')
          .replace('上午', ' ')
          .replace('年', '/')
          .replace('月', '/')
          .replace('日', '');
      
      d = new Date(clean);
      if (!isNaN(d.getTime())) {
          if (s.includes('下午')) {
              const hours = d.getHours();
              if (hours < 12) d.setHours(hours + 12);
          }
          return d;
      }
  }

  // 4. Try extracting numbers YYYY MM DD
  const ymdMatch = s.match(/(\d{4})[/-年](\d{1,2})[/-月](\d{1,2})/);
  if (ymdMatch) {
    return new Date(parseInt(ymdMatch[1]), parseInt(ymdMatch[2]) - 1, parseInt(ymdMatch[3]));
  }
  
  // 5. Try extracting MM DD
  const mdMatch = s.match(/(\d{1,2})[/-月](\d{1,2})/);
  if (mdMatch) {
    const now = new Date();
    return new Date(now.getFullYear(), parseInt(mdMatch[1]) - 1, parseInt(mdMatch[2]));
  }

  // 6. Check if it's a Google Sheets serial date
  if (!isNaN(s) && parseFloat(s) > 40000) {
    const serial = parseFloat(s);
    return new Date((serial - 25569) * 86400 * 1000);
  }
  
  return new Date(NaN);
}

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
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:C' });
        const rows = response.data.values || [];
        // Check if this EXACT combination already exists
        if (rows.some(r => r[0] === lineUserId && r[1] === householdId)) {
          return { success: false, message: "此住戶已綁定過。" };
        }
        await sheets.spreadsheets.values.append({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:A', valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS', requestBody: { values: [[lineUserId, householdId.trim().toUpperCase(), name.trim(), getTaiwanTimestamp(), '']] } });
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
            const receivedTime = pkg[4];
            const date = parseSheetDate(receivedTime);
            const dateStr = !isNaN(date.getTime()) ? `${date.getMonth() + 1}/${date.getDate()}` : '??/??';
            replyText += `\n${index + 1}. [${dateStr}] ${pkg[1].slice(-5)}`;
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

async function notifyOverdue(householdId, barcode, recipientName = null) {
  if (!lineClient) return;
  const auth = await getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:C' });
  const rows = response.data.values || [];
  const targetUsers = rows.filter(row => row[1] === householdId && (recipientName ? row[2] === recipientName : true)).map(row => row[0]);
  const message = { type: 'text', text: `⚠️ 逾期未領通知！\n\n您的包裹已存放超過 3 天，請儘速至管理室領取。\n\n戶號：${householdId}\n條碼：${barcode}` };
  await Promise.all([...new Set(targetUsers)].map(uid => lineClient.pushMessage(uid, message)));
}

async function checkOverduePackages() {
  try {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Packages!A:M' });
    const rows = response.data.values || [];
    const now = Date.now();
    const overdueThreshold = 3 * 24 * 60 * 60 * 1000; // 3 days
    const updates = [];
    
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const status = row[3];
      const receivedTime = row[4];
      const isNotified = row[8] === 'TRUE';
      
      if (status === 'Pending' && !isNotified && receivedTime) {
        const d = parseSheetDate(receivedTime);
        
        if (!isNaN(d.getTime()) && (now - d.getTime()) > overdueThreshold) {
          updates.push({ range: `Packages!I${i + 1}`, values: [['TRUE']] });
          const householdId = row[2];
          const barcode = row[1];
          const recipientName = row[9];
          await notifyOverdue(householdId, barcode, recipientName);
        }
      }
    }
    
    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'USER_ENTERED', data: updates } });
      console.log(`Updated ${updates.length} overdue packages.`);
    }
  } catch (e) { console.error("Overdue check failed:", e); }
}

// --- API Routes ---

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    env: {
      GOOGLE_SHEET_ID: !!process.env.GOOGLE_SHEET_ID,
      GOOGLE_SERVICE_ACCOUNT_EMAIL: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      GOOGLE_PRIVATE_KEY: !!process.env.GOOGLE_PRIVATE_KEY,
      LINE_CHANNEL_ACCESS_TOKEN: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
      LINE_CHANNEL_SECRET: !!process.env.LINE_CHANNEL_SECRET,
    }
  });
});

app.get('/api/users', async (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=10, stale-while-revalidate=30');
    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:F' });
        const rows = response.data.values || [];
        
        const mappedUsers = rows.map(r => {
            let lineId = '';
            let householdId = '';
            let name = '';
            let joinDate = '';
            let rfidTag = '';

            // This mapping logic is complex because of manual vs line entries
            // Let's simplify and make it more robust
            // Standard format: LineId, HouseholdId, Name, CreateTime, OTP, RFID
            if (r[1] && validateHouseholdId(r[1])) {
                lineId = (r[0] || '').toString().trim();
                householdId = r[1].toString().trim();
                name = (r[2] || '').toString().trim();
                joinDate = (r[3] || '').toString().trim();
                rfidTag = (r[5] || '').toString().trim();
            } else if (r[0] && validateHouseholdId(r[0])) {
                householdId = r[0].toString().trim();
                name = (r[1] || '').toString().trim();
                joinDate = (r[2] || '').toString().trim();
                rfidTag = (r[4] || '').toString().trim();
            } else {
                return null;
            }

            return { 
                lineId, 
                householdId: householdId.toUpperCase(), 
                name, 
                joinDate, 
                status: 'APPROVED',
                rfidTag
            };
        }).filter(u => u && u.householdId && u.householdId !== 'HOUSEHOLDID'); 

        res.json(mappedUsers);
    } catch (error) { res.status(500).json([]); }
});

// NEW: Search Users Endpoint (Low Traffic)
app.get('/api/users/search', async (req, res) => {
    const { query } = req.query;
    if (!query) return res.json([]);
    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:F' });
        const rows = response.data.values || [];
        const term = query.toString().toUpperCase();
        
        const filtered = rows.filter(r => {
            const hId = (r[0] || r[1] || '').toString().toUpperCase();
            const name = (r[1] || r[2] || '').toString().toUpperCase();
            return hId.includes(term) || name.includes(term);
        }).map(r => {
            if (r[1] && validateHouseholdId(r[1])) {
                return { lineId: r[0], householdId: r[1], name: r[2], joinDate: r[3], rfidTag: r[5] || '' };
            } else if (r[0] && validateHouseholdId(r[0])) {
                return { lineId: '', householdId: r[0], name: r[1], joinDate: r[2], rfidTag: r[4] || '' };
            }
            return null;
        }).filter(u => u && u.householdId !== 'HOUSEHOLDID');
        
        res.json(filtered);
    } catch (error) { res.status(500).json([]); }
});

// NEW: Bind RFID Endpoint
app.post('/api/users/bind-rfid', async (req, res) => {
    const { householdId, name, rfidTag } = req.body;
    if (!householdId || !name || !rfidTag) return res.status(400).json({ error: "缺少必要參數" });
    
    const cleanTag = rfidTag.trim();
    if (!cleanTag) return res.status(400).json({ error: "磁扣號碼不可為空" });

    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:F' });
        const rows = response.data.values || [];
        
        // FIND existing user to update
        const idx = rows.findIndex(r => {
            const rHId = (r[1] && validateHouseholdId(r[1])) ? r[1] : r[0];
            const rName = (r[1] && validateHouseholdId(r[1])) ? r[2] : r[1];
            return rHId.toString().toUpperCase() === householdId.toString().toUpperCase() && 
                   rName.toString() === name.toString();
        });
        
        if (idx === -1) return res.status(404).json({ error: "找不到住戶" });

        // DUPLICATE CHECK: See if this tag is already bound to ANOTHER user
        const duplicateIdx = rows.findIndex((r, i) => {
            if (i === 0) return false; // Skip header
            if (i === idx) return false; // Skip the user we are currently updating
            
            // RFID can be in index 4 or 5
            const tag = (r[5] || r[4] || '').toString().trim();
            return tag === cleanTag;
        });

        if (duplicateIdx !== -1) {
            const dupRow = rows[duplicateIdx];
            const dupHId = (dupRow[1] && validateHouseholdId(dupRow[1])) ? dupRow[1] : dupRow[0];
            return res.status(400).json({ error: `此磁扣已由戶號 ${dupHId} 綁定，請先解除該戶綁定或更換磁扣` });
        }
        
        const col = (rows[idx][1] && validateHouseholdId(rows[idx][1])) ? 'F' : 'E';
        await sheets.spreadsheets.values.update({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: `Users!${col}${idx + 1}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[cleanTag]] }
        });
        
        res.json({ success: true });
    } catch (error) { 
        console.error("Bind RFID error:", error);
        res.status(500).json({ error: "綁定失敗" }); 
    }
});

// NEW: Delete User Endpoint
app.post('/api/users/delete', async (req, res) => {
    const { lineId, householdId, name } = req.body;
    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;
        const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Users!A:C' });
        const rows = response.data.values || [];
        
        // Find row that matches ALL provided criteria to handle duplicates correctly
        const rowIndex = rows.findIndex(r => {
            // Check based on mapping (LineId can be at 0 or empty if householdId is at 0)
            const rowLineId = (r[0] && !validateHouseholdId(r[0])) ? r[0] : '';
            const rowHId = validateHouseholdId(r[0]) ? r[0] : (validateHouseholdId(r[1]) ? r[1] : '');
            const rowName = (r[0] === rowHId) ? r[1] : (r[1] === rowHId ? r[2] : '');

            return (rowLineId === (lineId || '')) && 
                   (rowHId.toString().toUpperCase() === householdId.toString().toUpperCase()) && 
                   (rowName.toString() === name.toString());
        });

        if (rowIndex === -1) return res.status(404).json({ error: "找不到該用戶" });

        const sheetId = await getSheetId(sheets, spreadsheetId, 'Users');
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{
                    deleteDimension: {
                        range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 }
                    }
                }]
            }
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "伺服器錯誤" });
    }
});

app.get('/api/packages', async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=10, stale-while-revalidate=30');
  try {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    // Use a wide range to ensure we capture all columns
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!A:Z' });
    const rows = response.data.values || [];
    // Skip header and filter empty rows
    const dataRows = rows.slice(1).filter(row => row.length > 0 && row[0]);
    
    // 轉換資料並標準化狀態
    const allMapped = dataRows.map(row => {
      const rawStatus = (row[3] || '').toString().trim();
      // Normalizing status: support both English and Chinese
      let status = 'Pending';
      if (rawStatus === 'Picked Up' || rawStatus === '已領' || rawStatus === '簽收') {
        status = 'Picked Up';
      } else if (rawStatus === 'Pending' || rawStatus === '待領' || !rawStatus) {
        status = 'Pending';
      } else {
        // Fallback for partial matches
        status = (rawStatus.toLowerCase().includes('pick') || rawStatus.includes('已')) ? 'Picked Up' : 'Pending';
      }

      return {
        packageId: row[0] || '', 
        barcode: row[1] || '', 
        householdId: (row[2] || '').toString().trim().toUpperCase(), 
        status: status, 
        receivedTime: row[4] || '', 
        pickupTime: row[5] || '', 
        pickupOTP: row[6] || '', 
        signatureDataURL: (row[7] && row[7].length > 10) ? 'HAS_SIGNATURE' : '', 
        isOverdueNotified: row[8] === 'TRUE',
        recipientName: row[9] || '', 
        packageType: row[10] || 'general', 
        logisticsCompany: row[11] || '', 
        managerCode: row[12] || '',
        rfidVerified: row[13] || ''
      };
    });

    // Split into pending and picked up
    const pending = allMapped.filter(p => p.status === 'Pending');
    const pickedUp = allMapped.filter(p => p.status === 'Picked Up')
                             .sort((a, b) => b.pickupTime.localeCompare(a.pickupTime))
                             .slice(0, 50);
    
    res.json([...pending, ...pickedUp]);
  } catch (error) { 
    console.error("Fetch packages error:", error);
    res.status(500).json([]); 
  }
});

app.get('/api/packages/:id/signature', async (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Signatures don't change
    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;
        const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Packages!A:H' });
        const rows = response.data.values || [];
        const pkg = rows.find(r => r[0] === req.params.id);
        if (!pkg || !pkg[7]) return res.status(404).json({ error: "找不到簽名" });
        res.json({ signatureDataURL: pkg[7] });
    } catch (error) { res.status(500).json({ error: "伺服器錯誤" }); }
});

app.post('/api/packages', async (req, res) => {
  let { householdId, barcode, recipientName, packageType = 'general', logisticsCompany = '' } = req.body;
  householdId = householdId.trim().toUpperCase();
  barcode = barcode.trim();
  if (!validateHouseholdId(householdId)) return res.status(400).json({ error: "戶號格式錯誤" });
  try {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    
    // 只有在新增包裹時才觸發逾期檢查，減少 API 呼叫次數
    checkOverduePackages();

    const existingResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!B:D' });
    const isDuplicate = (existingResp.data.values || []).some(r => r[0] === barcode && r[2] === 'Pending');
    if (isDuplicate) return res.status(409).json({ error: "此條碼已在待領清單中，請勿重複入庫" });
    const newPackage = [`PKG${Date.now()}`, barcode, householdId, 'Pending', getTaiwanTimestamp(), '', '', '', 'FALSE', recipientName || '', packageType, logisticsCompany, ''];
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

app.post('/api/pickup/rfid-verify', async (req, res) => {
    const { rfidTag } = req.body;
    if (!rfidTag) return res.status(400).json({ error: "無感應資料" });
    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const userResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Users!A:F' });
        const userRows = userResp.data.values || [];
        
        const user = userRows.find(r => {
            const rRFID = (r[1] && validateHouseholdId(r[1])) ? r[5] : r[4];
            return rRFID && rRFID.toString().trim() === rfidTag.trim();
        });
        
        if (!user) return res.status(404).json({ error: "查無此磁扣綁定資料" });
        
        const hId = (user[1] && validateHouseholdId(user[1])) ? user[1] : user[0];
        const name = (user[1] && validateHouseholdId(user[1])) ? user[2] : user[1];

        const pkgResp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!A:M' });
        const pending = (pkgResp.data.values || []).filter(r => r[2] === hId && r[3] === 'Pending').map(row => ({
            packageId: row[0], barcode: row[1], householdId: row[2], recipientName: row[9] || '', packageType: row[10] || 'general', logisticsCompany: row[11] || ''
        }));
        
        res.json({ user: { name, householdId: hId, rfidTag: rfidTag.trim() }, packages: pending });
    } catch (error) { res.status(500).end(); }
});

app.post('/api/pickup/confirm', async (req, res) => {
    const { packageIds, signatureDataURL, managerCode, rfidVerified } = req.body;
    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const list = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Packages!A:A' });
        const rows = list.data.values || [];
        const updates = [];
        const now = getTaiwanTimestamp();
        for (const pid of packageIds) {
            const idx = rows.findIndex(r => r[0] === pid);
            if (idx !== -1) {
                const rowNum = idx + 1;
                updates.push(
                    { range: `Packages!D${rowNum}`, values: [['Picked Up']] },
                    { range: `Packages!F${rowNum}`, values: [[now]] },
                    { range: `Packages!H${rowNum}`, values: [[signatureDataURL || (rfidVerified ? 'RFID_CONFIRMED' : '')]] },
                    { range: `Packages!M${rowNum}`, values: [[managerCode || '']] },
                    { range: `Packages!N${rowNum}`, values: [[rfidVerified || '']] }
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
        const now = getTaiwanTimestamp();
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

// ARCHIVING ENDPOINT
app.get('/api/maintenance/archive/search', async (req, res) => {
    const { query } = req.query;
    if (!query) return res.json([]);

    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;
        
        await ensureArchiveSheet(sheets, spreadsheetId);
        
        const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Archive_Packages!A:M' });
        const rows = response.data.values || [];
        if (rows.length <= 1) return res.json([]);

        const searchLower = query.toString().toLowerCase();
        
        const results = rows.slice(1).filter(row => {
            const householdId = (row[2] || '').toString().toLowerCase();
            const recipientName = (row[9] || '').toString().toLowerCase();
            const barcode = (row[1] || '').toString().toLowerCase();
            return householdId.includes(searchLower) || recipientName.includes(searchLower) || barcode.includes(searchLower);
        });

        res.json(results.map(row => ({
            packageId: row[0], 
            barcode: row[1], 
            householdId: row[2], 
            status: row[3], 
            receivedTime: row[4], 
            pickupTime: row[5], 
            pickupOTP: row[6], 
            signatureDataURL: row[7], 
            isOverdueNotified: row[8] === 'TRUE',
            recipientName: row[9] || '', 
            packageType: row[10] || 'general', 
            logisticsCompany: row[11] || '', 
            managerCode: row[12] || ''
        })));
    } catch (error) {
        res.status(500).json({ error: "搜尋封存失敗" });
    }
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
                const pDate = parseSheetDate(pickupTime);
                if (!isNaN(pDate.getTime())) {
                    const diffDays = (now - pDate.getTime()) / (1000 * 3600 * 24);
                    if (diffDays > retentionDays) {
                        rowsToArchive.push(row);
                        indicesToDelete.push(i);
                    }
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

// --- Export App for Vercel ---
export default app;

// --- Start Server (only if not in Vercel) ---
if (!process.env.VERCEL) {
  startServer();
}

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch (e) {
      console.error('Failed to load Vite:', e);
    }
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
