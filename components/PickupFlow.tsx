import React, { useState, useRef, useEffect } from 'react';
import { PackageItem, PickupSession } from '../types';
import { ShieldCheck, Search, CheckSquare, Square, PenTool, CheckCircle, Loader2, User, AlertCircle, RefreshCw, BadgeCheck, Lock, CreditCard } from 'lucide-react';
import { SignaturePad } from './SignaturePad';
import { packageService } from '../services/packageService';
import { triggerToast } from './Toaster';

interface Props {
  onSuccess: () => void;
}

type Step = 'INPUT' | 'INTERACTION' | 'SUCCESS';
type AuthMethod = 'OTP' | 'RFID';

export const PickupFlow: React.FC<Props> = ({ onSuccess }) => {
  const [step, setStep] = useState<Step>('INPUT');
  const [authMethod, setAuthMethod] = useState<AuthMethod>('OTP');
  const [inputValue, setInputValue] = useState('');
  const [managerCode, setManagerCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<PickupSession | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [signature, setSignature] = useState('');
  const [isRfidVerified, setIsRfidVerified] = useState(false);
  
  const inputRef = useRef<HTMLInputElement>(null);

  const handleVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputValue) return;

    setLoading(true);
    try {
        let data;
        let method: AuthMethod = 'OTP';
        
        // Detect if it's OTP (4 digits) or RFID (longer)
        if (inputValue.length === 4 && /^\d+$/.test(inputValue)) {
            method = 'OTP';
            data = await packageService.verifyPickupOTP(inputValue);
            setIsRfidVerified(false);
            setSignature(''); 
        } else {
            method = 'RFID';
            data = await packageService.verifyRFID(inputValue);
            setIsRfidVerified(true);
            setSignature('RFID_VERIFIED'); // Auto-signature for RFID
        }

        setAuthMethod(method);
        
        if (data.packages.length === 0) {
            if (method === 'RFID') {
                triggerToast(`住戶 ${data.user.householdId} (${data.user.name}) 目前無待領包裹！`, 'error');
            } else {
                triggerToast('該驗證碼目前無待領包裹！', 'error');
            }
            setInputValue('');
            return;
        }

        setSession(data);
        setSelectedIds(new Set(data.packages.map(p => p.packageId))); // Auto-select all
        setStep('INTERACTION');
        
        if (method === 'RFID') {
            triggerToast('磁扣驗證成功，已自動勾選預備領取', 'success');
        }
    } catch (err: any) {
        triggerToast(err.message || '驗證失敗，查無資料或磁扣未綁定', 'error');
        setInputValue('');
    } finally {
        setLoading(false);
    }
  };

  const handleSubmit = async () => {
      if (selectedIds.size === 0) {
          triggerToast('請選擇要領取的包裹', 'error');
          return;
      }
      if (managerCode.length !== 4) {
          triggerToast('請輸入 4 位數承辦人代碼', 'error');
          return;
      }
      if (!signature) {
          triggerToast('住戶需完成簽名或磁扣驗證', 'error');
          return;
      }
      setLoading(true);
      try {
          await packageService.confirmBatchPickup(
            Array.from(selectedIds), 
            authMethod === 'RFID' ? '' : signature, 
            managerCode,
            authMethod === 'RFID' ? inputValue : undefined
          );
          triggerToast(`成功領取 ${selectedIds.size} 件包裹`, 'success');
          setStep('SUCCESS');
          onSuccess();
      } catch (err: any) {
          triggerToast(err.message || '提交失敗，請檢查代碼或網路', 'error');
      } finally {
          setLoading(false);
      }
  };

  const resetFlow = () => {
      setStep('INPUT');
      setAuthMethod('OTP');
      setInputValue('');
      setManagerCode('');
      setSession(null);
      setSelectedIds(new Set());
      setSignature('');
      setIsRfidVerified(false);
  };

  useEffect(() => {
    if (step === 'INPUT') {
      inputRef.current?.focus();
    }
  }, [step]);

  const togglePackage = (id: string) => {
      const newSet = new Set(selectedIds);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
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

  if (step === 'INPUT') {
      return (
          <div className="max-w-md mx-auto mt-10 px-4">
              <div className="bg-white p-8 rounded-3xl shadow-xl shadow-slate-200 border border-slate-100 text-center">
                  <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6">
                      <CreditCard size={40} className="text-blue-600" />
                  </div>
                  <h2 className="text-2xl font-black text-slate-800 mb-2">
                    包裹領取授權
                  </h2>
                  <p className="text-slate-500 mb-8 px-4 text-sm">
                    請輸入 4 位數驗證碼，或直接感應住戶磁扣
                  </p>
                  
                  <form onSubmit={handleVerify}>
                      <div className="relative group">
                          <input
                              ref={inputRef}
                              type="text"
                              value={inputValue}
                              onChange={(e) => setInputValue(e.target.value)}
                              className="w-full text-center text-3xl font-mono border-2 border-slate-100 rounded-2xl py-5 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 outline-none transition-all mb-6 bg-slate-50 focus:bg-white"
                              placeholder="感應磁扣或輸入碼"
                              autoFocus
                          />
                          <div className="absolute right-4 top-1/2 -translate-y-11 opacity-50">
                            {inputValue.length === 4 && /^\d+$/.test(inputValue) ? <ShieldCheck className="text-blue-600" /> : <CreditCard className="text-slate-400" />}
                          </div>
                      </div>
                      
                      <button
                          type="submit"
                          disabled={loading || !inputValue}
                          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-500/20 active:scale-95"
                      >
                          {loading ? <Loader2 className="animate-spin" /> : <Search size={20} />}
                          查詢包裹清單
                      </button>

                      <div className="mt-6 flex items-center justify-center gap-3 text-xs text-slate-400">
                        <span className="w-8 h-[1px] bg-slate-100"></span>
                        <span>系統會自動辨別輸入類型</span>
                        <span className="w-8 h-[1px] bg-slate-100"></span>
                      </div>
                  </form>
              </div>
          </div>
      );
  }

  if (step === 'SUCCESS') {
      return (
          <div className="max-w-md mx-auto mt-10 text-center px-4">
              <div className="bg-emerald-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle size={40} className="text-emerald-600" />
              </div>
              <h2 className="text-2xl font-bold text-slate-800 mb-2">領取成功！</h2>
              <p className="text-slate-500 mb-8">包裹已完成領取登記，可放行住戶。</p>
              <button
                  onClick={resetFlow}
                  className="w-full bg-slate-800 hover:bg-slate-900 text-white py-4 rounded-xl font-bold transition-all"
              >
                  回首頁
              </button>
          </div>
      );
  }

  return (
      <div className="max-w-5xl mx-auto space-y-6 pb-20 px-4">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-xl">{session?.user.householdId.slice(0, 2)}</div>
                  <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-slate-800">{session?.user.householdId} 住戶領取</h3>
                        {isRfidVerified && <span className="bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 rounded-full font-bold">磁扣已驗證</span>}
                      </div>
                      <div className="flex items-center gap-2 text-slate-500 text-sm"><User size={14} /><span>驗證人: {session?.user.name}</span></div>
                  </div>
              </div>
              <button onClick={resetFlow} className="text-slate-400 hover:text-slate-600 text-sm flex items-center gap-1 bg-slate-50 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"><RefreshCw size={14} /> 重設流程</button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-full min-h-[400px]">
                  <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                      <h4 className="font-bold text-slate-700 flex items-center gap-2"><CheckSquare size={18}/> 選擇領取項目</h4>
                      <button onClick={toggleAll} className="text-blue-600 text-sm font-medium hover:underline">{selectedIds.size === session?.packages.length ? '取消全選' : '全選全部'}</button>
                  </div>
                  <div className="p-4 space-y-3 flex-1 overflow-y-auto max-h-[600px]">
                      {session?.packages.map(pkg => {
                          const isSelected = selectedIds.has(pkg.packageId);
                          const isNameMismatch = pkg.recipientName && pkg.recipientName !== session.user.name;
                          return (
                              <div key={pkg.packageId} onClick={() => togglePackage(pkg.packageId)} className={`p-4 rounded-xl border flex items-start gap-4 cursor-pointer transition-all ${isSelected ? 'border-blue-500 bg-blue-50/50' : 'border-slate-100 hover:bg-slate-50'}`}>
                                  <div className={`mt-1 ${isSelected ? 'text-blue-600' : 'text-slate-300'}`}>{isSelected ? <CheckSquare size={24} /> : <Square size={24} />}</div>
                                  <div className="flex-1">
                                      <div className="flex justify-between items-start">
                                          <span className="font-mono text-slate-700 font-bold text-lg">{pkg.barcode}</span>
                                          <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded">{pkg.logisticsCompany || '包裹'}</span>
                                      </div>
                                      <div className="flex items-center gap-4 mt-2">
                                          <div className="text-sm text-slate-600 font-medium">收件人: {pkg.recipientName || '本戶住戶'}</div>
                                          {isNameMismatch && <span className="flex items-center gap-1 text-[10px] text-amber-600 font-medium bg-amber-50 px-2 py-0.5 rounded border border-amber-100"><AlertCircle size={10} />收件人不符</span>}
                                      </div>
                                  </div>
                              </div>
                          );
                      })}
                  </div>
              </div>

              <div className="space-y-6">
                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                      <div className="flex items-center gap-2 mb-4 text-slate-800">
                          <BadgeCheck size={20} className="text-blue-600" />
                          <h4 className="font-bold">承辦人授權 (必填)</h4>
                      </div>
                      <div className="space-y-4">
                          <label className="block text-sm font-semibold text-slate-600">管理員代碼</label>
                          <div className="relative">
                             <input
                                type="text"
                                maxLength={4}
                                value={managerCode}
                                onChange={(e) => setManagerCode(e.target.value.replace(/\D/g, ''))}
                                className="w-full text-center text-3xl tracking-[0.3em] font-mono py-4 bg-slate-50 border-2 border-slate-200 rounded-xl focus:border-blue-500 focus:bg-white outline-none transition-all shadow-inner focus:shadow-none"
                                placeholder="----"
                             />
                             <Lock className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={20} />
                          </div>
                      </div>
                  </div>

                  <div className="bg-blue-600 p-6 rounded-2xl text-white shadow-xl shadow-blue-200">
                      <div className="text-center mb-4">
                          <p className="text-blue-100 text-xs uppercase font-bold tracking-widest">待領總數</p>
                          <p className="text-5xl font-black mt-1">{selectedIds.size}</p>
                      </div>
                      <div className="text-xs text-blue-100 text-center leading-relaxed bg-blue-700/50 py-2 rounded-lg">
                        {isRfidVerified 
                          ? '此住戶已通過磁扣驗證，免簽名領取' 
                          : '請住戶於下方簽名板完成領取簽章'
                        }
                      </div>
                  </div>
              </div>
          </div>

          <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 space-y-6">
              <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-800">
                      <PenTool size={24} className="text-blue-600" />
                      <h4 className="font-bold text-xl">{isRfidVerified ? '磁扣身份核對完成' : '住戶電子簽名'}</h4>
                  </div>
                  <div className="text-xs text-slate-400 flex items-center gap-1">
                    <AlertCircle size={14}/> 
                    {isRfidVerified ? '系統已自動完成電子簽章' : '請住戶使用手指或筆進行簽名'}
                  </div>
              </div>
              
              {!isRfidVerified ? (
                <div className="w-full h-64 border-2 border-dashed border-slate-200 rounded-2xl overflow-hidden bg-slate-50 relative group">
                    <SignaturePad 
                        width={960} 
                        height={256} 
                        onEnd={setSignature} 
                    />
                    {!signature && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-slate-300 gap-2">
                             <PenTool size={20} />
                             <span className="font-medium italic">居民簽名處</span>
                        </div>
                    )}
                </div>
              ) : (
                <div className="w-full py-16 flex flex-col items-center justify-center border-2 border-dashed border-blue-500 rounded-2xl bg-blue-50 relative">
                    <div className="absolute inset-0 bg-[radial-gradient(#3b82f6_1px,transparent_1px)] [background-size:16px_16px] opacity-10"></div>
                    <div className="bg-white p-6 rounded-full shadow-lg shadow-blue-200 mb-6 border border-blue-100 z-10">
                      <BadgeCheck size={64} className="text-blue-600" />
                    </div>
                    <p className="text-xl font-black text-blue-900 z-10">磁扣身份快速授權</p>
                    <p className="text-sm text-blue-500 mt-2 z-10">RFID 驗證通過，無需重複簽名</p>
                </div>
              )}

              <div className="flex gap-4">
                  <button
                      onClick={handleSubmit}
                      disabled={(isRfidVerified ? false : !signature) || !managerCode || selectedIds.size === 0 || loading}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white py-5 rounded-2xl font-black text-2xl flex items-center justify-center gap-3 shadow-xl shadow-blue-500/20 transition-all active:scale-95 translate-y-0 hover:-translate-y-1"
                  >
                      {loading ? <Loader2 className="animate-spin text-white" /> : <CheckCircle size={28} className="text-white" />}
                      確認領取 ({selectedIds.size} 件)
                  </button>
              </div>
          </div>
      </div>
  );
};
