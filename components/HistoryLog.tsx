import React, { useState, useMemo } from 'react';
import { PackageItem } from '../types';
import { BadgeCheck, Image as ImageIcon, UserCircle, Hand, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { parseDate, formatDateTime, formatDateShort } from '../lib/dateUtils';

interface Props {
  packages: PackageItem[];
}

const ITEMS_PER_PAGE = 50;

export const HistoryLog: React.FC<Props> = ({ packages }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  // 1. 過濾與排序
  const filteredItems = useMemo(() => {
    return packages
      .filter(p => p.status === 'Picked Up')
      .filter(p => {
        const searchLower = searchTerm.toLowerCase();
        return (
          p.householdId.toLowerCase().includes(searchLower) ||
          (p.recipientName || '').toLowerCase().includes(searchLower) ||
          (p.barcode || '').toLowerCase().includes(searchLower)
        );
      })
      .sort((a, b) => {
        const timeA = a.pickupTime ? parseDate(a.pickupTime).getTime() : 0;
        const timeB = b.pickupTime ? parseDate(b.pickupTime).getTime() : 0;
        return timeB - timeA;
      });
  }, [packages, searchTerm]);

  // 2. 分頁計算
  const totalPages = Math.ceil(filteredItems.length / ITEMS_PER_PAGE);
  const paginatedItems = filteredItems.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  // 當搜尋字串改變時，回到第一頁
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1);
  };

  return (
    <div className="space-y-4">
      {/* 搜尋與統計列 */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="搜尋戶號、姓名或條碼..."
            value={searchTerm}
            onChange={handleSearchChange}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
          />
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-slate-500">
            找到 <span className="font-bold text-blue-600">{filteredItems.length}</span> 筆紀錄
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-2 border-l pl-4 border-slate-200">
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-30"
              >
                <ChevronLeft size={20} />
              </button>
              <span className="font-medium text-slate-700">
                第 {currentPage} / {totalPages} 頁
              </span>
              <button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-30"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <h3 className="font-bold text-slate-800 text-lg">歷史領取紀錄</h3>
          <p className="text-sm text-slate-500">所有完成領取並經過驗證的包裹清單。</p>
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
              {paginatedItems.map((pkg) => {
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
              {paginatedItems.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-12 text-center text-slate-300 italic">
                    {searchTerm ? `找不到與 "${searchTerm}" 相關的紀錄。` : '尚無任何已領取的包裹歷史紀錄。'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 底部簡易分頁 */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-4 py-4">
          <button
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            disabled={currentPage === 1}
            className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-all flex items-center gap-2"
          >
            <ChevronLeft size={18} /> 上一頁
          </button>
          <span className="text-sm font-medium text-slate-500">
            第 {currentPage} 頁，共 {totalPages} 頁
          </span>
          <button
            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
            disabled={currentPage === totalPages}
            className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-all flex items-center gap-2"
          >
            下一頁 <ChevronRight size={18} />
          </button>
        </div>
      )}
    </div>
  );
};
