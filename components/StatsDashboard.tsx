import React, { useMemo } from 'react';
import { PackageItem } from '../types';
import { Package, Truck, AlertTriangle, UserCheck } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface Props {
  packages: PackageItem[];
}

export const StatsDashboard: React.FC<Props> = ({ packages }) => {
  const stats = useMemo(() => {
    const pending = packages.filter(p => p.status === 'Pending').length;
    
    // Start of day calculation
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const today = packages.filter(p => {
       const d = new Date(p.receivedTime);
       return d >= startOfToday;
    }).length;
    
    const overdue = packages.filter(p => p.isOverdueNotified && p.status === 'Pending').length;
    
    // Daily stats for chart
    const last7Days = new Map<string, number>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`;
      last7Days.set(key, 0);
    }
    
    packages.forEach(p => {
       const d = new Date(p.receivedTime);
       const key = `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`;
       if (last7Days.has(key)) {
          last7Days.set(key, (last7Days.get(key) || 0) + 1);
       }
    });

    const chartData = Array.from(last7Days.entries()).map(([date, count]) => ({ date, count }));

    return { pending, today, overdue, chartData };
  }, [packages]);

  return (
    <div className="space-y-8">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          title="待領取包裹" 
          value={stats.pending} 
          icon={<Package className="text-blue-600" />} 
          bg="bg-blue-50" 
        />
        <StatCard 
          title="今日到貨" 
          value={stats.today} 
          icon={<Truck className="text-emerald-600" />} 
          bg="bg-emerald-50" 
        />
        <StatCard 
          title="逾期未領" 
          value={stats.overdue} 
          icon={<AlertTriangle className="text-amber-600" />} 
          bg="bg-amber-50" 
          textColor="text-amber-600"
        />
        <StatCard 
          title="活躍住戶數" 
          value="124" 
          subtext="已綁定 Line 帳號"
          icon={<UserCheck className="text-purple-600" />} 
          bg="bg-purple-50" 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
         {/* Chart */}
         <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <h3 className="font-bold text-slate-800 mb-6">近7日包裹流量</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.chartData}>
                  <XAxis dataKey="date" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip 
                    cursor={{fill: '#f1f5f9'}}
                    contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {stats.chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill="#3b82f6" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
         </div>

         {/* Quick Actions / Tips */}
         <div className="bg-gradient-to-br from-slate-900 to-slate-800 p-6 rounded-2xl text-white">
            <h3 className="font-bold text-lg mb-4">系統排程狀態</h3>
            <ul className="space-y-4 text-sm text-slate-300">
               <li className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold">1</span>
                  逾期檢查 (每日 20:00)
               </li>
               <li className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold">2</span>
                  Google Sheet 資料庫同步
               </li>
               <li className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold">3</span>
                  Line 圖文選單更新
               </li>
            </ul>
            <div className="mt-8 pt-6 border-t border-slate-700">
               <p className="text-xs text-slate-500 uppercase font-bold mb-2">下一個排程任務</p>
               <p className="font-mono">逾期通知推播</p>
               <p className="text-emerald-400 text-xs mt-1">預計執行: 今日 20:00</p>
            </div>
         </div>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, icon, bg, subtext, textColor = "text-slate-800" }: any) => (
  <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 transition-hover hover:shadow-md">
    <div className="flex justify-between items-start">
      <div>
        <p className="text-slate-500 text-sm font-medium mb-1">{title}</p>
        <h3 className={`text-3xl font-bold ${textColor}`}>{value}</h3>
        {subtext && <p className="text-xs text-slate-400 mt-1">{subtext}</p>}
      </div>
      <div className={`p-3 rounded-xl ${bg}`}>
        {icon}
      </div>
    </div>
  </div>
);