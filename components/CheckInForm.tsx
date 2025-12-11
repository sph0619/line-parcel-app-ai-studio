import React, { useState } from 'react';
import { Scan, User, Box, ArrowRight, Loader2 } from 'lucide-react';
import { packageService } from '../services/packageService';
import { triggerToast } from './Toaster';

interface Props {
  onPackageAdded: () => void;
}

export const CheckInForm: React.FC<Props> = ({ onPackageAdded }) => {
  const [householdId, setHouseholdId] = useState('');
  const [barcode, setBarcode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!householdId || !barcode) return;

    setLoading(true);
    try {
      await packageService.addPackage(householdId, barcode);
      triggerToast(`包裹 ${barcode} 已登記至 ${householdId} 戶`, 'success');
      setBarcode(''); // Keep household ID for bulk entry, clear barcode
      onPackageAdded();
    } catch (error) {
      triggerToast('登記失敗，請檢查網路或後端連線', 'error');
    } finally {
      setLoading(false);
    }
  };

  const simulateScan = () => {
    const mockBarcode = `SCAN-${Math.floor(Math.random() * 99999)}`;
    setBarcode(mockBarcode);
    triggerToast('已接收掃描槍訊號', 'info');
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Box className="w-6 h-6" />
            包裹入庫登記
          </h2>
          <p className="text-blue-100 text-sm mt-1">掃描條碼並指定戶號，系統將自動發送通知</p>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700">住戶編號 (戶號)</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
              <input
                type="text"
                value={householdId}
                onChange={(e) => setHouseholdId(e.target.value.toUpperCase())}
                placeholder="例如: 11A1"
                className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all uppercase font-mono tracking-wider"
                autoFocus
              />
            </div>
            <p className="text-xs text-slate-500">請輸入完整社區戶號</p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700">包裹條碼 / 追蹤號</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Scan className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                <input
                  type="text"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="掃描或手動輸入條碼"
                  className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all font-mono"
                />
              </div>
              <button 
                type="button" 
                onClick={simulateScan}
                className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 transition-colors flex flex-col items-center justify-center text-xs whitespace-nowrap"
              >
                <Scan size={16} />
                <span>模擬掃描</span>
              </button>
            </div>
          </div>

          <div className="pt-4">
            <button
              type="submit"
              disabled={loading || !householdId || !barcode}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white py-3.5 rounded-xl font-bold text-lg shadow-lg shadow-blue-500/30 transition-all flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin w-5 h-5" />
                  處理中...
                </>
              ) : (
                <>
                  確認入庫
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      <div className="mt-6 p-4 bg-blue-50 rounded-xl border border-blue-100">
        <h4 className="font-semibold text-blue-800 text-sm mb-2">系統自動化動作:</h4>
        <ul className="text-sm text-blue-600 space-y-1 list-disc list-inside">
          <li>驗證戶號是否已註冊 Line 帳號</li>
          <li>立即發送 Line 到貨通知給住戶</li>
          <li>記錄入庫時間以利追蹤逾期包裹</li>
        </ul>
      </div>
    </div>
  );
};