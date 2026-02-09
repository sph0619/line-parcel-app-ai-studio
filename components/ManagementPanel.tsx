
import React, { useState, useEffect, useMemo } from 'react';
import { PackageItem, User, PackageType } from '../types';
import { packageService } from '../services/packageService';
import { triggerToast } from './Toaster';
import { Trash2, Search, User as UserIcon, Package as PkgIcon, AlertTriangle, Loader2, Hand, Database, ChevronRight, RefreshCw, ArrowUpDown, ChevronUp, ChevronDown } from 'lucide-react';
import { ManualPickupModal } from './ManualPickupModal';

interface Props {
  packages: PackageItem[];
  onUpdate: () => void;
}

type Tab = 'PACKAGES' | 'USERS' | 'MAINTENANCE';
type SortDir = 'asc' | 'desc' | null;

export const ManagementPanel: React.FC<Props> = ({ packages, onUpdate }) => {
  const [activeTab, setActiveTab] = useState<Tab>('PACKAGES');
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [selectedPkgForManual, setSelectedPkgForManual] = useState<PackageItem | null>(null);
  
  // Sorting state for Users
  const [userSortDir, setUserSortDir] = useState<SortDir>('asc');

  useEffect(() => {
    if (activeTab === 'USERS') {
      const fetchUsers = async () => {
        setLoadingUsers(true);
        try {
          const data = await packageService.getAllUsers();
          setUsers(data);
        } catch (error) {
          triggerToast('無法載入用戶列表', 'error');
        } finally {
          setLoadingUsers(false);
        }
      };
      fetchUsers();
    }
  }, [activeTab]);

  const handleDeletePackage = async (pkgId: string) => {
    if (!window.confirm('確定要刪除此包裹資料嗎？')) return;
    setProcessingId(pkgId);
    try {
      await packageService.deletePackage(pkgId);
      triggerToast('包裹已刪除', 'success');
      onUpdate(); 
    } catch (e) {
      triggerToast('刪除失敗', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleDeleteUser = async (lineId: string) => {
    if (!window.confirm('確定要解除綁定並刪除此用戶嗎？')) return;
    setProcessingId(lineId);
    try {
      await packageService.deleteUser(lineId);
      triggerToast('用戶已刪除', 'success');
      setUsers(prev => prev.filter(u => u.lineId !== lineId));
    } catch (e) {
      triggerToast('刪除失敗', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleArchive = async () => {
    if (!window.confirm('歸檔將把 7 天前「已領取」的包裹移至備份區，這能提升系統速度。確定執行？')) return;
    setIsArchiving(true);
    try {
        const count = await packageService.performArchive();
        triggerToast(`歸檔完成！共移動 ${count} 筆過期資料。`, 'success');
        onUpdate();
    } catch (e) {
        triggerToast('歸檔失敗，請稍後再試', 'error');
    } finally {
        setIsArchiving(false);
    }
  };

  const toggleUserSort = () => {
    setUserSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
  };

  const filteredPackages = useMemo(() => {
    const term = searchTerm.trim().toUpperCase();
    if (!term) return packages;
    return packages.filter(p => 
      (p.householdId && p.householdId.toString().toUpperCase().includes(term)) || 
      (p.barcode && p.barcode.toString().toUpperCase().includes(term)) ||
      (p.recipientName && p.recipientName.toString().toUpperCase().includes(term))
    );
  }, [packages, searchTerm]);

  const filteredUsers = useMemo(() => {
    let result = [...users];
    
    // 1. 搜尋過濾
    const term = searchTerm.trim().toUpperCase();
    if (term) {
      result = result.filter(u => {
          const hId = (u.householdId || '').toString().toUpperCase().trim();
          const name = (u.name || '').toString().toUpperCase().trim();
          
          // 如果搜尋詞包含在戶號中，或者包含在姓名中，則返回 true
          return hId.includes(term) || name.includes(term);
      });
    }

    // 2. 排序邏輯 (Natural Sort)
    if (userSortDir) {
        result.sort((a, b) => {
            const valA = (a.householdId || '').toString().trim();
            const valB = (b.householdId || '').toString().trim();
            return userSortDir === 'asc' 
                ? valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' })
                : valB.localeCompare(valA, undefined, { numeric: true, sensitivity: 'base' });
        });
    }

    return result;
  }, [users, searchTerm, userSortDir]);

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-4 border-b border-slate-200">
        <button
          onClick={() => { setActiveTab('PACKAGES'); setSearchTerm(''); }}
          className={`pb-4 px-2 font-bold text-sm flex items-center gap-2 transition-all ${
            activeTab === 'PACKAGES' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <PkgIcon size={18} />
          包裹管理
        </button>
        <button
          onClick={() => { setActiveTab('USERS'); setSearchTerm(''); }}
          className={`pb-4 px-2 font-bold text-sm flex items-center gap-2 transition-all ${
            activeTab === 'USERS' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <UserIcon size={18} />
          住戶管理
        </button>
        <button
          onClick={() => { setActiveTab('MAINTENANCE'); setSearchTerm(''); }}
          className={`pb-4 px-2 font-bold text-sm flex items-center gap-2 transition-all ${
            activeTab === 'MAINTENANCE' ? 'text-amber-600 border-b-2 border-amber-600' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Database size={18} />
          系統維護
        </button>
      </div>

      {activeTab !== 'MAINTENANCE' && (
          <div className="flex items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
              <input
                type="text"
                placeholder={activeTab === 'PACKAGES' ? "搜尋條碼、戶號或姓名..." : "搜尋姓名或戶號..."}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border-none outline-none text-slate-700 bg-transparent"
              />
            </div>
            <div className="text-xs text-slate-400 border-l pl-4">
               {activeTab === 'PACKAGES' ? `${filteredPackages.length} 筆` : `${filteredUsers.length} 位`}
            </div>
          </div>
      )}

      {/* Content Area */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {activeTab === 'PACKAGES' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">狀態</th>
                  <th className="px-6 py-3 font-medium text-blue-600">戶號</th>
                  <th className="px-6 py-3 font-medium">收件人</th>
                  <th className="px-6 py-3 font-medium">條碼</th>
                  <th className="px-6 py-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredPackages.map((pkg) => (
                  <tr key={pkg.packageId} className="hover:bg-slate-50 group">
                    <td className="px-6 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full font-bold ${
                        pkg.status === 'Pending' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {pkg.status === 'Pending' ? '待領' : '已領'}
                      </span>
                    </td>
                    <td className="px-6 py-3 font-bold text-slate-700">{pkg.householdId}</td>
                    <td className="px-6 py-3 text-slate-600">{pkg.recipientName || '-'}</td>
                    <td className="px-6 py-3 font-mono text-slate-500">{pkg.barcode}</td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                          {pkg.status === 'Pending' && (
                              <button 
                                onClick={() => setSelectedPkgForManual(pkg)} 
                                disabled={!!processingId} 
                                className="p-2 text-slate-400 hover:text-blue-600 rounded-lg"
                                title="手動領取流程"
                              >
                                <Hand size={16} />
                              </button>
                          )}
                          <button onClick={() => handleDeletePackage(pkg.packageId)} disabled={!!processingId} className="p-2 text-slate-400 hover:text-red-600 rounded-lg">
                             {processingId === pkg.packageId ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                          </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'USERS' && (
          <div className="overflow-x-auto">
             {loadingUsers ? (
               <div className="p-12 flex justify-center text-blue-600"><Loader2 className="animate-spin w-8 h-8" /></div>
             ) : (
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <tr>
                      <th 
                        className="px-6 py-3 font-bold cursor-pointer hover:text-blue-600 transition-colors select-none group"
                        onClick={toggleUserSort}
                      >
                        <div className="flex items-center gap-1">
                            戶號 (點擊排序)
                            {userSortDir === 'asc' ? <ChevronUp size={14} className="text-blue-600" /> : userSortDir === 'desc' ? <ChevronDown size={14} className="text-blue-600" /> : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-100" />}
                        </div>
                      </th>
                      <th className="px-6 py-3 font-medium">姓名</th>
                      <th className="px-6 py-3 font-medium">狀態</th>
                      <th className="px-6 py-3 font-medium text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredUsers.map((user, index) => (
                      <tr key={user.lineId || `user-${index}`} className="hover:bg-slate-50">
                        <td className="px-6 py-3 font-bold text-slate-700">{user.householdId}</td>
                        <td className="px-6 py-3 text-slate-700 font-medium">{user.name || <span className="text-slate-300 italic">未填寫</span>}</td>
                        <td className="px-6 py-3">
                           {user.lineId ? (
                             <span className="text-[10px] px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-bold">LINE 已綁定</span>
                           ) : (
                             <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full font-bold">手動清單</span>
                           )}
                        </td>
                        <td className="px-6 py-3 text-right">
                          <button onClick={() => handleDeleteUser(user.lineId)} disabled={!!processingId} className="p-2 text-slate-400 hover:text-red-600 rounded-lg">
                             {processingId === user.lineId ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
             )}
          </div>
        )}

        {activeTab === 'MAINTENANCE' && (
            <div className="p-8 space-y-8">
                <div className="flex flex-col md:flex-row gap-6 items-start">
                    <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 shrink-0">
                        <Database className="text-amber-600" size={32} />
                    </div>
                    <div className="flex-1 space-y-2">
                        <h3 className="text-xl font-bold text-slate-800">資料庫優化 (資料歸檔)</h3>
                        <p className="text-slate-500 text-sm leading-relaxed">
                            隨著時間推移，包裹資料會不斷累積。執行歸檔會將 7 天以前且狀態為「已領取」的包裹移至專用的存檔表 (Archive_Packages)。這不會刪除資料，但能顯著提升系統載入速度。
                        </p>
                        <div className="flex items-center gap-4 mt-6">
                            <button 
                                onClick={handleArchive}
                                disabled={isArchiving}
                                className="bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-amber-900/10"
                            >
                                {isArchiving ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
                                立即執行清理歸檔
                            </button>
                            <span className="text-xs text-slate-400 italic">建議每個月執行一次</span>
                        </div>
                    </div>
                </div>
            </div>
        )}
      </div>
      
      {activeTab !== 'MAINTENANCE' && ((activeTab === 'PACKAGES' && filteredPackages.length === 0) || (activeTab === 'USERS' && filteredUsers.length === 0)) && !loadingUsers && (
         <div className="p-12 text-center text-slate-400 bg-white rounded-xl border border-dashed border-slate-200">
           找不到相符的{activeTab === 'PACKAGES' ? '包裹' : '住戶'}資料
         </div>
      )}

      {selectedPkgForManual && (
          <ManualPickupModal 
            pkg={selectedPkgForManual} 
            onClose={() => setSelectedPkgForManual(null)} 
            onSuccess={onUpdate} 
          />
      )}
    </div>
  );
};
