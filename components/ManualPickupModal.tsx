import React, { useState } from 'react';
import { PackageItem } from '../types';
import { X, AlertTriangle, PenTool, CheckCircle, Loader2, Lock } from 'lucide-react';
import { SignaturePad } from './SignaturePad';
import { packageService } from '../services/packageService';
import { triggerToast } from './Toaster';

interface Props {
  pkg: PackageItem;
  onClose: () => void;
  onSuccess: () => void;
}

export const ManualPickupModal: React.FC<Props> = ({ pkg, onClose, onSuccess }) => {
  const [signature, setSignature] = useState('');
  const [managerCode, setManagerCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleComplete = async () => {
    if (!signature) {
      triggerToast('請住戶簽名以完成手動領取程序', 'error');
      return;
    }
    if (managerCode.length !== 4) {
      triggerToast('請輸入 4 位數承辦人代碼', 'error');
      return;
    }
    setLoading(true);
    try {
      await packageService.manualPickup(pkg.packageId, signature, managerCode);
      triggerToast('手動領取完成，資料已存檔', 'success');
      onSuccess();
      onClose();
    } catch (e) {
      triggerToast('操作失敗，請檢查代碼或系統狀態', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-blue-50">
          <div>
            <h3 className="font-bold text-lg text-blue-800 flex items-center gap-2">
                <AlertTriangle size={20} />
                手動領取授權流程
            </h3>
            <p className="text-xs text-blue-600 font-medium">戶號: {pkg.householdId} | 條碼: {pkg.barcode}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-blue-100 rounded-full transition-colors">
            <X size={20} className="text-blue-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          <div className="bg-amber-50 p-4 rounded-xl border border-amber-200">
             <div className="flex gap-3">
                <AlertTriangle className="text-amber-600 shrink-0" size={20} />
                <div>
                   <p className="text-sm font-bold text-amber-800">重要安全提示</p>
                   <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                      由於手動領取未經 OTP 驗證，請管理員務必現場核對住戶身分或證件，確保包裹交付正確對象。
                   </p>
                </div>
             </div>
          </div>

          <div className="space-y-4">
             <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                    <PenTool size={16} className="text-blue-600" />
                    住戶簽名確認
                </label>
                <div className="w-full h-40 border-2 border-dashed border-slate-200 rounded-xl overflow-hidden bg-slate-50">
                    <SignaturePad width={460} height={160} onEnd={setSignature} />
                </div>
             </div>

             <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                    <Lock size={16} className="text-blue-600" />
                    承辦管理員授權碼
                </label>
                <input
                    type="text"
                    maxLength={4}
                    value={managerCode}
                    onChange={(e) => setManagerCode(e.target.value.replace(/\D/g, ''))}
                    className="w-full text-center text-2xl tracking-[0.5em] font-mono py-3 bg-white border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-4 focus:ring-blue-100 outline-none transition-all"
                    placeholder="----"
                />
             </div>
          </div>

          <button
            onClick={handleComplete}
            disabled={loading || !signature || managerCode.length !== 4}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 transition-all active:scale-95"
          >
            {loading ? <Loader2 className="animate-spin" /> : <CheckCircle size={20} />}
            確認手動領取並存檔
          </button>
        </div>
      </div>
    </div>
  );
};
