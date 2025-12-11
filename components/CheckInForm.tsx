import React, { useState, useEffect } from 'react';
import { Scan, User, Box, ArrowRight, Loader2, X, AlertCircle } from 'lucide-react';
import { packageService } from '../services/packageService';
import { triggerToast } from './Toaster';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

interface Props {
  onPackageAdded: () => void;
}

export const CheckInForm: React.FC<Props> = ({ onPackageAdded }) => {
  const [householdId, setHouseholdId] = useState('');
  const [barcode, setBarcode] = useState('');
  const [loading, setLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // 驗證戶號規則
  const validateHouseholdId = (id: string) => {
    const regex = /^([3-9]|1[0-9])([AC][1-3]|B[1-4])$/;
    return regex.test(id);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    
    if (!householdId || !barcode) return;

    if (!validateHouseholdId(householdId)) {
        setErrorMsg('戶號格式錯誤 (規則: 3-19樓 + 棟別A/B/C + 門牌)');
        return;
    }

    setLoading(true);
    try {
      await packageService.addPackage(householdId, barcode);
      triggerToast(`包裹 ${barcode} 已登記至 ${householdId} 戶`, 'success');
      setBarcode(''); // 保留戶號以便批量輸入，僅清除條碼
      onPackageAdded();
    } catch (error) {
      triggerToast('登記失敗，請檢查網路或後端連線', 'error');
    } finally {
      setLoading(false);
    }
  };

  // 啟動掃描器
  useEffect(() => {
    let html5QrCode: Html5Qrcode | null = null;

    if (isScanning) {
      const startScanning = async () => {
        try {
            // 明確指定支援的格式，針對包裹條碼優化
            const formatsToSupport = [
                Html5QrcodeSupportedFormats.QR_CODE,
                Html5QrcodeSupportedFormats.CODE_128, // 常見物流條碼
                Html5QrcodeSupportedFormats.CODE_39,  // 常見物流條碼
                Html5QrcodeSupportedFormats.EAN_13,   // 商品條碼
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
                  fps: 25, // 提高 FPS 增加靈敏度
                  // 設定為長方形掃描框，更適合長條形的一維條碼
                  qrbox: { width: 300, height: 150 }, 
                  aspectRatio: 1.0
                },
                (decodedText) => {
                    // Success callback
                    setBarcode(decodedText);
                    triggerToast('掃描成功', 'success');
                    setIsScanning(false);
                },
                (errorMessage) => {
                    // Error callback (ignore frequent errors)
                }
            );
        } catch (err) {
            console.error("Camera start failed", err);
            triggerToast('無法啟動相機，請確認權限', 'error');
            setIsScanning(false);
        }
      };
      
      startScanning();
    }

    // Cleanup function
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
                onChange={(e) => {
                    const val = e.target.value.toUpperCase();
                    setHouseholdId(val);
                    if (val && !validateHouseholdId(val)) {
                        setErrorMsg('格式範例: 11A1 (3-19樓, A/B/C棟)');
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
                <p className="text-xs text-slate-500">格式：樓層(3-19) + 棟別(A,B,C) + 門牌(1-4)</p>
            )}
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
                onClick={() => setIsScanning(true)}
                className="px-4 py-2 bg-slate-800 text-white rounded-xl hover:bg-slate-900 transition-colors flex flex-col items-center justify-center text-xs whitespace-nowrap shadow-md"
              >
                <Scan size={16} />
                <span>開啟相機</span>
              </button>
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

        {/* Camera Overlay Modal */}
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
          <li>立即發送 Line 到貨通知給住戶</li>
          <li>記錄入庫時間以利追蹤逾期包裹</li>
        </ul>
      </div>
    </div>
  );
};
