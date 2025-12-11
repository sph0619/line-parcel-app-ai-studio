export type PackageStatus = 'Pending' | 'Picked Up' | 'Expired';

export interface PackageItem {
  packageId: string;
  barcode: string;
  householdId: string;
  recipientName?: string; // New field
  status: PackageStatus;
  receivedTime: string; // ISO String
  pickupTime?: string; // ISO String
  pickupOTP?: string;
  signatureDataURL?: string;
  isOverdueNotified: boolean;
}

export interface User {
  lineId: string;
  householdId: string;
  name: string;
  status: 'APPROVED' | 'PENDING';
  joinDate: string;
}

export type TabType = 'dashboard' | 'checkin' | 'pickup' | 'history';

// For Stats
export interface DailyStat {
  date: string;
  count: number;
}
