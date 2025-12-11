import React, { useState } from 'react';
import { PackageItem } from '../types';
import { X, ShieldCheck, PenTool, CheckCircle, Loader2, Send } from 'lucide-react';
import { SignaturePad } from './SignaturePad';
import { packageService } from '../services/packageService';
import { triggerToast } from './Toaster';

interface Props {
  pkg: PackageItem;
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 'VERIFY' | 'OTP' | 'SIGNATURE';

export const PickupModal: React.FC<Props> = ({ pkg, onClose, onSuccess }) => {
  const [step, setStep] = useState<Step>('VERIFY');
  const [otpInput, setOtpInput] = useState('');
  const [signature, setSignature] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSendOTP = async () => {
    setLoading(true);
    try {
      await packageService.generateOTP(pkg.packageId);
      triggerToast('驗證碼已透過 Line 發送給住戶', 'info');
      setStep('OTP');
    } catch (e) {
      triggerToast('發送驗證碼失敗，請稍後再試', 'error');
    } finally {
      setLoading(false);
    }
  };

  const verifyOTP = async () => {
    // We assume the backend would verify this in a real scenario, 
    // but here we might just move to the signature step if using client-side flow,
    // OR we can implement a verify endpoint check here.
    // For this blueprint, we verify OTP *together* with pickup or just proceed to signature
    // depending on strictness. Let's proceed to signature for UX, then verify all at end.
    if (otpInput.length === 6) {
       setStep('SIGNATURE');
    } else {
       triggerToast('請輸入 6 位數驗證碼', 'error');
    }
  };

  const handleComplete = async () => {
    if (!signature) {
      triggerToast('請住戶簽名', 'error');
      return;
    }
    setLoading(true);
    try {
      await packageService.verifyAndPickup(pkg.packageId, otpInput, signature);
      triggerToast('包裹領取完成！', 'success');
      onSuccess();
      onClose();
    } catch (e) {
      triggerToast('驗證碼錯誤或系統異常', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <div>
            <h3 className="font-bold text-lg text-slate-800">領取驗證程序</h3>
            <p className="text-xs text-slate-500">ID: {pkg.packageId}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
            <X size={20} className="text-slate-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto">
          {step === 'VERIFY' && (
            <div className="space-y-6">
              <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 text-center">
                <p className="text-blue-600 text-sm font-bold uppercase tracking-wide">領取戶號</p>
                <div className="flex flex-col items-center justify-center">
                    <p className="text-4xl font-bold text-slate-800 mt-2">{pkg.householdId}</p>
                    {pkg.recipientName && (
                        <span className="text-sm font-medium text-slate-600 bg-white/50 px-3 py-1 rounded-full mt-2">
                            {pkg.recipientName}
                        </span>
                    )}
                </div>
                <p className="text-slate-500 text-sm mt-2">條碼: {pkg.barcode}</p>
              </div>
              
              <div className="text-center space-y-2">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                   <ShieldCheck size={32} className="text-slate-400" />
                </div>
                <h4 className="font-semibold text-slate-800">安全驗證</h4>
                <p className="text-sm text-slate-500">
                  為確保安全性，系統將發送一組一次性密碼 (OTP) 至{pkg.recipientName ? `住戶 ${pkg.recipientName}` : '住戶'}綁定的 Line 帳號。
                </p>
              </div>

              <button
                onClick={handleSendOTP}
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all"
              >
                {loading ? <Loader2 className="animate-spin" /> : <Send size={18} />}
                發送 Line 驗證碼
              </button>
            </div>
          )}

          {step === 'OTP' && (
            <div className="space-y-6">
              <div className="text-center">
                <h4 className="font-bold text-xl text-slate-800 mb-2">輸入驗證碼</h4>
                <p className="text-sm text-slate-500">
                  請詢問住戶手機收到的 6 位數驗證碼。
                </p>
              </div>

              <div className="flex justify-center">
                 <input
                  type="text"
                  maxLength={6}
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value.replace(/\D/g,''))}
                  className="w-48 text-center text-3xl tracking-[0.5em] font-mono border-b-2 border-blue-500 focus:outline-none py-2 bg-transparent"
                  placeholder="------"
                  autoFocus
                 />
              </div>

              <button
                onClick={verifyOTP}
                disabled={otpInput.length !== 6}
                className="w-full bg-slate-800 hover:bg-slate-900 disabled:bg-slate-300 text-white py-3 rounded-xl font-bold transition-all"
              >
                驗證代碼
              </button>
            </div>
          )}

          {step === 'SIGNATURE' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-slate-700 mb-2">
                <PenTool size={18} />
                <h4 className="font-bold">電子簽名</h4>
              </div>
              
              <div className="w-full h-48">
                <SignaturePad 
                   width={460} 
                   height={192} 
                   onEnd={(data) => setSignature(data)} 
                />
              </div>

              <p className="text-xs text-slate-400 text-center">
                簽名即代表確認包裹外觀無損且已收到。
              </p>

              <button
                onClick={handleComplete}
                disabled={loading || !signature}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all mt-4"
              >
                {loading ? <Loader2 className="animate-spin" /> : <CheckCircle size={18} />}
                完成領取
              </button>
            </div>
          )}
        </div>

        {/* Footer with Stepper */}
        <div className="bg-slate-50 p-4 flex justify-center gap-2">
           <div className={`h-2 w-2 rounded-full ${step === 'VERIFY' ? 'bg-blue-600' : 'bg-blue-200'}`} />
           <div className={`h-2 w-2 rounded-full ${step === 'OTP' ? 'bg-blue-600' : 'bg-blue-200'}`} />
           <div className={`h-2 w-2 rounded-full ${step === 'SIGNATURE' ? 'bg-blue-600' : 'bg-blue-200'}`} />
        </div>
      </div>
    </div>
  );
};
