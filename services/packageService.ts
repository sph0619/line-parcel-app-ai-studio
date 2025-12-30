import { PackageItem, PickupSession, User, PackageType } from '../types';

const API_BASE_URL = '/api'; 
const STORAGE_KEY = 'community_packages_v2_fallback';
const AUTH_KEY = 'community_auth_token';

const mockService = {
  getPackages: (): PackageItem[] => {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  },
  addPackage: async (h: string, b: string, r?: string, t: PackageType = 'general', l: string = ''): Promise<PackageItem> => {
    const newPkg: PackageItem = { packageId: `PKG${Date.now()}`, barcode: b, householdId: h, recipientName: r, status: 'Pending', receivedTime: new Date().toISOString(), isOverdueNotified: false, packageType: t, logisticsCompany: l };
    const current = mockService.getPackages();
    localStorage.setItem(STORAGE_KEY, JSON.stringify([newPkg, ...current]));
    return newPkg;
  },
  confirmBatchPickup: async (ids: string[], signature: string, managerCode: string): Promise<void> => {
      const current = mockService.getPackages();
      const updated = current.map(p => ids.includes(p.packageId) ? { ...p, status: 'Picked Up' as const, pickupTime: new Date().toISOString(), signatureDataURL: signature, managerCode } : p);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  },
  manualPickup: async (id: string): Promise<void> => {
    const updated = mockService.getPackages().map(p => p.packageId === id ? { ...p, status: 'Picked Up' as const, pickupTime: new Date().toISOString(), signatureDataURL: 'Manual Pickup', managerCode: 'admin' } : p);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  },
  login: async (u: string, p: string): Promise<void> => {
      if (u === 'admin' && p === 'admin') { localStorage.setItem(AUTH_KEY, 'mock_token'); return; }
      throw new Error('帳號或密碼錯誤');
  }
};

export const packageService = {
  getPackages: async (): Promise<PackageItem[]> => {
    try {
      const response = await fetch(`${API_BASE_URL}/packages`);
      return await response.json();
    } catch (e) { return mockService.getPackages(); }
  },
  addPackage: async (householdId: string, barcode: string, recipientName?: string, packageType: PackageType = 'general', logisticsCompany: string = ''): Promise<PackageItem> => {
    const response = await fetch(`${API_BASE_URL}/packages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ householdId, barcode, recipientName, packageType, logisticsCompany }) });
    if (!response.ok) throw new Error((await response.json()).error || 'API Error');
    return await response.json();
  },
  getResidents: async (id: string): Promise<string[]> => {
    try {
        const r = await fetch(`${API_BASE_URL}/households/${id}/residents`);
        return await r.json();
    } catch (e) { return id === '11A1' ? ['王小明'] : []; }
  },
  verifyPickupOTP: async (otp: string): Promise<PickupSession> => {
    const response = await fetch(`${API_BASE_URL}/pickup/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ otp }) });
    if (!response.ok) throw new Error((await response.json()).error || '驗證失敗');
    return await response.json();
  },
  confirmBatchPickup: async (packageIds: string[], signature: string, managerCode: string): Promise<void> => {
    try {
        const response = await fetch(`${API_BASE_URL}/pickup/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ packageIds, signatureDataURL: signature, managerCode }), });
        if (!response.ok) throw new Error((await response.json()).error || '提交失敗');
    } catch (e: any) {
        if (e.message.includes('承辦人')) throw e;
        return mockService.confirmBatchPickup(packageIds, signature, managerCode);
    }
  },
  generateOTP: async (id: string): Promise<void> => { await fetch(`${API_BASE_URL}/packages/${id}/otp`, { method: 'POST' }); },
  verifyAndPickup: async (id: string, otp: string, signature: string, managerCode: string): Promise<void> => {
      const r = await fetch(`${API_BASE_URL}/packages/${id}/pickup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ otp, signatureDataURL: signature, managerCode }) });
      if (!r.ok) throw new Error('失敗');
  },
  getAllUsers: async (): Promise<User[]> => {
      try { const r = await fetch(`${API_BASE_URL}/users`); return await r.json(); }
      catch (e) { return [{ lineId: 'mock1', householdId: '11A1', name: '王小明', status: 'APPROVED', joinDate: '2025-01-01' }]; }
  },
  deleteUser: async (id: string): Promise<void> => { await fetch(`${API_BASE_URL}/users/${id}`, { method: 'DELETE' }); },
  deletePackage: async (id: string): Promise<void> => { await fetch(`${API_BASE_URL}/packages/${id}`, { method: 'DELETE' }); },
  manualPickup: async (id: string): Promise<void> => { await fetch(`${API_BASE_URL}/packages/${id}/manual-pickup`, { method: 'POST' }); },
  login: async (u: string, p: string): Promise<void> => {
      const r = await fetch(`${API_BASE_URL}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
      if (!r.ok) throw new Error('Login failed');
      localStorage.setItem(AUTH_KEY, (await r.json()).token);
  },
  isLoggedIn: (): boolean => !!localStorage.getItem(AUTH_KEY),
  logout: () => { localStorage.removeItem(AUTH_KEY); }
};
