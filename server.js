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

// --- Helper: Find Line User IDs ---
// Updated to support filtering by Name
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
        // 如果有指定收件人，必須姓名相符；如果沒指定，則發送給該戶所有人
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
    const parts = userMessage.split(/\s+/); // Split by any whitespace
    // Requirement 2: Format: 綁定 [戶號] [姓名]
    if (parts.length < 3) {
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: '指令格式更新！\n請輸入：「綁定 您的戶號 您的姓名」\n例如：「綁定 11A1 王小明」'
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

  return lineClient.replyMessage(event.replyToken, {
    type: 'text',
    text: '您好！我是社區包裹小幫手。\n請輸入「綁定 戶號 姓名」來接收到貨通知。\n例如：綁定 11A1 王小明'
  });
}

async function registerLineUser(lineUserId, householdId, name) {
  try {
    const auth = await getAuthClient();
    if (!auth) return { success: false, message: "System Error" };
    const sheets = google.sheets({ version: 'v4', auth });
    
    // Check for duplicates (Household + Name)
    const existing = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: 'Users!A:C',
    });

    const rows = existing.data.values || [];
    // Row structure: [LineID, Household, Name, Date]
    const isDuplicate = rows.some(row => row[1] === householdId && row[2] === name);
    
    if (isDuplicate) {
        return { success: false, message: `綁定失敗：住戶「${name}」已在戶號「${householdId}」綁定過。` };
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Users!A:D',
      valueInputOption: 'USER_ENTERED',
      requestBody: { 
        values: [[lineUserId, householdId, name, new Date().toISOString()]] 
      },
    });
    return { success: true };
  } catch (error) {
    console.error("Register User Error:", error);
    return { success: false, message: "系統連線錯誤，請稍後再試。" };
  }
}

async function notifyUser(householdId, barcode, recipientName = null) {
  if (!lineClient) return;

  // Pass recipientName to filter specific user
  const uniqueUsers = await getLineUsersByHousehold(householdId, recipientName);

  if (uniqueUsers.length > 0) {
    const message = {
      type: 'text',
      text: `📦 包裹到貨通知！\n\n戶號：${householdId}\n收件人：${recipientName || '全體'}\n條碼：${barcode}\n時間：${new Date().toLocaleString('zh-TW', {hour12: false})}\n\n請盡快至管理室領取。`
    };

    await Promise.all(uniqueUsers.map(uid => lineClient.pushMessage(uid, message)));
    console.log(`已發送 Line 通知給 ${uniqueUsers.length} 位用戶 (${recipientName || 'Household'})`);
  }
}

// --- API Routes ---

// Requirement 3: Get Residents by Household
app.get('/api/households/:id/residents', async (req, res) => {
    const householdId = req.params.id.toUpperCase();
    try {
        const auth = await getAuthClient();
        if (!auth) throw new Error("No Credentials");
        const sheets = google.sheets({ version: 'v4', auth });
        
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: 'Users!B:C', // B:Household, C:Name
        });
        
        const rows = response.data.values || [];
        // Filter rows matching householdId and return unique names
        const residents = rows
            .filter(row => row[0] === householdId && row[1]) // Check household match and name existence
            .map(row => row[1]); // Map to Name
            
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
    // Expand range to J to include RecipientName
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Packages!A:J', 
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
      pickupOTP: row[6] ? row[6].split(':')[0] : '',
      signatureDataURL: row[7],
      isOverdueNotified: row[8] === 'TRUE',
      recipientName: row[9] || '' // Column J
    })).reverse();

    res.json(packages);
  } catch (error) {
    console.error("API Error (Get Packages):", error.message);
    res.status(500).json({ error: "Fetch failed", details: error.message });
  }
});

app.post('/api/packages', async (req, res) => {
  const { householdId, barcode, recipientName } = req.body; // Added recipientName

  if (!validateHouseholdId(householdId)) {
    return res.status(400).json({ error: "戶號格式錯誤。請確認：樓層3-19、棟別A/B/C、門牌1-4。" });
  }

  try {
    const auth = await getAuthClient();
    if (!auth) throw new Error("No Credentials");

    const sheets = google.sheets({ version: 'v4', auth });

    // Requirement 1: Check for duplicate barcode in ACTIVE (Pending) packages
    // We fetch current barcodes to check
    const existingData = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: 'Packages!B:D', // B:Barcode, D:Status
    });
    
    const existingRows = existingData.data.values || [];
    // Check if barcode exists AND status is NOT 'Picked Up' (implies it's still in system)
    // Actually, usually Barcodes (like tracking numbers) are unique per delivery. 
    // To be safe, we reject if ANY row has this barcode, or maybe just Pending ones.
    // Let's implement Strict Check: Cannot add if same barcode exists and is 'Pending'.
    const isDuplicate = existingRows.some(row => row[0] === barcode && row[2] === 'Pending');
    
    if (isDuplicate) {
        return res.status(400).json({ error: "此條碼已存在且尚未被領取，無法重複登錄。" });
    }

    const newPackage = [
      `PKG${Date.now()}`,
      barcode,
      householdId,
      'Pending',
      new Date().toISOString(),
      '', // PickupTime
      '', // OTP
      '', // Signature
      'FALSE', // Overdue
      recipientName || '' // Column J: Recipient Name
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Packages!A:A', 
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [newPackage] },
    });

    notifyUser(householdId, barcode, recipientName).catch(err => console.error("Async Notify Error:", err));

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
      range: 'Packages!A:J', // Get ID...Recipient
    });

    const rows = list.data.values;
    const rowIndex = rows.findIndex(r => r[0] === packageId);
    if (rowIndex === -1) return res.status(404).json({ error: "Package not found" });

    const householdId = rows[rowIndex][2];
    const recipientName = rows[rowIndex][9]; // Column J
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
      // Use the specific recipient Logic here too
      const users = await getLineUsersByHousehold(householdId, recipientName);
      
      if (users.length > 0) {
        const message = {
          type: 'text',
          text: `🔐 領取驗證碼通知\n\n戶號：${householdId}\n收件人：${recipientName || '全體'}\n包裹ID：${packageId}\n\n您的驗證碼為：【${otp}】\n\n有效期限為 5 分鐘，請出示給櫃台人員。`
        };
        await Promise.all(users.map(uid => lineClient.pushMessage(uid, message)));
        console.log(`OTP Sent to ${users.length} users`);
      } else {
        console.log("No Line user found for this household/recipient");
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
