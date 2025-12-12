import { PackageItem, PickupSession, User } from '../types';

// Points to the backend server endpoint
const API_BASE_URL = '/api'; 
const STORAGE_KEY = 'community_packages_v2_fallback';

// --- MOCK IMPLEMENTATION (Fallback) ---
const mockService = {
  getPackages: (): PackageItem[] => {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  },

  addPackage: async (householdId: string, barcode: string, recipientName?: string): Promise<PackageItem> => {
    await new Promise(resolve => setTimeout(resolve, 600)); 
    const newPkg: PackageItem = {
      packageId: `PKG${Date.now()}`,
      barcode,
      householdId,
      recipientName,
      status: 'Pending',
      receivedTime: new Date().toISOString(),
      isOverdueNotified: false,
    };
    const current = mockService.getPackages();
    localStorage.setItem(STORAGE_KEY, JSON.stringify([newPkg, ...current]));
    return newPkg;
  },

  getResidents: async (householdId: string): Promise<string[]> => {
      if (householdId === '11A1') return ['王小明', '陳大文'];
      if (householdId === '12B2') return ['林小美'];
      return [];
  },
  
  // Mock new methods
  verifyPickupOTP: async (otp: string): Promise<PickupSession> => {
      await new Promise(resolve => setTimeout(resolve, 800));
      if (otp === '888888') {
          return {
              user: { name: '王小明', householdId: '11A1' },
              packages: mockService.getPackages().filter(p => p.householdId === '11A1' && p.status === 'Pending')
          };
      }
      throw new Error('Invalid OTP');
  },

  confirmBatchPickup: async (packageIds: string[], signature: string): Promise<void> => {
      await new Promise(resolve => setTimeout(resolve, 800));
      const current = mockService.getPackages();
      const updated = current.map(p => 
          packageIds.includes(p.packageId) ? {
              ...p,
              status: 'Picked Up' as const,
              pickupTime: new Date().toISOString(),
              signatureDataURL: signature
          } : p
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  },

  generateOTP: async (packageId: string): Promise<void> => {
      await new Promise(resolve => setTimeout(resolve, 600));
      console.log(`[Mock] OTP sent for package ${packageId}`);
  },

  verifyAndPickup: async (packageId: string, otp: string, signature: string): Promise<void> => {
      await new Promise(resolve => setTimeout(resolve, 800));
      if (otp !== '888888') throw new Error('Invalid Mock OTP (try 888888)');
      
      const current = mockService.getPackages();
      const updated = current.map(p => 
          p.packageId === packageId ? {
              ...p,
              status: 'Picked Up' as const,
              pickupTime: new Date().toISOString(),
              signatureDataURL: signature
          } : p
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  },

  getAllUsers: async (): Promise<User[]> => {
      await new Promise(resolve => setTimeout(resolve, 500));
      return [
          { lineId: 'mock1', householdId: '11A1', name: '王小明', status: 'APPROVED', joinDate: '2025-01-01' },
          { lineId: 'mock2', householdId: '12B2', name: '林小美', status: 'APPROVED', joinDate: '2025-02-01' },
      ];
  },

  deleteUser: async (lineId: string): Promise<void> => {
      console.log(`[Mock] Deleted user ${lineId}`);
      await new Promise(resolve => setTimeout(resolve, 500));
  },

  deletePackage: async (packageId: string): Promise<void> => {
      console.log(`[Mock] Deleted package ${packageId}`);
      await new Promise(resolve => setTimeout(resolve, 500));
      const current = mockService.getPackages();
      const updated = current.filter(p => p.packageId !== packageId);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  },

  seed: () => {
    if (localStorage.getItem(STORAGE_KEY)) return;
    const initialData: PackageItem[] = [
      {
        packageId: 'PKG_SEED_1',
        barcode: 'SF123456789',
        householdId: '11A1',
        recipientName: '王小明',
        status: 'Pending',
        receivedTime: new Date(Date.now() - 3600000).toISOString(), 
        isOverdueNotified: false
      },
      {
        packageId: 'PKG_SEED_2',
        barcode: 'DHL987654321',
        householdId: '12B2',
        recipientName: '林小美',
        status: 'Picked Up',
        receivedTime: new Date(Date.now() - 86400000).toISOString(), 
        pickupTime: new Date(Date.now() - 82800000).toISOString(),
        signatureDataURL: '', 
        isOverdueNotified: false
      }
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initialData));
  }
};

mockService.seed();

// --- HYBRID SERVICE ---
export const packageService = {
  getPackages: async (): Promise<PackageItem[]> => {
    try {
      const response = await fetch(`${API_BASE_URL}/packages`);
      if (!response.ok) throw new Error('API Error');
      return await response.json();
    } catch (e) {
      console.warn("後端連線失敗，切換至模擬資料模式。", e);
      return mockService.getPackages();
    }
  },

  addPackage: async (householdId: string, barcode: string, recipientName?: string): Promise<PackageItem> => {
    try {
      const response = await fetch(`${API_BASE_URL}/packages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ householdId, barcode, recipientName }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'API Error');
      }
      return await response.json();
    } catch (e: any) {
       console.warn("後端連線失敗或錯誤。", e);
       throw e; 
    }
  },

  getResidents: async (householdId: string): Promise<string[]> => {
      try {
          const response = await fetch(`${API_BASE_URL}/households/${householdId}/residents`);
          if (!response.ok) throw new Error('API Error');
          return await response.json();
      } catch (e) {
          return mockService.getResidents(householdId);
      }
  },

  verifyPickupOTP: async (otp: string): Promise<PickupSession> => {
    try {
        const response = await fetch(`${API_BASE_URL}/pickup/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ otp }),
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || '驗證失敗');
        }
        return await response.json();
    } catch (e) {
        if (e instanceof Error && e.message === '驗證失敗') throw e; 
        console.warn("OTP Check failed, trying mock", e);
        return mockService.verifyPickupOTP(otp);
    }
  },

  confirmBatchPickup: async (packageIds: string[], signature: string): Promise<void> => {
      try {
        const response = await fetch(`${API_BASE_URL}/pickup/confirm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ packageIds, signatureDataURL: signature }),
        });
        if (!response.ok) throw new Error('提交失敗');
      } catch (e) {
         return mockService.confirmBatchPickup(packageIds, signature);
      }
  },

  generateOTP: async (packageId: string): Promise<void> => {
      try {
          const response = await fetch(`${API_BASE_URL}/packages/${packageId}/otp`, {
             method: 'POST'
          });
          if (!response.ok) throw new Error('發送失敗');
      } catch (e) {
          console.warn("API fail, using mock", e);
          return mockService.generateOTP(packageId);
      }
  },

  verifyAndPickup: async (packageId: string, otp: string, signature: string): Promise<void> => {
      try {
          const response = await fetch(`${API_BASE_URL}/packages/${packageId}/pickup`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ otp, signatureDataURL: signature }),
          });
          if (!response.ok) {
               const err = await response.json();
               throw new Error(err.error || '領取失敗');
          }
      } catch (e) {
          console.warn("API fail, using mock", e);
          if (e instanceof Error && (e.message.includes('領取失敗') || e.message.includes('無效'))) throw e;
          return mockService.verifyAndPickup(packageId, otp, signature);
      }
  },

  // Management APIs
  getAllUsers: async (): Promise<User[]> => {
      try {
          const response = await fetch(`${API_BASE_URL}/users`);
          if (!response.ok) throw new Error('API Error');
          return await response.json();
      } catch (e) {
          console.warn("API fail, using mock", e);
          return mockService.getAllUsers();
      }
  },

  deleteUser: async (lineId: string): Promise<void> => {
      try {
          const response = await fetch(`${API_BASE_URL}/users/${lineId}`, { method: 'DELETE' });
          if (!response.ok) throw new Error('Delete failed');
      } catch (e) {
          console.warn("API fail, using mock", e);
          return mockService.deleteUser(lineId);
      }
  },

  deletePackage: async (packageId: string): Promise<void> => {
      try {
          const response = await fetch(`${API_BASE_URL}/packages/${packageId}`, { method: 'DELETE' });
          if (!response.ok) throw new Error('Delete failed');
      } catch (e) {
          console.warn("API fail, using mock", e);
          return mockService.deletePackage(packageId);
      }
  },

  seedData: () => mockService.seed()
};
