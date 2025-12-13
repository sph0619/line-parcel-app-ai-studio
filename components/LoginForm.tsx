import React, { useState } from 'react';
import { ShieldCheck, Loader2, Lock } from 'lucide-react';
import { packageService } from '../services/packageService';
import { triggerToast } from './Toaster';

interface Props {
  onLoginSuccess: () => void;
}

export const LoginForm: React.FC<Props> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;

    setLoading(true);
    try {
      await packageService.login(username, password);
      triggerToast('登入成功', 'success');
      onLoginSuccess();
    } catch (err: any) {
      triggerToast(err.message || '登入失敗，請檢查帳號密碼', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-8 text-center bg-blue-600 text-white">
          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
             <ShieldCheck size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold">社區智管系統</h1>
          <p className="text-blue-100 text-sm mt-1">管理員登入</p>
        </div>
        
        <form onSubmit={handleLogin} className="p-8 space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">帳號</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              placeholder="請輸入管理員帳號"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">密碼</label>
            <div className="relative">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  placeholder="請輸入密碼"
                />
                <Lock className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-3.5 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" /> : '登入系統'}
          </button>
        </form>
        
        <div className="p-4 bg-slate-50 text-center text-xs text-slate-400 border-t border-slate-100">
           系統版本 V2.0.1
        </div>
      </div>
    </div>
  );
};
