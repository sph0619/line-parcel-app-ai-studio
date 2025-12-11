import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json());
app.use(cors());

// --- Google Sheets Configuration ---
// 在 Render 環境變數中設定:
// GOOGLE_SHEET_ID: 您的試算表 ID
// GOOGLE_SERVICE_ACCOUNT_EMAIL: 服務帳號 Email
// GOOGLE_PRIVATE_KEY: 服務帳號私鑰 (注意換行符號)

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

async function getAuthClient() {
  const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;
  
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    console.warn("缺少 Google Credentials，API 將回傳模擬資料或錯誤。");
    return null;
  }

  const jwt = new google.auth.JWT(
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    SCOPES
  );
  await jwt.authorize();
  return jwt;
}

// --- API Routes ---

// 1. 獲取包裹列表
app.get('/api/packages', async (req, res) => {
  try {
    const auth = await getAuthClient();
    if (!auth) throw new Error("No Credentials");

    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Packages!A:I', // 假設資料在 Packages 分頁
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) return res.json([]);

    // 假設第一行是標題，從第二行開始解析
    // 對應 Schemas: packageId, barcode, householdId, status, receivedTime, pickupTime, pickupOTP, signatureDataURL, isOverdueNotified
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
    })).reverse(); // 最新的在前面

    res.json(packages);
  } catch (error) {
    console.error("API Error:", error.message);
    res.status(500).json({ error: "Fetch failed", details: error.message });
  }
});

// 2. 新增包裹
app.post('/api/packages', async (req, res) => {
  const { householdId, barcode } = req.body;
  try {
    const auth = await getAuthClient();
    if (!auth) throw new Error("No Credentials");

    const sheets = google.sheets({ version: 'v4', auth });
    const newPackage = [
      `PKG${Date.now()}`, // packageId
      barcode,
      householdId,
      'Pending', // status
      new Date().toISOString(), // receivedTime
      '', // pickupTime
      '', // pickupOTP
      '', // signatureDataURL
      'FALSE' // isOverdueNotified
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Packages!A:I',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [newPackage] },
    });

    // TODO: 這裡呼叫 Line Messaging API 發送通知

    res.json({ success: true, packageId: newPackage[0] });
  } catch (error) {
    res.status(500).json({ error: "Add failed" });
  }
});

// 3. 生成 OTP (Line 通知)
app.post('/api/packages/:id/otp', async (req, res) => {
  // 實務上這裡會生成隨機碼，更新 Google Sheet，並呼叫 Line API
  // 簡化版：僅回傳成功
  console.log(`Generating OTP for package ${req.params.id}`);
  res.json({ success: true });
});

// 4. 領取與驗證
app.post('/api/packages/:id/pickup', async (req, res) => {
  const { signatureDataURL } = req.body;
  const packageId = req.params.id;

  try {
    const auth = await getAuthClient();
    if (!auth) throw new Error("No Credentials");
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. 搜尋該 Package ID 在第幾行
    const list = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Packages!A:A',
    });
    
    const rowIndex = list.data.values.findIndex(r => r[0] === packageId);
    if (rowIndex === -1) throw new Error("Package not found");
    
    const sheetRow = rowIndex + 1; // 轉為 Sheet 的行號 (1-based)

    // 2. 更新狀態、時間與簽名 (欄位 D, F, H)
    // 注意：這裡假設欄位順序固定
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: `Packages!D${sheetRow}`, values: [['Picked Up']] },
          { range: `Packages!F${sheetRow}`, values: [[new Date().toISOString()]] },
          { range: `Packages!H${sheetRow}`, values: [[signatureDataURL]] },
          { range: `Packages!G${sheetRow}`, values: [['']] } // 清除 OTP
        ]
      }
    });

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Pickup failed" });
  }
});


// --- Serve Frontend ---
// 在生產環境中，Express 負責提供 Vite 建立的靜態檔案
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
