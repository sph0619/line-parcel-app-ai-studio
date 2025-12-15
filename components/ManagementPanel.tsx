import React, { useState, useEffect, useMemo } from 'react';
import { PackageItem, User, PackageType } from '../types';
import { packageService } from '../services/packageService';
import { triggerToast } from './Toaster';
import { Trash2, Search, User as UserIcon, Package as PkgIcon, AlertTriangle, Loader2, Hand, CheckCircle2 } from 'lucide-react';

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

  // Fetch Users when tab changes
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
    if (!window.confirm('確定要刪除此包裹資料嗎？此操作無法復原。')) return;
    
    setProcessingId(pkgId);
    try {
      await packageService.deletePackage(pkgId);
      triggerToast('包裹已刪除', 'success');
      onUpdate(); // Refresh parent data
    } catch (e) {
      triggerToast('刪除失敗', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleManualPickup = async (pkgId: string) => {
    if (!window.confirm('確定要手動領取此包裹嗎？(適用於未攜帶手機之住戶)')) return;
    
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
    if (!window.confirm('確定要解除綁定並刪除此用戶嗎？該用戶將無法再收到 Line 通知。')) return;

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

  // Filter Logic
  const filteredPackages = useMemo(() => {
    return packages.filter(p => 
      p.householdId.includes(searchTerm.toUpperCase()) || 
      p.barcode.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [packages, searchTerm]);

  const filteredUsers = useMemo(() => {
    return users.filter(u => 
      u.householdId.includes(searchTerm.toUpperCase()) || 
      u.name.toLowerCase().includes(searchTerm.toLowerCase())
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
            activeTab === 'PACKAGES' 
              ? 'text-blue-600 border-b-2 border-blue-600' 
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <PkgIcon size={18} />
          包裹管理
        </button>
        <button
          onClick={() => { setActiveTab('USERS'); setSearchTerm(''); }}
          className={`pb-4 px-2 font-bold text-sm flex items-center gap-2 transition-all ${
            activeTab === 'USERS' 
              ? 'text-blue-600 border-b-2 border-blue-600' 
              : 'text-slate-500 hover:text-slate-700'
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
            placeholder={activeTab === 'PACKAGES' ? "搜尋條碼或戶號..." : "搜尋姓名或戶號..."}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border-none outline-none text-slate-700 bg-transparent"
          />
        </div>
        <div className="text-xs text-slate-400 border-l pl-4">
           {activeTab === 'PACKAGES' ? `${filteredPackages.length} 筆資料` : `${filteredUsers.length} 位用戶`}
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
                  <th className="px-6 py-3 font-medium">類型</th>
                  <th className="px-6 py-3 font-medium">戶號</th>
                  <th className="px-6 py-3 font-medium">條碼</th>
                  <th className="px-6 py-3 font-medium">收件人</th>
                  <th className="px-6 py-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredPackages.map(pkg => (
                  <tr key={pkg.packageId} className="hover:bg-slate-50 group">
                    <td className="px-6 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full font-bold ${
                        pkg.status === 'Pending' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {pkg.status === 'Pending' ? '待領' : '已領'}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                        {getPackageTypeLabel(pkg.packageType)}
                    </td>
                    <td className="px-6 py-3 font-bold text-slate-700">{pkg.householdId}</td>
                    <td className="px-6 py-3 font-mono text-slate-500">{pkg.barcode}</td>
                    <td className="px-6 py-3 text-slate-600">{pkg.recipientName || '-'}</td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                          {pkg.status === 'Pending' && (
                              <button
                                onClick={() => handleManualPickup(pkg.packageId)}
                                disabled={!!processingId}
                                className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                                title="手動領取"
                              >
                                {processingId === pkg.packageId ? <Loader2 size={16} className="animate-spin" /> : <Hand size={16} />}
                              </button>
                          )}
                          <button
                            onClick={() => handleDeletePackage(pkg.packageId)}
                            disabled={!!processingId}
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="刪除"
                          >
                             {processingId === pkg.packageId ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                          </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredPackages.length === 0 && (
                  <tr><td colSpan={6} className="p-8 text-center text-slate-400">無相關包裹資料</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'USERS' && (
          <div className="overflow-x-auto">
             {loadingUsers ? (
               <div className="p-12 flex justify-center text-blue-600">
                 <Loader2 className="animate-spin w-8 h-8" />
               </div>
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
                    {filteredUsers.map(user => (
                      <tr key={user.lineId} className="hover:bg-slate-50">
                        <td className="px-6 py-3 font-bold text-slate-700">{user.householdId}</td>
                        <td className="px-6 py-3 text-slate-700">{user.name}</td>
                        <td className="px-6 py-3 text-slate-500 text-xs">
                          {new Date(user.joinDate).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-3 text-right">
                          <button
                            onClick={() => handleDeleteUser(user.lineId)}
                            disabled={!!processingId}
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="解除綁定"
                          >
                             {processingId === user.lineId ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filteredUsers.length === 0 && (
                      <tr><td colSpan={4} className="p-8 text-center text-slate-400">無相關用戶資料</td></tr>
                    )}
                  </tbody>
                </table>
             )}
          </div>
        )}
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3 text-sm text-amber-800">
        <AlertTriangle className="flex-shrink-0" size={20} />
        <div>
          <p className="font-bold">管理員注意</p>
          <p>手動領取或刪除操作將直接更新 Google Sheet 資料庫且無法復原，請謹慎操作。</p>
        </div>
      </div>
    </div>
  );
};
