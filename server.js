import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json());
app.use(cors());

// Health Check (讓 Render 確認伺服器活著)
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// --- Google Sheets Configuration ---
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

async function getAuthClient() {
  const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;
  
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    console.warn("缺少 Google Credentials，API 將回傳模擬資料或錯誤。");
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

// --- API Routes ---

// 1. 獲取包裹列表
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

// 2. 新增包裹
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

    res.json({ success: true, packageId: newPackage[0] });
  } catch (error) {
    console.error("API Error (Add Package):", error.message);
    res.status(500).json({ error: "Add failed" });
  }
});

// 3. 生成 OTP
app.post('/api/packages/:id/otp', async (req, res) => {
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
