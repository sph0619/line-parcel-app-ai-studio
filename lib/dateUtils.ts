/**
 * 統一的日期解析與格式化工具
 */

export const parseDate = (dateStr: any): Date => {
  if (!dateStr) return new Date();
  
  // 如果已經是 Date 物件
  if (dateStr instanceof Date) return isNaN(dateStr.getTime()) ? new Date() : dateStr;
  
  // 確保是字串並去除前後空白
  const s = String(dateStr).trim();
  if (!s || s === 'undefined' || s === 'null') return new Date();

  // 1. 嘗試直接解析
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d;

  // 2. 處理常見的台灣/Google Sheets 格式 (例如 2024/3/24)
  // 將 / 替換為 - 以提高 ISO 相容性
  let normalized = s.replace(/\//g, '-');
  
  // 3. 處理日期與時間之間的空格 (例如 "2024-03-24 10:00:00" -> "2024-03-24T10:00:00")
  if (normalized.includes(' ') && !normalized.includes('T')) {
    normalized = normalized.replace(' ', 'T');
  }
  
  d = new Date(normalized);
  if (!isNaN(d.getTime())) return d;
  
  // 4. 最後手段：嘗試提取數字 (假設順序為 YYYY, MM, DD, HH, mm, ss)
  const parts = s.match(/\d+/g);
  if (parts && parts.length >= 3) {
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1;
    const day = parseInt(parts[2]);
    const hour = parts[3] ? parseInt(parts[3]) : 0;
    const minute = parts[4] ? parseInt(parts[4]) : 0;
    const second = parts[5] ? parseInt(parts[5]) : 0;
    const finalDate = new Date(year, month, day, hour, minute, second);
    if (!isNaN(finalDate.getTime())) return finalDate;
  }

  return new Date(); // 作為最後手段返回當前時間，避免顯示 "Invalid Date"
};

export const formatDateTime = (dateStr: any) => {
  const date = parseDate(dateStr);
  return date.toLocaleString('zh-TW', { 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit', 
    hour12: false 
  });
};

export const formatDateShort = (dateStr: any) => {
    const date = parseDate(dateStr);
    return `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`;
};

export const isToday = (dateStr: any) => {
    const d = parseDate(dateStr);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() &&
           d.getMonth() === now.getMonth() &&
           d.getDate() === now.getDate();
};

export const isOverdue = (dateStr: any, days = 3) => {
    const d = parseDate(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    return diff > (days * 24 * 60 * 60 * 1000);
};
