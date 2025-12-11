import React, { useState, useMemo } from 'react';
import { PackageItem } from '../types';
import { Search, Clock, Package as PkgIcon, AlertTriangle, Filter, User } from 'lucide-react';
import { PickupModal } from './PickupModal';

interface Props {
  packages: PackageItem[];
  onUpdate: () => void;
  mode: 'pickup' | 'view';
}

const timeAgo = (dateStr: string) => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  
  if (diffInSeconds < 60) return '剛剛';
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes} 分鐘前`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours} 小時前`;
  const diffInDays = Math.floor(diffInHours / 24);
  return `${diffInDays} 天前`;
};

export const PackageList: React.FC<Props> = ({ packages, onUpdate, mode }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPkg, setSelectedPkg] = useState<PackageItem | null>(null);

  const filteredPackages = useMemo(() => {
    return packages.filter(p => 
      p.householdId.includes(searchTerm.toUpperCase()) || 
      p.barcode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.recipientName && p.recipientName.includes(searchTerm))
    );
  }, [packages, searchTerm]);

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
          <input
            type="text"
            placeholder="搜尋戶號、姓名或條碼..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">
          <Filter size={18} />
          <span>篩選</span>
        </button>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {filteredPackages.length === 0 ? (
           <div className="p-12 text-center text-slate-500">
             <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
               <PkgIcon size={32} className="text-slate-400" />
             </div>
             <p>沒有找到符合的包裹資料。</p>
           </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 font-semibold text-slate-700">狀態</th>
                  <th className="px-6 py-4 font-semibold text-slate-700">住戶資訊</th>
                  <th className="px-6 py-4 font-semibold text-slate-700">條碼</th>
                  <th className="px-6 py-4 font-semibold text-slate-700">到達時間</th>
                  <th className="px-6 py-4 font-semibold text-slate-700">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredPackages.map((pkg) => {
                  const isOverdue = pkg.status === 'Pending' && pkg.isOverdueNotified;
                  
                  return (
                    <tr key={pkg.packageId} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                          pkg.status === 'Pending' 
                            ? 'bg-amber-100 text-amber-700' 
                            : 'bg-emerald-100 text-emerald-700'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                             pkg.status === 'Pending' ? 'bg-amber-500' : 'bg-emerald-500'
                          }`} />
                          {pkg.status === 'Pending' ? '待領取' : '已領取'}
                        </span>
                        {isOverdue && (
                          <div className="mt-1 flex items-center gap-1 text-xs text-red-600 font-medium">
                            <AlertTriangle size={10} />
                            逾期
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                            <span className="font-bold text-slate-800 text-base">{pkg.householdId}</span>
                            {pkg.recipientName && (
                                <span className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                                    <User size={10} />
                                    {pkg.recipientName}
                                </span>
                            )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-slate-600 font-mono">
                        {pkg.barcode}
                      </td>
                      <td className="px-6 py-4 text-slate-500">
                        <div className="flex items-center gap-1.5">
                          <Clock size={14} />
                          {timeAgo(pkg.receivedTime)}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {mode === 'pickup' && pkg.status === 'Pending' && (
                          <button
                            onClick={() => setSelectedPkg(pkg)}
                            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-blue-700 shadow-sm shadow-blue-200 transition-all"
                          >
                            領取
                          </button>
                        )}
                        {pkg.status === 'Picked Up' && (
                           <span className="text-xs text-slate-400">已歸檔</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedPkg && (
        <PickupModal 
          pkg={selectedPkg} 
          onClose={() => setSelectedPkg(null)} 
          onSuccess={onUpdate}
        />
      )}
    </div>
  );
};
