import React from 'react';
import { PackageItem } from '../types';
import { BadgeCheck, Image as ImageIcon, UserCircle, Hand } from 'lucide-react';

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
  const historyItems = packages
    .filter(p => p.status === 'Picked Up')
    .sort((a, b) => {
      const timeA = a.pickupTime ? new Date(a.pickupTime).getTime() : 0;
      const timeB = b.pickupTime ? new Date(b.pickupTime).getTime() : 0;
      return timeB - timeA;
    });

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-6 border-b border-slate-100 flex justify-between items-center">
         <div>
            <h3 className="font-bold text-slate-800 text-lg">歷史領取紀錄</h3>
            <p className="text-sm text-slate-500">所有完成領取並經過驗證的包裹清單。</p>
         </div>
         <div className="text-xs bg-slate-50 border px-3 py-1 rounded-full text-slate-400 font-medium">
            共 {historyItems.length} 筆
         </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-4 font-semibold text-slate-700">領取時間</th>
              <th className="px-6 py-4 font-semibold text-slate-700">戶號 / 收件人</th>
              <th className="px-6 py-4 font-semibold text-slate-700">領取路徑</th>
              <th className="px-6 py-4 font-semibold text-slate-700">條碼資訊</th>
              <th className="px-6 py-4 font-semibold text-slate-700 text-right">憑證</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {historyItems.map((pkg) => {
              const isManual = pkg.pickupOTP === 'MANUAL';
              
              return (
                <tr key={pkg.packageId} className="hover:bg-slate-50">
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="font-bold text-slate-800">
                        {pkg.pickupTime ? formatDateTime(pkg.pickupTime) : '-'}
                      </span>
                      <span className="text-[10px] text-slate-400 uppercase tracking-tighter">
                        入庫: {formatDateShort(pkg.receivedTime)}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="font-black text-slate-800 text-base">{pkg.householdId}</span>
                      <span className="text-xs text-slate-500 font-medium">{pkg.recipientName || '本戶成員'}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {isManual ? (
                        <div className="flex items-center gap-1.5 text-blue-600 font-bold">
                            <Hand size={14} />
                            <span>手動領取</span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5 text-emerald-600 font-bold">
                            <BadgeCheck size={14} />
                            <span>驗證通過</span>
                        </div>
                    )}
                    <div className="mt-0.5 text-[10px] text-slate-400 flex items-center gap-1">
                        <UserCircle size={10} />
                        承辦: {pkg.managerCode || '系統'}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                     <div className="flex flex-col">
                        <span className="text-xs font-mono text-slate-500">{pkg.barcode}</span>
                        <span className="text-[10px] text-slate-300">{pkg.logisticsCompany || '包裹'}</span>
                     </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end">
                       {pkg.signatureDataURL && pkg.signatureDataURL.startsWith('data:image') ? (
                         <div className="group relative">
                            <button className="p-2 hover:bg-slate-200 rounded-lg transition-colors text-slate-400">
                               <ImageIcon size={20} />
                            </button>
                            <div className="absolute bottom-full right-0 mb-3 hidden group-hover:block z-50 bg-white p-3 shadow-2xl rounded-2xl border border-slate-200 min-w-[200px]">
                              <p className="text-[10px] font-bold text-slate-400 mb-2 border-b pb-1 uppercase tracking-widest">Digital Signature</p>
                              <img src={pkg.signatureDataURL} alt="Signature" className="w-full h-auto bg-slate-50 rounded" />
                              <p className="text-[9px] text-center text-slate-300 mt-2 italic">數位簽名憑證</p>
                            </div>
                         </div>
                       ) : (
                          <span className="text-[10px] text-slate-400 italic">無簽名紀錄</span>
                       )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {historyItems.length === 0 && (
              <tr>
                <td colSpan={5} className="p-12 text-center text-slate-300 italic">尚無任何已領取的包裹歷史紀錄。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
