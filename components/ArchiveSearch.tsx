import React, { useState } from 'react';
import { PackageItem } from '../types';
import { packageService } from '../services/packageService';
import { Search, Archive, Calendar, User, Hash, Loader2, ImageIcon } from 'lucide-react';

const parseDate = (dateStr: string) => {
  if (!dateStr) return new Date();
  const isoStr = dateStr.includes(' ') && !dateStr.includes('T') 
    ? dateStr.replace(' ', 'T') 
    : dateStr;
  const date = new Date(isoStr);
  return isNaN(date.getTime()) ? new Date(dateStr) : date;
};

const formatDateTime = (dateStr: string) => {
  const date = parseDate(dateStr);
  return date.toLocaleString('zh-TW', { 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit', 
    hour12: false 
  });
};

export const ArchiveSearch: React.FC = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PackageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    try {
      const data = await packageService.searchArchive(query);
      setResults(data);
      setHasSearched(true);
    } catch (error) {
      console.error(error);
      alert('搜尋失敗');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-amber-100 text-amber-600 rounded-lg">
            <Archive size={24} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-800">封存資料查詢</h3>
            <p className="text-sm text-slate-500">搜尋已移至封存表格的舊包裹紀錄。</p>
          </div>
        </div>

        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input
              type="text"
              placeholder="輸入戶號或姓名搜尋..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="px-6 py-3 bg-amber-600 text-white font-bold rounded-xl hover:bg-amber-700 disabled:opacity-50 transition-all flex items-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : <Search size={20} />}
            搜尋
          </button>
        </form>
      </div>

      {hasSearched && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
            <span className="text-sm font-medium text-slate-600">
              搜尋結果：找到 <span className="text-amber-600 font-bold">{results.length}</span> 筆紀錄
            </span>
          </div>

          {results.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-4 font-semibold text-slate-700">領取時間</th>
                    <th className="px-6 py-4 font-semibold text-slate-700">戶號 / 收件人</th>
                    <th className="px-6 py-4 font-semibold text-slate-700">條碼</th>
                    <th className="px-6 py-4 font-semibold text-slate-700">承辦人</th>
                    <th className="px-6 py-4 font-semibold text-slate-700 text-right">簽名</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {results.map((pkg) => (
                    <tr key={pkg.packageId} className="hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 text-slate-700">
                          <Calendar size={14} className="text-slate-400" />
                          <span className="font-medium">{pkg.pickupTime ? formatDateTime(pkg.pickupTime) : '-'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-800">{pkg.householdId}</span>
                          <span className="text-xs text-slate-500 flex items-center gap-1">
                            <User size={10} /> {pkg.recipientName || '本戶成員'}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 text-slate-500 font-mono text-xs">
                          <Hash size={12} /> {pkg.barcode}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-slate-600">
                        {pkg.managerCode || '系統'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {pkg.signatureDataURL && pkg.signatureDataURL.startsWith('data:image') ? (
                           <div className="group relative inline-block">
                              <ImageIcon size={20} className="text-slate-400 cursor-help" />
                              <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block z-50 bg-white p-2 shadow-xl rounded-lg border border-slate-200 min-w-[150px]">
                                <img src={pkg.signatureDataURL} alt="Signature" className="w-full h-auto" />
                              </div>
                           </div>
                        ) : (
                          <span className="text-xs text-slate-300 italic">無</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-12 text-center text-slate-400 italic">
              找不到與「{query}」相關的封存紀錄。
            </div>
          )}
        </div>
      )}
    </div>
  );
};
