import React, { useState, useEffect, useMemo } from 'react';
import { PackageItem, User, PackageType } from '../types';
import { packageService } from '../services/packageService';
import { triggerToast } from './Toaster';
import { Trash2, Search, User as UserIcon, Package as PkgIcon, AlertTriangle, Loader2, Hand } from 'lucide-react';

interface Props {
  packages: PackageItem[];
  onUpdate: () => void;
}

type Tab = 'PACKAGES' | 'USERS';

export const ManagementPanel: React.FC<Props> = ({ packages, onUpdate }) => {
  const [activeTab, setActiveTab] = useState<Tab>('PACKAGES');
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab === 'USERS') {
      const fetchUsers = async () => {
        setLoadingUsers(true);
        try {
          const data = await packageService.getAllUsers();
          // Safety check: Filter out any potential headers that slipped through
          const cleaned = data.filter(u => 
             u.householdId && 
             u.lineId && 
             u.householdId !== '戶號' && 
             u.householdId !== 'Household ID'
          );
          setUsers(cleaned);
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

  const handleManualPickup = async (pkgId: string) => {
    if (!window.confirm('確定要手動領取此包裹嗎？')) return;
    setProcessingId(pkgId);
    try {
        await packageService.manualPickup(pkgId);
        triggerToast('手動領取成功', 'success');
        onUpdate();
    } catch (e) {
        triggerToast('操作失敗', 'error');
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

  const filteredPackages = useMemo(() => {
    const term = searchTerm.trim().toUpperCase();
    if (!term) return packages;
    return packages.filter(p => 
      p.householdId.toUpperCase().includes(term) || 
      p.barcode.toUpperCase().includes(term) ||
      (p.recipientName && p.recipientName.toUpperCase().includes(term))
    );
  }, [packages, searchTerm]);

  const filteredUsers = useMemo(() => {
    const term = searchTerm.trim().toUpperCase();
    if (!term) return users;
    return users.filter(u => 
      u.householdId.toUpperCase().includes(term) || 
      u.name.toUpperCase().includes(term)
    );
  }, [users, searchTerm]);

  const getPackageTypeLabel = (type?: PackageType) => {
      switch(type) {
          case 'frozen': return <span className="text-cyan-600 font-medium">🧊 冷凍</span>;
          case 'letter': return <span className="text-purple-600 font-medium">✉️ 信件</span>;
          default: return <span className="text-slate-500">📦 一般</span>;
      }
  };

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
      </div>

      {/* Toolbar */}
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

      {/* Content Area */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {activeTab === 'PACKAGES' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">狀態</th>
                  <th className="px-6 py-3 font-medium">戶號</th>
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
                              <button onClick={() => handleManualPickup(pkg.packageId)} disabled={!!processingId} className="p-2 text-slate-400 hover:text-emerald-600 rounded-lg">
                                {processingId === pkg.packageId ? <Loader2 size={16} className="animate-spin" /> : <Hand size={16} />}
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
                      <th className="px-6 py-3 font-medium">戶號</th>
                      <th className="px-6 py-3 font-medium">姓名</th>
                      <th className="px-6 py-3 font-medium">綁定時間</th>
                      <th className="px-6 py-3 font-medium text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredUsers.map((user, index) => (
                      <tr key={user.lineId || `user-${index}`} className="hover:bg-slate-50">
                        <td className="px-6 py-3 font-bold text-slate-700">{user.householdId}</td>
                        <td className="px-6 py-3 text-slate-700">{user.name}</td>
                        <td className="px-6 py-3 text-slate-500 text-xs">{user.joinDate ? new Date(user.joinDate).toLocaleDateString() : '-'}</td>
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
      </div>
      
      {((activeTab === 'PACKAGES' && filteredPackages.length === 0) || (activeTab === 'USERS' && filteredUsers.length === 0)) && !loadingUsers && (
         <div className="p-12 text-center text-slate-400 bg-white rounded-xl border border-dashed border-slate-200">
           找不到相符的{activeTab === 'PACKAGES' ? '包裹' : '住戶'}資料
         </div>
      )}
    </div>
  );
};
