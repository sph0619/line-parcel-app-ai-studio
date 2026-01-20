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

  // 驗證戶號規則: 3-19樓 + 棟別A/C(1-3房) 或 棟別B(1,2,3,5房)
  const validateHouseholdId = (id: string) => {
    const regex = /^([3-9]|1[0-9])([AC][1-3]|B[1235])$/;
    return regex.test(id);
  };

  // 攔截 Enter 鍵以防止掃描器自動提交
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
    }
  };

  // --- Barcode Scanner Global Listener ---
  // This logic detects hardware barcode scanners that act as rapid keyboard inputs
  useEffect(() => {
    let buffer = '';
    let lastKeyTime = Date.now();

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Ignore functional keys except Enter
      if (e.key.length > 1 && e.key !== 'Enter') return;

      const currentTime = Date.now();
      const timeDiff = currentTime - lastKeyTime;
      lastKeyTime = currentTime;

      // Typical scanners are extremely fast (often < 20ms between chars)
      const isFastInput = timeDiff < 35;

      if (e.key === 'Enter') {
        if (buffer.length > 2) {
          setBarcode(buffer);
          triggerToast(`自動填入條碼: ${buffer}`, 'success');
          buffer = '';
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        buffer = '';
        return;
      }

      // If keys are arriving fast, it's likely a scanner
      if (isFastInput || buffer.length > 0) {
        if (isFastInput) {
          // Detect active element to prevent input into other fields
          const active = document.activeElement;
          if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
            // Prevent the key from reaching the currently focused element
            e.preventDefault();
          }
          buffer += e.key;
        } else {
          // First character of a potential scan burst
          buffer = e.key;
          
          // Small delay to check if the NEXT char is fast
          setTimeout(() => {
              if (Date.now() - lastKeyTime > 50 && buffer.length === 1) {
                  // If it was just a slow single key, reset buffer
                  buffer = '';
              }
          }, 40);
        }
      } else {
        buffer = '';
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, true);
  }, []);

  // 當戶號變更且格式正確時，抓取住戶名單
  useEffect(() => {
      const fetchResidents = async () => {
          if (validateHouseholdId(householdId)) {
              setFetchingResidents(true);
              setRecipientName(''); // Reset selection
              setResidentList([]);
              try {
                  const names = await packageService.getResidents(householdId);
                  setResidentList(names);
              } catch (e) {
                  console.error("Failed to fetch residents", e);
              } finally {
                  setFetchingResidents(false);
              }
          } else {
              setResidentList([]);
          }
      };

      const timeoutId = setTimeout(fetchResidents, 500);
      return () => clearTimeout(timeoutId);
  }, [householdId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    
    if (!householdId || !barcode) return;

    if (!validateHouseholdId(householdId)) {
        setErrorMsg('戶號格式錯誤 (規則: 3-19樓 + A/C棟1-3房 或 B棟1,2,3,5房)');
        return;
    }

    setLoading(true);
    try {
      await packageService.addPackage(householdId, barcode, recipientName, packageType, logisticsCompany);
      
      const typeText = packageType === 'frozen' ? '冷凍包裹' : packageType === 'letter' ? '信件' : '包裹';
      triggerToast(`${typeText} ${barcode} 已登記至 ${householdId} 戶 ${recipientName ? `(${recipientName})` : ''}`, 'success');
      
      setBarcode(''); 
      setRecipientName(''); 
      setPackageType('general');
      setLogisticsCompany('');
      onPackageAdded();
    } catch (error: any) {
      triggerToast(error.message || '登記失敗，請檢查網路或後端連線', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let html5QrCode: Html5Qrcode | null = null;

    if (isScanning) {
      const startScanning = async () => {
        try {
            const formatsToSupport = [
                Html5QrcodeSupportedFormats.QR_CODE,
                Html5QrcodeSupportedFormats.CODE_128,
                Html5QrcodeSupportedFormats.CODE_39,
                Html5QrcodeSupportedFormats.EAN_13,
                Html5QrcodeSupportedFormats.UPC_A,
                Html5QrcodeSupportedFormats.UPC_E
            ];

            html5QrCode = new Html5Qrcode("reader", {
                formatsToSupport: formatsToSupport,
                verbose: false,
                experimentalFeatures: {
                    useBarCodeDetectorIfSupported: true
                }
            });

            await html5QrCode.start(
                { facingMode: "environment" },
                { 
                  fps: 25,
                  qrbox: { width: 300, height: 150 }, 
                  aspectRatio: 1.0
                },
                (decodedText) => {
                    setBarcode(decodedText);
                    triggerToast('掃描成功', 'success');
                    setIsScanning(false);
                },
                (errorMessage) => {}
            );
        } catch (err) {
            console.error("Camera start failed", err);
            triggerToast('無法啟動相機，請確認權限', 'error');
            setIsScanning(false);
        }
      };
      
      startScanning();
    }

    return () => {
        if (html5QrCode && html5QrCode.isScanning) {
            html5QrCode.stop().then(() => {
                html5QrCode?.clear();
            }).catch(err => console.error(err));
        }
    };
  }, [isScanning]);

  const stopScanning = () => {
      setIsScanning(false);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden relative">
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
                onKeyDown={handleKeyDown}
                onChange={(e) => {
                    const val = e.target.value.toUpperCase();
                    setHouseholdId(val);
                    if (val && !validateHouseholdId(val)) {
                        setErrorMsg('格式範例: 11A1 (3-19樓, A/C棟1-3房, B棟1/2/3/5房)');
                    } else {
                        setErrorMsg('');
                    }
                }}
                placeholder="例如: 11A1"
                className={`w-full pl-10 pr-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all uppercase font-mono tracking-wider ${
                    errorMsg ? 'border-red-300 focus:ring-red-200' : 'border-slate-200'
                }`}
                autoFocus
              />
            </div>
            {errorMsg ? (
                <div className="flex items-center gap-1 text-xs text-red-500 font-medium animate-pulse">
                    <AlertCircle size={12} />
                    {errorMsg}
                </div>
            ) : (
                <p className="text-xs text-slate-500">格式：樓層(3-19) + 棟別(A,B,C) + 門牌(1-5, B棟不含4號)</p>
            )}
          </div>

          <div className="space-y-2 transition-opacity duration-300">
             <label className="block text-sm font-semibold text-slate-700 flex justify-between">
                <span>指定收件人 (選填)</span>
                {fetchingResidents && <span className="text-xs text-blue-500 flex items-center gap-1"><Loader2 size={12} className="animate-spin"/> 搜尋住戶中...</span>}
             </label>
             <div className="relative">
                <Users className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                <select
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    disabled={!householdId || !!errorMsg || residentList.length === 0}
                    className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all appearance-none bg-white disabled:bg-slate-50 disabled:text-slate-400"
                >
                    <option value="">-- 通知該戶全體住戶 --</option>
                    {residentList.map((name, idx) => (
                        <option key={idx} value={name}>{name}</option>
                    ))}
                </select>
             </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700">包裹條碼 / 追蹤號</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Scan className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                <input
                  type="text"
                  value={barcode}
                  onKeyDown={handleKeyDown}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="掃描或手動輸入條碼"
                  className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all font-mono"
                />
              </div>
              <button 
                type="button" 
                onClick={() => setIsScanning(true)}
                className="px-4 py-2 bg-slate-800 text-white rounded-xl hover:bg-slate-900 transition-colors flex flex-col items-center justify-center text-xs whitespace-nowrap shadow-md"
              >
                <Scan size={16} />
                <span>開啟相機</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                 <label className="block text-sm font-semibold text-slate-700">包裹類型</label>
                 <div className="relative">
                    <Tag className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                    <select
                        value={packageType}
                        onChange={(e) => setPackageType(e.target.value as PackageType)}
                        className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all appearance-none bg-white"
                    >
                        <option value="general">📦 一般包裹</option>
                        <option value="letter">✉️ 信件 / 掛號</option>
                        <option value="frozen">🧊 冷凍包裹</option>
                    </select>
                 </div>
              </div>

              <div className="space-y-2">
                 <label className="block text-sm font-semibold text-slate-700">物流公司</label>
                 <div className="relative">
                    <Truck className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                    <select
                        value={logisticsCompany}
                        onChange={(e) => setLogisticsCompany(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all appearance-none bg-white"
                    >
                        <option value="">-- 未指定 --</option>
                        {LOGISTICS_COMPANIES.map(company => (
                            <option key={company} value={company}>{company}</option>
                        ))}
                    </select>
                 </div>
              </div>
          </div>

          <div className="pt-4">
            <button
              type="submit"
              disabled={loading || !householdId || !barcode || !!errorMsg}
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

        {isScanning && (
            <div className="absolute inset-0 z-50 bg-black flex flex-col items-center justify-center">
                <div className="relative w-full max-w-sm px-4">
                    <div className="flex justify-between items-center text-white mb-4">
                        <h3 className="font-bold">掃描包裹條碼</h3>
                        <button onClick={stopScanning} className="p-2 bg-white/20 rounded-full hover:bg-white/30">
                            <X size={20} />
                        </button>
                    </div>
                    
                    <div className="relative">
                        <div id="reader" className="w-full bg-black rounded-lg overflow-hidden shadow-2xl border-2 border-slate-700"></div>
                        <div className="absolute inset-0 border-2 border-red-500/50 pointer-events-none rounded-lg" style={{ top: '50%', height: '2px', backgroundColor: 'rgba(255, 0, 0, 0.2)' }}></div>
                    </div>
                    
                    <p className="text-slate-400 text-center text-xs mt-4">
                        請將紅線對準條碼中央
                    </p>
                </div>
            </div>
        )}
      </div>

      <div className="mt-6 p-4 bg-blue-50 rounded-xl border border-blue-100">
        <h4 className="font-semibold text-blue-800 text-sm mb-2">系統自動化動作:</h4>
        <ul className="text-sm text-blue-600 space-y-1 list-disc list-inside">
          <li>驗證戶號是否已註冊 Line 帳號</li>
          <li>支援硬體掃描器，無需點選欄位即可自動填入</li>
          <li>立即發送 Line 到貨通知給住戶 (包含物流資訊)</li>
          <li>記錄入庫時間以利追蹤逾期包裹</li>
        </ul>
      </div>
    </div>
  );
};
