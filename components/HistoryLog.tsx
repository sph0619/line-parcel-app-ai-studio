import React from 'react';
import { PackageItem } from '../types';
import { CheckCircle2, Image as ImageIcon } from 'lucide-react';

interface Props {
  packages: PackageItem[];
}

const formatDateTime = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleString('zh-TW', { 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit', 
    hour12: false 
  });
};

const formatDateShort = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`;
}

export const HistoryLog: React.FC<Props> = ({ packages }) => {
  const historyItems = packages.filter(p => p.status === 'Picked Up');

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-6 border-b border-slate-100">
         <h3 className="font-bold text-slate-800">歷史紀錄</h3>
         <p className="text-sm text-slate-500">所有已完成領取程序的包裹紀錄。</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-4 font-semibold text-slate-700">領取時間</th>
              <th className="px-6 py-4 font-semibold text-slate-700">戶號</th>
              <th className="px-6 py-4 font-semibold text-slate-700">包裹 ID</th>
              <th className="px-6 py-4 font-semibold text-slate-700">證明</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {historyItems.map((pkg) => (
              <tr key={pkg.packageId} className="hover:bg-slate-50">
                <td className="px-6 py-4">
                  <div className="flex flex-col">
                    <span className="font-medium text-slate-800">
                      {pkg.pickupTime ? formatDateTime(pkg.pickupTime) : '-'}
                    </span>
                    <span className="text-xs text-slate-400">
                      到貨: {formatDateShort(pkg.receivedTime)}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 font-bold text-slate-700">
                  {pkg.householdId}
                </td>
                <td className="px-6 py-4 text-slate-500 font-mono text-xs">
                  {pkg.barcode}
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                     <div className="flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2 py-1 rounded text-xs font-bold">
                        <CheckCircle2 size={14} />
                        已驗證
                     </div>
                     {pkg.signatureDataURL && (
                       <div className="group relative">
                          <ImageIcon size={18} className="text-slate-400 cursor-help" />
                          <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block z-50 bg-white p-2 shadow-xl rounded-lg border border-slate-200">
                            <img src={pkg.signatureDataURL} alt="Signature" className="w-32 h-auto border border-slate-100" />
                            <p className="text-[10px] text-center text-slate-400 mt-1">數位簽名檔</p>
                          </div>
                       </div>
                     )}
                  </div>
                </td>
              </tr>
            ))}
            {historyItems.length === 0 && (
              <tr>
                <td colSpan={4} className="p-8 text-center text-slate-400">尚無歷史紀錄。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};