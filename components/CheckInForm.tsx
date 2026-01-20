import React, { useState, useEffect, useRef } from 'react';
import { Scan, User, Box, ArrowRight, Loader2, X, AlertCircle, Users, Tag, Truck } from 'lucide-react';
import { packageService } from '../services/packageService';
import { triggerToast } from './Toaster';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { PackageType } from '../types';

interface Props {
  onPackageAdded: () => void;
}

const LOGISTICS_COMPANIES = [
  '黑貓宅急便',
  '新竹物流',
  '宅配通',
  '嘉里大榮',
  '中華郵政',
  '順豐速運',
  '其他'
];

export const CheckInForm: React.FC<Props> = ({ onPackageAdded }) => {
  const [householdId, setHouseholdId] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [residentList, setResidentList] = useState<string[]>([]);
  const [fetchingResidents, setFetchingResidents] = useState(false);
  
  const [barcode, setBarcode] = useState('');
  const [packageType, setPackageType] = useState<PackageType>('general');
  const [logisticsCompany, setLogisticsCompany] = useState('');
  const [loading, setLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  const householdInputRef = useRef<HTMLInputElement>(null);

  const validateHouseholdId = (id: string) => {
    const regex = /^([3-9]|1[0-9])([AC][1-3]|B[1235])$/;
    return regex.test(id.trim().toUpperCase());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
    }
  };

  useEffect(() => {
    let buffer = '';
    let lastKeyTime = Date.now();

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key.length > 1 && e.key !== 'Enter') return;
      const currentTime = Date.now();
      const timeDiff = currentTime - lastKeyTime;
      lastKeyTime = currentTime;
      const isFastInput = timeDiff < 35;

      if (e.key === 'Enter') {
        if (buffer.length > 2) {
          const finalBarcode = buffer.trim();
          setBarcode(finalBarcode);
          triggerToast(`自動填入條碼: ${finalBarcode}`, 'info');
          buffer = '';
          e.preventDefault();
          // FOOLPROOF: After barcode scan, focus on householdId if empty
          if (!householdId) {
             householdInputRef.current?.focus();
          }
          return;
        }
        buffer = '';
        return;
      }

      if (isFastInput || buffer.length > 0) {
        if (isFastInput) {
          const active = document.activeElement;
          if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
            e.preventDefault();
          }
          buffer += e.key;
        } else {
          buffer = e.key;
          setTimeout(() => {
              if (Date.now() - lastKeyTime > 50 && buffer.length === 1) buffer = '';
          }, 40);
        }
      } else { buffer = ''; }
    };

    window.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, true);
  }, [householdId]);

  useEffect(() => {
      const fetchResidents = async () => {
          const id = householdId.trim().toUpperCase();
          if (validateHouseholdId(id)) {
              setFetchingResidents(true);
              setRecipientName('');
              setResidentList([]);
              try {
                  const names = await packageService.getResidents(id);
                  setResidentList(names);
              } catch (e) { console.error(e); } finally { setFetchingResidents(false); }
          } else { setResidentList([]); }
      };
      const timeoutId = setTimeout(fetchResidents, 500);
      return () => clearTimeout(timeoutId);
  }, [householdId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    const hId = householdId.trim().toUpperCase();
    const bCode = barcode.trim();
    
    if (!hId || !bCode) {
        triggerToast('請填寫完整資訊', 'error');
        return;
    }

    if (!validateHouseholdId(hId)) {
        setErrorMsg('戶號格式錯誤');
        return;
    }

    setLoading(true);
    try {
      await packageService.addPackage(hId, bCode, recipientName, packageType, logisticsCompany);
      triggerToast(`包裹 ${bCode} 已登記成功`, 'success');
      setBarcode(''); 
      setRecipientName(''); 
      setPackageType('general');
      setLogisticsCompany('');
      onPackageAdded();
    } catch (error: any) {
      triggerToast(error.message || '登記失敗', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let html5QrCode: Html5Qrcode | null = null;
    if (isScanning) {
      const startScanning = async () => {
        try {
            html5QrCode = new Html5Qrcode("reader");
            await html5QrCode.start(
                { facingMode: "environment" },
                { fps: 25, qrbox: { width: 300, height: 150 } },
                (decodedText) => {
                    setBarcode(decodedText.trim());
                    triggerToast('掃描成功', 'success');
                    setIsScanning(false);
                    if (!householdId) householdInputRef.current?.focus();
                },
                () => {}
            );
        } catch (err) {
            triggerToast('無法啟動相機', 'error');
            setIsScanning(false);
        }
      };
      startScanning();
    }
    return () => {
        if (html5QrCode?.isScanning) {
            html5QrCode.stop().then(() => html5QrCode?.clear()).catch(e => console.error(e));
        }
    };
  }, [isScanning, householdId]);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden relative">
        <div className="p-6 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Box className="w-6 h-6" />
            包裹入庫登記
          </h2>
          <p className="text-blue-100 text-sm mt-1">登記後系統將自動發送 LINE 通知住戶</p>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700">住戶編號 (戶號)</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
              <input
                ref={householdInputRef}
                type="text"
                value={householdId}
                onKeyDown={handleKeyDown}
                onChange={(e) => setHouseholdId(e.target.value.toUpperCase())}
                placeholder="例如: 11A1"
                className={`w-full pl-10 pr-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all uppercase font-mono tracking-wider ${
                    errorMsg ? 'border-red-300' : 'border-slate-200'
                }`}
              />
            </div>
            {errorMsg && <p className="text-xs text-red-500 font-medium">{errorMsg}</p>}
          </div>

          <div className="space-y-2">
             <label className="block text-sm font-semibold text-slate-700 flex justify-between">
                <span>收件人 (選填)</span>
                {fetchingResidents && <span className="text-xs text-blue-500 animate-pulse">搜尋中...</span>}
             </label>
             <div className="relative">
                <Users className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                <select
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    disabled={residentList.length === 0}
                    className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl bg-white disabled:bg-slate-50"
                >
                    <option value="">-- 通知全體住戶 --</option>
                    {residentList.map((name, idx) => (
                        <option key={idx} value={name}>{name}</option>
                    ))}
                </select>
             </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700">包裹條碼</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Scan className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                <input
                  type="text"
                  value={barcode}
                  onKeyDown={handleKeyDown}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="掃描或輸入條碼"
                  className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-mono"
                />
              </div>
              <button 
                type="button" 
                onClick={() => setIsScanning(true)}
                className="px-4 py-2 bg-slate-800 text-white rounded-xl shadow hover:bg-slate-900 transition-colors flex flex-col items-center justify-center text-xs"
              >
                <Scan size={16} />
                <span>相機掃描</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                 <label className="block text-sm font-semibold text-slate-700">包裹類型</label>
                 <select
                    value={packageType}
                    onChange={(e) => setPackageType(e.target.value as PackageType)}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl bg-white"
                 >
                    <option value="general">📦 一般包裹</option>
                    <option value="letter">✉️ 信件 / 掛號</option>
                    <option value="frozen">🧊 冷凍包裹</option>
                 </select>
              </div>
              <div className="space-y-2">
                 <label className="block text-sm font-semibold text-slate-700">物流公司</label>
                 <select
                    value={logisticsCompany}
                    onChange={(e) => setLogisticsCompany(e.target.value)}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl bg-white"
                 >
                    <option value="">-- 未指定 --</option>
                    {LOGISTICS_COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
                 </select>
              </div>
          </div>

          <div className="pt-4">
            <button
              type="submit"
              disabled={loading || !householdId || !barcode || !!errorMsg}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white py-4 rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
            >
              {loading ? <Loader2 className="animate-spin" /> : <>確認入庫 <ArrowRight size={20}/></>}
            </button>
          </div>
        </form>

        {isScanning && (
            <div className="absolute inset-0 z-50 bg-black flex flex-col items-center justify-center">
                <div className="w-full max-w-sm px-4">
                    <div className="flex justify-between text-white mb-4">
                        <h3 className="font-bold">掃描條碼</h3>
                        <button onClick={() => setIsScanning(false)}><X size={24} /></button>
                    </div>
                    <div id="reader" className="bg-black rounded-lg overflow-hidden"></div>
                </div>
            </div>
        )}
      </div>
    </div>
  );
};
