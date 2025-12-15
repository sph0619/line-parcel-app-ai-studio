
export type PackageStatus = 'Pending' | 'Picked Up' | 'Expired';
export type PackageType = 'general' | 'letter' | 'frozen';

export interface PackageItem {
  packageId: string;
  barcode: string;
  householdId: string;
  recipientName?: string;
  status: PackageStatus;
  receivedTime: string; // ISO String
  pickupTime?: string; // ISO String
  pickupOTP?: string;
  signatureDataURL?: string;
  isOverdueNotified: boolean;
  packageType?: PackageType;
}

export interface User {
  lineId: string;
  householdId: string;
  name: string;
  status: 'APPROVED' | 'PENDING';
  joinDate: string;
}

export interface PickupSession {
  user: {
    name: string;
    householdId: string;
  };
  packages: PackageItem[];
}

export type TabType = 'dashboard' | 'checkin' | 'pickup' | 'history' | 'management';

// For Stats
export interface DailyStat {
  date: string;
  count: number;
}
