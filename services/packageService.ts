import { PackageItem, PickupSession, User, PackageType } from '../types';

const API_BASE_URL = '/api'; 
const AUTH_KEY = 'community_auth_token';

// 只有在 API 斷線或開發測試時使用的 Mock 資料 (用於保持系統韌性)
const getFallbackPackages = (): PackageItem[] => {
  const data = localStorage.getItem('community_packages_v2_fallback');
  return data ? JSON.parse(data) : [];
};

export const packageService = {
  getPackages: async (): Promise<PackageItem[]> => {
    try {
      const response = await fetch(`${API_BASE_URL}/packages`);
      if (!response.ok) throw new Error();
      return await response.json();
    } catch (e) { 
      return getFallbackPackages(); 
    }
  },
  
  addPackage: async (householdId: string, barcode: string, recipientName?: string, packageType: PackageType = 'general', logisticsCompany: string = ''): Promise<PackageItem> => {
    const response = await fetch(`${API_BASE_URL}/packages`, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ householdId, barcode, recipientName, packageType, logisticsCompany }) 
    });
    if (!response.ok) throw new Error((await response.json()).error || 'API Error');
    return await response.json();
  },
  
  getResidents: async (id: string): Promise<string[]> => {
    try {
        const r = await fetch(`${API_BASE_URL}/households/${id}/residents`);
        if (!r.ok) return [];
        return await r.json();
    } catch (e) { 
        return []; 
    }
  },
  
  verifyPickupOTP: async (otp: string): Promise<PickupSession> => {
    const response = await fetch(`${API_BASE_URL}/pickup/verify`, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ otp }) 
    });
    if (!response.ok) throw new Error((await response.json()).error || '驗證失敗');
    return await response.json();
  },
  
  confirmBatchPickup: async (packageIds: string[], signature: string, managerCode: string): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/pickup/confirm`, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ packageIds, signatureDataURL: signature, managerCode }), 
    });
    if (!response.ok) throw new Error((await response.json()).error || '提交失敗');
  },
  
  generateOTP: async (id: string): Promise<void> => { 
    await fetch(`${API_BASE_URL}/packages/${id}/otp`, { method: 'POST' }); 
  },
  
  verifyAndPickup: async (id: string, otp: string, signature: string, managerCode: string): Promise<void> => {
      const r = await fetch(`${API_BASE_URL}/packages/${id}/pickup`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ otp, signatureDataURL: signature, managerCode }) 
      });
      if (!r.ok) throw new Error('驗證失敗');
  },
  
  getAllUsers: async (): Promise<User[]> => {
    try { 
      const r = await fetch(`${API_BASE_URL}/users`); 
      if (!r.ok) return [];
      return await r.json(); 
    } catch (e) { 
      return []; 
    }
  },
  
  deleteUser: async (id: string): Promise<void> => { 
    const response = await fetch(`${API_BASE_URL}/users/${id}`, { method: 'DELETE' }); 
    if (!response.ok) throw new Error('刪除失敗');
  },
  
  deletePackage: async (id: string): Promise<void> => { 
    const response = await fetch(`${API_BASE_URL}/packages/${id}`, { method: 'DELETE' }); 
    if (!response.ok) throw new Error('刪除失敗');
  },
  
  manualPickup: async (id: string): Promise<void> => { 
    const response = await fetch(`${API_BASE_URL}/packages/${id}/manual-pickup`, { method: 'POST' }); 
    if (!response.ok) throw new Error('操作失敗');
  },
  
  login: async (u: string, p: string): Promise<void> => {
      const r = await fetch(`${API_BASE_URL}/login`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ username: u, password: p }) 
      });
      if (!r.ok) throw new Error('帳號或密碼錯誤');
      const data = await r.json();
      localStorage.setItem(AUTH_KEY, data.token);
  },
  
  isLoggedIn: (): boolean => !!localStorage.getItem(AUTH_KEY),
  logout: () => { localStorage.removeItem(AUTH_KEY); }
};
