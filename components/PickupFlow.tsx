import React, { useState } from 'react';
import { PackageItem, PickupSession } from '../types';
import { ShieldCheck, Search, CheckSquare, Square, PenTool, CheckCircle, Loader2, User, AlertCircle, RefreshCw } from 'lucide-react';
import { SignaturePad } from './SignaturePad';
import { packageService } from '../services/packageService';
import { triggerToast } from './Toaster';

interface Props {
  onSuccess: () => void;
}

type Step = 'INPUT_OTP' | 'SELECT_PACKAGES' | 'SIGNATURE' | 'SUCCESS';

export const PickupFlow: React.FC<Props> = ({ onSuccess }) => {
  const [step, setStep] = useState<Step>('INPUT_OTP');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<PickupSession | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [signature, setSignature] = useState('');

  // Step 1: Verify OTP
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== 4) {
        triggerToast('請輸入 4 位數驗證碼', 'error');
        return;
    }
    setLoading(true);
    try {
        const data = await packageService.verifyPickupOTP(otp);
        setSession(data);
        // Default select all
        setSelectedIds(new Set(data.packages.map(p => p.packageId)));
        setStep('SELECT_PACKAGES');
    } catch (err: any) {
        triggerToast(err.message || '驗證碼無效或過期', 'error');
    } finally {
        setLoading(false);
    }
  };

  // Step 2: Toggle Selection
  const togglePackage = (id: string) => {
      const newSet = new Set(selectedIds);
      if (newSet.has(id)) {
          newSet.delete(id);
      } else {
          newSet.add(id);
      }
      setSelectedIds(newSet);
  };

  const toggleAll = () => {
      if (!session) return;
      if (selectedIds.size === session.packages.length) {
          setSelectedIds(new Set());
      } else {
          setSelectedIds(new Set(session.packages.map(p => p.packageId)));
      }
  };

  // Step 3: Confirm & Go to Signature
  const handleToSignature = () => {
      if (selectedIds.size === 0) {
          triggerToast('請至少選擇一件包裹', 'error');
          return;
      }
      setStep('SIGNATURE');
  };

  // Step 4: Final Submit
  const handleSubmit = async () => {
      if (!signature) {
          triggerToast('請住戶簽名', 'error');
          return;
      }
      setLoading(true);
      try {
          await packageService.confirmBatchPickup(Array.from(selectedIds), signature);
          triggerToast(`成功領取 ${selectedIds.size} 件包裹`, 'success');
          setStep('SUCCESS');
          onSuccess(); // Trigger global refresh
      } catch (err) {
          triggerToast('提交失敗，請重試', 'error');
      } finally {
          setLoading(false);
      }
  };

  const resetFlow = () => {
      setStep('INPUT_OTP');
      setOtp('');
      setSession(null);
      setSelectedIds(new Set());
      setSignature('');
  };

  if (step === 'INPUT_OTP') {
      return (
          <div className="max-w-md mx-auto mt-10">
              <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center">
                  <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6">
                      <ShieldCheck size={32} className="text-blue-600" />
                  </div>
                  <h2 className="text-2xl font-bold text-slate-800 mb-2">領取包裹驗證</h2>
                  <p className="text-slate-500 mb-8">請輸入住戶 Line 收到的 4 位數驗證碼</p>
                  
                  <form onSubmit={handleVerify}>
                      <input
                          type="text"
                          maxLength={4}
                          value={otp}
                          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                          className="w-full text-center text-4xl tracking-[0.5em] font-mono border-2 border-slate-200 rounded-xl py-4 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 outline-none transition-all mb-6"
                          placeholder="----"
                          autoFocus
                      />
                      <button
                          type="submit"
                          disabled={loading || otp.length !== 4}
                          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-all"
                      >
                          {loading ? <Loader2 className="animate-spin" /> : <Search size={20} />}
                          查詢包裹
                      </button>
                  </form>
              </div>
              <p className="text-center text-slate-400 text-sm mt-6">
                  提示：住戶請在 Line 輸入「領取」以獲取驗證碼
              </p>
          </div>
      );
  }

  if (step === 'SUCCESS') {
      return (
          <div className="max-w-md mx-auto mt-10 text-center">
              <div className="bg-emerald-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle size={40} className="text-emerald-600" />
              </div>
              <h2 className="text-2xl font-bold text-slate-800 mb-2">領取完成</h2>
              <p className="text-slate-500 mb-8">系統已更新包裹狀態並存檔</p>
              <button
                  onClick={resetFlow}
                  className="bg-slate-800 text-white px-8 py-3 rounded-xl font-bold hover:bg-slate-900 transition-all"
              >
                  回到領取首頁
              </button>
          </div>
      );
  }

  return (
      <div className="max-w-3xl mx-auto space-y-6">
          {/* Header Info */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-xl">
                      {session?.user.householdId.slice(0, 2)}
                  </div>
                  <div>
                      <h3 className="text-lg font-bold text-slate-800">{session?.user.householdId} 待領包裹</h3>
                      <div className="flex items-center gap-2 text-slate-500 text-sm">
                          <User size={14} />
                          <span>驗證人: {session?.user.name}</span>
                      </div>
                  </div>
              </div>
              <button 
                  onClick={resetFlow} 
                  className="text-slate-400 hover:text-slate-600 text-sm flex items-center gap-1"
              >
                  <RefreshCw size={14} /> 重設
              </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Package List */}
              <div className={`bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col ${step === 'SIGNATURE' ? 'opacity-50 pointer-events-none' : ''}`}>
                  <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                      <h4 className="font-bold text-slate-700">包裹清單 ({session?.packages.length})</h4>
                      <button onClick={toggleAll} className="text-blue-600 text-sm font-medium">
                          {selectedIds.size === session?.packages.length ? '取消全選' : '全選'}
                      </button>
                  </div>
                  <div className="p-2 space-y-2 max-h-[400px] overflow-y-auto">
                      {session?.packages.map(pkg => {
                          const isSelected = selectedIds.has(pkg.packageId);
                          const isNameMismatch = pkg.recipientName && pkg.recipientName !== session.user.name;
                          
                          return (
                              <div 
                                  key={pkg.packageId}
                                  onClick={() => togglePackage(pkg.packageId)}
                                  className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                                      isSelected 
                                          ? 'border-blue-500 bg-blue-50/50' 
                                          : 'border-slate-100 hover:bg-slate-50'
                                  }`}
                              >
                                  <div className={`mt-1 ${isSelected ? 'text-blue-600' : 'text-slate-300'}`}>
                                      {isSelected ? <CheckSquare size={20} /> : <Square size={20} />}
                                  </div>
                                  <div className="flex-1">
                                      <div className="flex justify-between items-start">
                                          <span className="font-mono text-slate-700 font-medium">{pkg.barcode}</span>
                                          {pkg.isOverdueNotified && (
                                              <span className="bg-amber-100 text-amber-700 text-[10px] px-1.5 py-0.5 rounded">逾期</span>
                                          )}
                                      </div>
                                      <div className="text-xs text-slate-500 mt-1">
                                          收件人: {pkg.recipientName || '未指定'}
                                      </div>
                                      {isNameMismatch && (
                                          <div className="flex items-center gap-1 text-[10px] text-amber-600 mt-1 font-medium bg-amber-50 inline-block px-1 rounded">
                                              <AlertCircle size={10} /> 
                                              與驗證人不同
                                          </div>
                                      )}
                                  </div>
                              </div>
                          );
                      })}
                  </div>
                  <div className="p-4 border-t border-slate-100 bg-slate-50">
                      <div className="flex justify-between items-center mb-4">
                          <span className="text-slate-500 text-sm">已選擇</span>
                          <span className="font-bold text-slate-800 text-lg">{selectedIds.size} 件</span>
                      </div>
                      <button
                          onClick={handleToSignature}
                          disabled={selectedIds.size === 0}
                          className="w-full bg-slate-800 hover:bg-slate-900 disabled:bg-slate-300 text-white py-3 rounded-xl font-bold"
                      >
                          下一步：簽名
                      </button>
                  </div>
              </div>

              {/* Signature Area */}
              <div className={`flex flex-col gap-4 transition-all duration-500 ${step === 'SELECT_PACKAGES' ? 'opacity-50 blur-sm pointer-events-none' : 'opacity-100'}`}>
                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 h-full flex flex-col">
                      <div className="flex items-center gap-2 mb-4 text-slate-800">
                          <PenTool size={20} />
                          <h4 className="font-bold">電子簽名確認</h4>
                      </div>
                      
                      <div className="flex-1 min-h-[200px] border-2 border-dashed border-slate-200 rounded-xl overflow-hidden bg-slate-50 relative">
                           {step === 'SIGNATURE' ? (
                               <SignaturePad 
                                  width={350} 
                                  height={300} // Taller for better mobile signing
                                  onEnd={setSignature} 
                               />
                           ) : (
                               <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm">
                                   請先選擇包裹
                               </div>
                           )}
                      </div>
                      
                      <div className="mt-4">
                          <button
                              onClick={handleSubmit}
                              disabled={!signature || loading}
                              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-200"
                          >
                              {loading ? <Loader2 className="animate-spin" /> : <CheckCircle size={20} />}
                              確認領取 ({selectedIds.size})
                          </button>
                          {step === 'SIGNATURE' && (
                              <button 
                                  onClick={() => setStep('SELECT_PACKAGES')}
                                  className="w-full text-slate-500 text-sm mt-3 hover:text-slate-700"
                              >
                                  返回修改清單
                              </button>
                          )}
                      </div>
                  </div>
              </div>
          </div>
      </div>
  );
};
