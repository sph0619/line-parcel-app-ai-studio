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
// ^([3-9]|1[0-9]) : 3-9 或 10-19
// ([AC][1-3]|B[1-4])$ : (A或C接1-3) 或 (B接1-4)
function validateHouseholdId(id) {
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
        text: `戶號格式錯誤！\n\n規則：\n1. 樓層 3-19\n2. 棟別 A, B, C\n3. A/C棟門牌 1-3；B棟門牌 1-4\n\n範例：11A1, 3B4`
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
