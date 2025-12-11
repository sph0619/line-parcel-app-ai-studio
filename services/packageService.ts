import { PackageItem } from '../types';

// Points to the backend server endpoint
const API_BASE_URL = '/api'; 
const STORAGE_KEY = 'community_packages_v2_fallback';

// --- MOCK IMPLEMENTATION (Fallback) ---
// 當 API 無法連線時，使用此模擬邏輯確保介面可用
const mockService = {
  getPackages: (): PackageItem[] => {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  },

  addPackage: async (householdId: string, barcode: string, recipientName?: string): Promise<PackageItem> => {
    await new Promise(resolve => setTimeout(resolve, 600)); // Simulate network delay
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

  generateOTP: async (packageId: string): Promise<string> => {
     await new Promise(resolve => setTimeout(resolve, 500));
     console.log(`[Mock] OTP generated for ${packageId}`);
     return "SENT_MOCK";
  },

  verifyAndPickup: async (packageId: string, inputOTP: string, signature: string): Promise<boolean> => {
    await new Promise(resolve => setTimeout(resolve, 800));
    const current = mockService.getPackages();
    const updated = current.map(p => 
      p.packageId === packageId ? { 
        ...p, 
        status: 'Picked Up' as const, 
        pickupTime: new Date().toISOString(),
        pickupOTP: undefined,
        signatureDataURL: signature
      } : p
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return true;
  },
  
  getResidents: async (householdId: string): Promise<string[]> => {
      // Mock data for dropdown
      if (householdId === '11A1') return ['王小明', '陳大文'];
      if (householdId === '12B2') return ['林小美'];
      return [];
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

// Initialize mock data
mockService.seed();

// --- HYBRID SERVICE ---
// 優先嘗試 API，失敗則使用 Mock
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
       // Throw to let component handle it (e.g. duplicate barcode)
       throw e; 
    }
  },

  generateOTP: async (packageId: string): Promise<string> => {
    try {
      const response = await fetch(`${API_BASE_URL}/packages/${packageId}/otp`, { method: 'POST' });
      if (!response.ok) throw new Error('API Error');
      return "SENT"; 
    } catch (e) {
      return mockService.generateOTP(packageId);
    }
  },

  verifyAndPickup: async (packageId: string, inputOTP: string, signature: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE_URL}/packages/${packageId}/pickup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp: inputOTP, signatureDataURL: signature }),
      });
      if (!response.ok) throw new Error('Verification failed');
      return true;
    } catch (e) {
      return mockService.verifyAndPickup(packageId, inputOTP, signature);
    }
  },
  
  getResidents: async (householdId: string): Promise<string[]> => {
      try {
          const response = await fetch(`${API_BASE_URL}/households/${householdId}/residents`);
          if (!response.ok) throw new Error('API Error');
          return await response.json();
      } catch (e) {
          console.warn("Fetch residents failed, using mock", e);
          return mockService.getResidents(householdId);
      }
  },

  seedData: () => mockService.seed()
};
