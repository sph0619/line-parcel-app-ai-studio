import React, { useState, useEffect } from 'react';
import { Package, CheckSquare, LayoutDashboard, History, Bell, Settings, LogOut } from 'lucide-react';
import { CheckInForm } from './components/CheckInForm';
import { StatsDashboard } from './components/StatsDashboard';
import { HistoryLog } from './components/HistoryLog';
import { PickupFlow } from './components/PickupFlow';
import { ManagementPanel } from './components/ManagementPanel';
import { LoginForm } from './components/LoginForm';
import { Toaster } from './components/Toaster';
import { PackageItem, TabType } from './types';
import { packageService } from './services/packageService';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(packageService.isLoggedIn());
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [packages, setPackages] = useState<PackageItem[]>([]);
  const [userCount, setUserCount] = useState<number>(0);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Initial data load - only if authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    
    const fetchData = async () => {
      try {
        // Fetch packages and users in parallel
        const [pkgData, userData] = await Promise.all([
          packageService.getPackages(),
          packageService.getAllUsers()
        ]);
        
        setPackages(pkgData);
        setUserCount(userData.length);
      } catch (error) {
        console.error("Failed to fetch data", error);
      }
    };
    fetchData();
  }, [refreshTrigger, isAuthenticated]);

  const refreshData = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  const handleLogout = () => {
    packageService.logout();
    setIsAuthenticated(false);
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <StatsDashboard packages={packages} userCount={userCount} />;
      case 'checkin':
        return <CheckInForm onPackageAdded={refreshData} />;
      case 'pickup':
        return <PickupFlow onSuccess={refreshData} />;
      case 'history':
        return <HistoryLog packages={packages} />;
      case 'management':
        return <ManagementPanel packages={packages} onUpdate={refreshData} />;
      default:
        return <StatsDashboard packages={packages} userCount={userCount} />;
    }
  };

  const getTabTitle = (tab: TabType) => {
    switch(tab) {
      case 'dashboard': return '系統總覽';
      case 'checkin': return '包裹入庫';
      case 'pickup': return '領取作業';
      case 'history': return '歷史紀錄';
      case 'management': return '資料管理';
      default: return '系統總覽';
    }
  };

  if (!isAuthenticated) {
    return (
      <>
        <LoginForm onLoginSuccess={() => setIsAuthenticated(true)} />
        <Toaster />
      </>
    );
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row text-slate-800 font-[Inter]">
      {/* Sidebar Navigation */}
      <aside className="bg-slate-900 text-white w-full md:w-64 flex-shrink-0 transition-all duration-300 flex flex-col">
        <div className="p-6 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="bg-blue-500 p-2 rounded-lg">
              <Package size={24} className="text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-wide">社區智管</h1>
              <p className="text-xs text-slate-400">包裹管理系統 V2.0</p>
            </div>
          </div>
        </div>
        
        <nav className="p-4 space-y-2 flex-1">
          <NavButton 
            active={activeTab === 'dashboard'} 
            onClick={() => setActiveTab('dashboard')} 
            icon={<LayoutDashboard size={20} />} 
            label="系統總覽" 
          />
          <NavButton 
            active={activeTab === 'checkin'} 
            onClick={() => setActiveTab('checkin')} 
            icon={<CheckSquare size={20} />} 
            label="包裹入庫" 
          />
          <NavButton 
            active={activeTab === 'pickup'} 
            onClick={() => setActiveTab('pickup')} 
            icon={<Bell size={20} />} 
            label="領取作業" 
            badge={packages.filter(p => p.status === 'Pending').length}
          />
          <NavButton 
            active={activeTab === 'history'} 
            onClick={() => setActiveTab('history')} 
            icon={<History size={20} />} 
            label="歷史紀錄" 
          />
          <NavButton 
            active={activeTab === 'management'} 
            onClick={() => setActiveTab('management')} 
            icon={<Settings size={20} />} 
            label="資料管理" 
          />
        </nav>

        <div className="p-4 border-t border-slate-700">
          <button 
             onClick={handleLogout}
             className="w-full flex items-center gap-3 p-3 rounded-xl text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-all"
          >
             <LogOut size={20} />
             <span className="font-medium">登出系統</span>
          </button>
        </div>

        <div className="p-6 pt-2 text-xs text-slate-500">
          <p>系統狀態: 線上 (Online)</p>
          <p>Line Bot: 已連線</p>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 bg-gray-50 overflow-y-auto h-screen">
        <header className="bg-white shadow-sm p-4 md:px-8 flex justify-between items-center sticky top-0 z-10">
          <h2 className="text-xl font-bold text-slate-800">
            {getTabTitle(activeTab)}
          </h2>
          <div className="flex items-center gap-4">
             <div className="text-sm text-right hidden sm:block">
                <p className="font-medium text-slate-700">管理員</p>
                <p className="text-slate-500 text-xs">A 棟櫃台</p>
             </div>
             <div className="w-10 h-10 bg-gradient-to-tr from-blue-500 to-indigo-600 rounded-full flex items-center justify-center text-white font-bold">
               A
             </div>
          </div>
        </header>

        <div className="p-4 md:p-8 max-w-7xl mx-auto">
          {renderContent()}
        </div>
      </main>
      
      <Toaster />
    </div>
  );
}

interface NavButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}

const NavButton: React.FC<NavButtonProps> = ({ active, onClick, icon, label, badge }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center justify-between p-3 rounded-xl transition-all duration-200 ${
      active 
        ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' 
        : 'text-slate-400 hover:bg-slate-800 hover:text-white'
    }`}
  >
    <div className="flex items-center gap-3">
      {icon}
      <span className="font-medium tracking-wide">{label}</span>
    </div>
    {badge !== undefined && badge > 0 && (
      <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
        active ? 'bg-white text-blue-600' : 'bg-slate-700 text-slate-300'
      }`}>
        {badge}
      </span>
    )}
  </button>
);
