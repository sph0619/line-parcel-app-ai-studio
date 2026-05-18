import React, { useState, useRef, useEffect } from 'react';
import { User } from '../types';
import { packageService } from '../services/packageService';
import { triggerToast } from './Toaster';
import { Search, CreditCard, Loader2, UserPlus, CheckCircle2, AlertCircle } from 'lucide-react';

export const RFIDBinding: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [rfidValue, setRfidValue] = useState('');
  const [isBinding, setIsBinding] = useState(false);
  const rfidInputRef = useRef<HTMLInputElement>(null);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchTerm.trim()) return;

    setIsSearching(true);
    setSelectedUser(null);
    setRfidValue('');
    try {
      const results = await packageService.searchUsers(searchTerm);
      setSearchResults(results);
      if (results.length === 0) {
        triggerToast('查無住戶資料', 'info');
      }
    } catch (error) {
      triggerToast('搜尋失敗', 'error');
    } finally {
      setIsSearching(false);
    }
  };

  const selectUser = (user: User) => {
    setSelectedUser(user);
    setRfidValue('');
    // Auto-focus the RFID input
    setTimeout(() => {
      rfidInputRef.current?.focus();
    }, 100);
  };

  const handleBind = async () => {
    if (!selectedUser || !rfidValue.trim()) return;

    setIsBinding(true);
    try {
      const success = await packageService.bindRFID(
        selectedUser.householdId,
        selectedUser.name,
        rfidValue
      );
      if (success) {
        triggerToast('磁扣綁定成功！', 'success');
        setSelectedUser(null);
        setRfidValue('');
        setSearchResults([]);
        setSearchTerm('');
      } else {
        triggerToast('綁定失敗，請稍後再試', 'error');
      }
    } catch (error) {
      triggerToast('綁定失敗', 'error');
    } finally {
      setIsBinding(false);
    }
  };

  // Keyboard shortcut for RFID input if hidden/focused
  useEffect(() => {
    if (selectedUser) {
      const handleGlobalKeyDown = (e: KeyboardEvent) => {
        // If user hits Enter while RFID input is focused, trigger bind
        if (e.key === 'Enter' && document.activeElement === rfidInputRef.current && rfidValue) {
          handleBind();
        }
      };
      window.addEventListener('keydown', handleGlobalKeyDown);
      return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }
  }, [selectedUser, rfidValue]);

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100">
        <div className="flex items-center gap-4 mb-8">
          <div className="p-3 bg-blue-50 rounded-2xl text-blue-600">
            <CreditCard size={28} />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-800">磁扣感應綁定</h2>
            <p className="text-slate-500 text-sm">將社區門禁磁扣與住戶資料進行關聯</p>
          </div>
        </div>

        {!selectedUser ? (
          <div className="space-y-6">
            <form onSubmit={handleSearch} className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input
                type="text"
                placeholder="輸入姓名或戶號搜尋... (例如: 10A1 或 王小明)"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-12 pr-24 py-4 rounded-2xl border-2 border-slate-100 focus:border-blue-500 outline-none transition-all text-lg shadow-sm"
              />
              <button
                type="submit"
                disabled={isSearching || !searchTerm.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 bg-blue-600 text-white px-5 py-2 rounded-xl font-bold hover:bg-blue-700 transition-colors disabled:bg-slate-300"
              >
                {isSearching ? <Loader2 className="animate-spin" size={18} /> : '搜尋'}
              </button>
            </form>

            <div className="space-y-3">
              {searchResults.map((user) => (
                <button
                  key={`${user.householdId}-${user.name}`}
                  onClick={() => selectUser(user)}
                  className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-blue-50 border border-slate-100 hover:border-blue-200 rounded-2xl transition-all group"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center font-bold text-blue-600 shadow-sm border border-slate-100 group-hover:scale-110 transition-transform">
                      {user.householdId}
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-slate-800">{user.name}</p>
                      <p className="text-xs text-slate-500">已綁定 Line: {user.lineId ? '是' : '否'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {user.rfidTag && (
                      <span className="text-[10px] px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-bold">已有磁扣</span>
                    )}
                    <UserPlus className="text-slate-300 group-hover:text-blue-500" size={20} />
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-8 py-4">
            <div className="bg-blue-50/50 p-6 rounded-2xl border border-blue-100 flex items-center gap-6">
              <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-blue-200">
                {selectedUser.householdId}
              </div>
              <div>
                <p className="text-blue-600 font-bold text-lg">{selectedUser.name}</p>
                <p className="text-slate-500 text-sm">正在等待感應磁扣...</p>
              </div>
              <button 
                onClick={() => setSelectedUser(null)}
                className="ml-auto text-slate-400 hover:text-slate-600 text-sm font-medium"
              >
                重選住戶
              </button>
            </div>

            <div className="space-y-4">
              <label className="block text-sm font-bold text-slate-700 ml-1">感應磁扣號碼 (請感應或手動輸入)</label>
              <div className="relative">
                <CreditCard className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-600" size={24} />
                <input
                  ref={rfidInputRef}
                  type="text"
                  placeholder={isBinding ? "處理中..." : "請感應磁扣..."}
                  value={rfidValue}
                  onChange={(e) => setRfidValue(e.target.value)}
                  autoFocus
                  className="w-full pl-14 pr-4 py-5 rounded-2xl border-2 border-blue-200 focus:border-blue-500 outline-none transition-all text-2xl font-mono tracking-widest shadow-inner bg-slate-50 focus:bg-white"
                />
              </div>
              <p className="text-xs text-slate-400 flex items-center gap-1.5 ml-1">
                <AlertCircle size={14} />
                磁扣感應器通常會自動輸入號碼並跳行。若感應無反應，請確認輸入焦點在此。
              </p>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setSelectedUser(null)}
                className="flex-1 py-4 px-6 rounded-2xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleBind}
                disabled={isBinding || !rfidValue.trim()}
                className="flex-[2] py-4 px-6 rounded-2xl font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all disabled:bg-slate-300 disabled:shadow-none flex items-center justify-center gap-2"
              >
                {isBinding ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle2 size={20} />}
                確認綁定磁扣
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-slate-800 p-6 rounded-2xl text-white">
        <h4 className="font-bold mb-3 flex items-center gap-2">
          <AlertCircle size={18} className="text-amber-400" />
          操作提示
        </h4>
        <ul className="text-sm text-slate-300 space-y-2 list-disc ml-5">
          <li>先搜尋住戶，點選後系統會進入等待感應狀態。</li>
          <li>只需將磁扣靠近讀卡機，系統會自動填入序號。</li>
          <li>如果同一個住戶有多個磁扣，可以重複執行此過程進行更新。</li>
          <li>此頁面僅針對單一住戶進行操作，不會載入完整住戶清單，節省流量。</li>
        </ul>
      </div>
    </div>
  );
};
