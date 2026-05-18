import React, { useState, useRef, useEffect } from 'react';
import { PackageItem, PickupSession } from '../types';
import { ShieldCheck, Search, CheckSquare, Square, PenTool, CheckCircle, Loader2, User, AlertCircle, RefreshCw, BadgeCheck, Lock, CreditCard } from 'lucide-react';
import { SignaturePad } from './SignaturePad';
import { packageService } from '../services/packageService';
import { triggerToast } from './Toaster';

interface Props {
  onSuccess: () => void;
}

type Step = 'INPUT_OTP' | 'INTERACTION' | 'SUCCESS';
type AuthMethod = 'OTP' | 'RFID';

export const PickupFlow: React.FC<Props> = ({ onSuccess }) => {
  const [step, setStep] = useState<Step>('INPUT_OTP');
  const [authMethod, setAuthMethod] = useState<AuthMethod>('OTP');
  const [otp, setOtp] = useState('');
  const [rfidValue, setRfidValue] = useState('');
  const [managerCode, setManagerCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<PickupSession | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [signature, setSignature] = useState('');
  const [rfidConfirmValue, setRfidConfirmValue] = useState('');
  
  const rfidInputRef = useRef<HTMLInputElement>(null);
  const rfidConfirmInputRef = useRef<HTMLInputElement>(null);

  const handleVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (authMethod === 'OTP' && otp.length !== 4) {
        triggerToast('請輸入 4 位數驗證碼', 'error');
        return;
    }
    if (authMethod === 'RFID' && !rfidValue) return;

    setLoading(true);
    try {
        let data;
        if (authMethod === 'OTP') {
            data = await packageService.verifyPickupOTP(otp);
        } else {
            data = await packageService.verifyRFID(rfidValue);
        }
        setSession(data);
        setSelectedIds(new Set(data.packages.map(p => p.packageId)));
        setStep('INTERACTION');
    } catch (err: any) {
        triggerToast(err.message || '驗證失敗，查無資料或已過期', 'error');
        setRfidValue('');
    } finally {
        setLoading(false);
    }
  };

  const handleRFIDConfirm = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!rfidConfirmValue || !session) return;
    
    if (rfidConfirmValue.trim() !== session.user.rfidTag?.trim()) {
      triggerToast('磁扣內容不符，請感應同一張磁扣', 'error');
      setRfidConfirmValue('');
      return;
    }
    
    handleSubmit(true);
  };

  const handleSubmit = async (isRFID = false) => {
      if (selectedIds.size === 0) {
          triggerToast('請選擇要領取的包裹', 'error');
          return;
      }
      if (managerCode.length !== 4) {
          triggerToast('請輸入 4 位數承辦人代碼', 'error');
          return;
      }
      if (!signature && !isRFID) {
          triggerToast('請住戶簽名以供存查', 'error');
          return;
      }
      setLoading(true);
      try {
          await packageService.confirmBatchPickup(
            Array.from(selectedIds), 
            isRFID ? '' : signature, 
            managerCode,
            isRFID ? rfidConfirmValue : undefined
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
      setStep('INPUT_OTP');
      setAuthMethod('OTP');
      setOtp('');
      setRfidValue('');
      setRfidConfirmValue('');
      setManagerCode('');
      setSession(null);
      setSelectedIds(new Set());
      setSignature('');
  };

  useEffect(() => {
    if (step === 'INPUT_OTP' && authMethod === 'RFID') {
      rfidInputRef.current?.focus();
    }
  }, [step, authMethod]);

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

  if (step === 'INPUT_OTP') {
      return (
          <div className="max-w-md mx-auto mt-10">
              <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center">
                  <div className="flex gap-2 p-1 bg-slate-100 rounded-xl mb-8">
                    <button 
                      onClick={() => setAuthMethod('OTP')}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${authMethod === 'OTP' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
                    >
                      驗證碼(OTP)
                    </button>
                    <button 
                      onClick={() => setAuthMethod('RFID')}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${authMethod === 'RFID' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
                    >
                      磁扣感應
                    </button>
                  </div>

                  <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6">
                      {authMethod === 'OTP' ? <ShieldCheck size={32} className="text-blue-600" /> : <CreditCard size={32} className="text-blue-600" />}
                  </div>
                  <h2 className="text-2xl font-bold text-slate-800 mb-2">
                    {authMethod === 'OTP' ? '領取包裹驗證' : '住戶磁扣感應'}
                  </h2>
                  <p className="text-slate-500 mb-8">
                    {authMethod === 'OTP' ? '請輸入住戶 Line 收到的 4 位數驗證碼' : '請將住戶磁扣靠近感應器'}
                  </p>
                  
                  {authMethod === 'OTP' ? (
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
                            查詢包裹清單
                        </button>
                    </form>
                  ) : (
                    <div className="space-y-6">
                        <input
                            ref={rfidInputRef}
                            type="text"
                            className="w-full text-center text-2xl tracking-widest font-mono border-2 border-blue-100 rounded-xl py-4 focus:border-blue-500 bg-slate-50 outline-none"
                            placeholder="等待感應..."
                            value={rfidValue}
                            onChange={(e) => setRfidValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && rfidValue) {
                                handleVerify();
                              }
                            }}
                            autoFocus
                        />
                        <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
                          <Loader2 size={14} className="animate-spin" />
                          正在等待讀卡器輸入...
                        </div>
                    </div>
                  )}
              </div>
          </div>
      );
  }

  if (step === 'SUCCESS') {
      return (
          <div className="max-w-md mx-auto mt-10 text-center">
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
      <div className="max-w-5xl mx-auto space-y-6 pb-20">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-xl">{session?.user.householdId.slice(0, 2)}</div>
                  <div>
                      <h3 className="text-lg font-bold text-slate-800">{session?.user.householdId} 住戶領取</h3>
                      <div className="flex items-center gap-2 text-slate-500 text-sm"><User size={14} /><span>驗證人: {session?.user.name}</span></div>
                  </div>
              </div>
              <button onClick={resetFlow} className="text-slate-400 hover:text-slate-600 text-sm flex items-center gap-1"><RefreshCw size={14} /> 重設流程</button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                  <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                      <h4 className="font-bold text-slate-700 flex items-center gap-2"><CheckSquare size={18}/> 選擇領取項目</h4>
                      <button onClick={toggleAll} className="text-blue-600 text-sm font-medium">{selectedIds.size === session?.packages.length ? '取消全選' : '全選全部'}</button>
                  </div>
                  <div className="p-4 space-y-3 max-h-[500px] overflow-y-auto">
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
                          <h4 className="font-bold">承辦人授權</h4>
                      </div>
                      <div className="space-y-4">
                          <label className="block text-sm font-semibold text-slate-600">承辦人代碼</label>
                          <div className="relative">
                             <input
                                type="text"
                                maxLength={4}
                                value={managerCode}
                                onChange={(e) => setManagerCode(e.target.value.replace(/\D/g, ''))}
                                className="w-full text-center text-3xl tracking-[0.3em] font-mono py-3 bg-slate-50 border-2 border-slate-200 rounded-xl focus:border-blue-500 focus:bg-white outline-none transition-all"
                                placeholder="----"
                             />
                             <Lock className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={16} />
                          </div>
                          <p className="text-[10px] text-slate-400 text-center">請輸入管理員 4 位數帳號進行授權</p>
                      </div>
                  </div>

                  <div className="bg-blue-600 p-6 rounded-2xl text-white shadow-xl shadow-blue-200">
                      <div className="text-center mb-4">
                          <p className="text-blue-100 text-xs uppercase font-bold tracking-widest">待領總數</p>
                          <p className="text-5xl font-black mt-1">{selectedIds.size}</p>
                      </div>
                      <p className="text-xs text-blue-100 text-center leading-relaxed">請確保已核對住戶身份，並使用{authMethod === 'OTP' ? '簽名' : '磁扣二次感應'}完成領取。</p>
                  </div>
              </div>
          </div>

          <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 space-y-6">
              <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-800">
                      {authMethod === 'OTP' ? (
                        <>
                          <PenTool size={24} className="text-blue-600" />
                          <h4 className="font-bold text-xl">住戶電子簽名</h4>
                        </>
                      ) : (
                        <>
                          <CreditCard size={24} className="text-blue-600" />
                          <h4 className="font-bold text-xl">磁扣二次感應確認</h4>
                        </>
                      )}
                  </div>
                  <div className="text-xs text-slate-400 flex items-center gap-1">
                    <AlertCircle size={14}/> 
                    {authMethod === 'OTP' ? '簽名後將自動存檔作為領取憑證' : '請住戶再次持磁扣靠近感應器以確認領取'}
                  </div>
              </div>
              
              {authMethod === 'OTP' ? (
                <div className="w-full h-64 border-2 border-dashed border-slate-200 rounded-2xl overflow-hidden bg-slate-50 relative group">
                    <SignaturePad 
                        width={960} 
                        height={256} 
                        onEnd={setSignature} 
                    />
                </div>
              ) : (
                <div className="w-full py-12 flex flex-col items-center justify-center border-2 border-dashed border-blue-200 rounded-2xl bg-blue-50/20">
                    <input
                      ref={rfidConfirmInputRef}
                      type="text"
                      className="opacity-0 absolute"
                      onBlur={() => rfidConfirmInputRef.current?.focus()}
                      autoFocus
                      value={rfidConfirmValue}
                      onChange={(e) => setRfidConfirmValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && rfidConfirmValue) {
                          handleRFIDConfirm();
                        }
                      }}
                    />
                    <div className="animate-pulse bg-blue-100 p-6 rounded-full mb-4">
                      <CreditCard size={48} className="text-blue-600" />
                    </div>
                    <p className="text-lg font-bold text-blue-800">請感應磁扣確認</p>
                    <p className="text-sm text-slate-500 mt-2">已選項目: {selectedIds.size} 件</p>
                </div>
              )}

              <div className="flex gap-4">
                  <button
                      onClick={() => handleSubmit(authMethod === 'RFID')}
                      disabled={(authMethod === 'OTP' && !signature) || !managerCode || selectedIds.size === 0 || loading}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white py-4 rounded-2xl font-black text-xl flex items-center justify-center gap-3 shadow-xl shadow-blue-500/20 transition-all active:scale-95"
                  >
                      {loading ? <Loader2 className="animate-spin" /> : <CheckCircle size={24} />}
                      確認包裹領取 (已選 {selectedIds.size} 件)
                  </button>
              </div>
          </div>
      </div>
  );
};
