import { PackageItem, PickupSession, User, PackageType } from '../types';

const API_BASE_URL = '/api'; 
const AUTH_KEY = 'community_auth_token';
const CACHE_KEY = 'community_packages_cache';

const getFallbackPackages = (): PackageItem[] => {
  const data = localStorage.getItem(CACHE_KEY);
  return data ? JSON.parse(data) : [];
};

const setPackagesToCache = (packages: PackageItem[]) => {
  localStorage.setItem(CACHE_KEY, JSON.stringify(packages));
};

export const packageService = {
  getPackages: async (): Promise<PackageItem[]> => {
    try {
      // 加入時間戳記防止瀏覽器快取
      const response = await fetch(`${API_BASE_URL}/packages?t=${Date.now()}`);
      if (!response.ok) throw new Error('網路請求失敗');
      const data = await response.json();
      return data;
    } catch (e) { 
      console.error("Fetch packages error:", e);
      throw e; // 向上拋出錯誤，讓 UI 層級處理
    }
  },
  
  addPackage: async (householdId: string, barcode: string, recipientName?: string, packageType: PackageType = 'general', logisticsCompany: string = ''): Promise<PackageItem> => {
    const response = await fetch(`${API_BASE_URL}/packages`, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ householdId, barcode, recipientName, packageType, logisticsCompany }) 
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '登記失敗');
    return result;
  },
  
  getResidents: async (id: string): Promise<string[]> => {
    try {
        const r = await fetch(`${API_BASE_URL}/households/${id.toUpperCase()}/residents`);
        if (!r.ok) return [];
        return await r.json();
    } catch (e) { return []; }
  },
  
  generateOTP: async (packageId: string): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/packages/${packageId}/generate-otp`, { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '發送失敗');
  },

  verifyPickupOTP: async (otp: string): Promise<PickupSession> => {
    const response = await fetch(`${API_BASE_URL}/pickup/verify`, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ otp }) 
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '驗證失敗');
    return result;
  },
  
  verifyAndPickup: async (packageId: string, otp: string, signature: string, managerCode: string): Promise<void> => {
    const session = await packageService.verifyPickupOTP(otp);
    const hasPackage = session.packages.some(p => p.packageId === packageId);
    if (!hasPackage) throw new Error('此驗證碼不屬於該住戶或該包裹');
    await packageService.confirmBatchPickup([packageId], signature, managerCode);
  },

  confirmBatchPickup: async (packageIds: string[], signature: string, managerCode: string): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/pickup/confirm`, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ packageIds, signatureDataURL: signature, managerCode }), 
    });
    if (!response.ok) throw new Error('提交失敗');
  },
  
  getAllUsers: async (): Promise<User[]> => {
    try { 
      const r = await fetch(`${API_BASE_URL}/users?t=${Date.now()}`); 
      if (!r.ok) return [];
      return await r.json(); 
    } catch (e) { return []; }
  },
  
  deleteUser: async (lineId: string, householdId: string, name: string): Promise<void> => { 
    const response = await fetch(`${API_BASE_URL}/users/delete`, { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineId, householdId, name })
    }); 
    if (!response.ok) throw new Error('刪除失敗');
  },
  
  deletePackage: async (id: string): Promise<void> => { 
    const response = await fetch(`${API_BASE_URL}/packages/${id}`, { method: 'DELETE' }); 
    if (!response.ok) throw new Error('刪除失敗');
  },
  
  manualPickup: async (id: string, signature: string, managerCode: string): Promise<void> => { 
    const response = await fetch(`${API_BASE_URL}/packages/${id}/manual-pickup`, { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signatureDataURL: signature, managerCode })
    }); 
    if (!response.ok) throw new Error('操作失敗');
  },

  performArchive: async (): Promise<number> => {
    const response = await fetch(`${API_BASE_URL}/maintenance/archive`, { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '歸檔失敗');
    return result.count;
  },
  
  searchArchive: async (query: string): Promise<PackageItem[]> => {
    const response = await fetch(`${API_BASE_URL}/maintenance/archive/search?query=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error('搜尋失敗');
    return await response.json();
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
