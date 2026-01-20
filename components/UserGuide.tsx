import React from 'react';
import { Smartphone, Printer, MessageCircle, Scan, ShieldCheck, PenTool, CheckCircle, Package } from 'lucide-react';

export const UserGuide: React.FC = () => {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-20">
      <div className="flex justify-between items-center print:hidden">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">系統使用手冊</h2>
          <p className="text-slate-500">您可以列印此頁作為公告或分發給住戶</p>
        </div>
        <button 
          onClick={handlePrint}
          className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-xl font-bold shadow-lg hover:bg-blue-700 transition-all"
        >
          <Printer size={20} />
          列印成 PDF / JPG
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 print:grid-cols-2 print:gap-4">
        {/* Resident Section */}
        <section className="bg-white rounded-3xl shadow-xl border-t-8 border-green-500 overflow-hidden print:shadow-none print:border-2 print:border-slate-200">
          <div className="p-8 bg-green-50">
            <div className="flex items-center gap-3 text-green-700 mb-4">
              <MessageCircle size={32} />
              <h3 className="text-2xl font-black">住戶篇：LINE 領件指南</h3>
            </div>
            <p className="text-green-800/70 font-medium">簡單 4 步，包裹到貨不漏接</p>
          </div>

          <div className="p-8 space-y-8">
            <Step 
              number="1" 
              title="加入社區官方 LINE" 
              icon={<Smartphone className="text-green-500" />}
              content="掃描社區公告欄的 QR Code 加入好友。"
            />
            <Step 
              number="2" 
              title="完成帳號綁定" 
              icon={<CheckCircle className="text-green-500" />}
              content={
                <div className="space-y-2">
                  <p>請對機器人輸入：<span className="font-bold text-green-600">綁定 [戶號] [姓名]</span></p>
                  <p className="text-xs bg-slate-100 p-2 rounded text-slate-500 font-mono">範例：綁定 10A1 王小明</p>
                </div>
              }
            />
            <Step 
              number="3" 
              title="即時到貨通知" 
              icon={<Package className="text-green-500" />}
              content="包裹送達櫃台時，您的 LINE 會立即收到通知（含條碼與物流資訊）。"
            />
            <Step 
              number="4" 
              title="領取驗證" 
              icon={<ShieldCheck className="text-green-500" />}
              content="至櫃台時對 LINE 輸入「領取」獲取 4 位數驗證碼，告知管理員後簽名即可領件。"
            />
          </div>
          
          <div className="px-8 py-4 bg-slate-50 text-[10px] text-slate-400 text-center uppercase tracking-widest font-bold">
            Smart Community Package System - Resident Side
          </div>
        </section>

        {/* Admin Section */}
        <section className="bg-white rounded-3xl shadow-xl border-t-8 border-blue-600 overflow-hidden print:shadow-none print:border-2 print:border-slate-200">
          <div className="p-8 bg-blue-50">
            <div className="flex items-center gap-3 text-blue-800 mb-4">
              <ShieldCheck size={32} />
              <h3 className="text-2xl font-black">管理員篇：操作流程</h3>
            </div>
            <p className="text-blue-800/70 font-medium">數位化管理，效率提升 200%</p>
          </div>

          <div className="p-8 space-y-8">
            <Step 
              number="1" 
              title="登入系統" 
              icon={<Smartphone className="text-blue-600" />}
              content="輸入管理員帳號密碼進入「社區智管」後台。"
            />
            <Step 
              number="2" 
              title="包裹入庫登記" 
              icon={<Scan className="text-blue-600" />}
              content="進入「包裹入庫」，輸入戶號並掃描包裹條碼。點擊「確認入庫」後系統會自動發送 LINE 給住戶。"
            />
            <Step 
              number="3" 
              title="領取作業與驗證" 
              icon={<ShieldCheck className="text-blue-600" />}
              content="進入「領取作業」，輸入住戶告知的 4 位數驗證碼進行身份核對。"
            />
            <Step 
              number="4" 
              title="電子簽名存查" 
              icon={<PenTool className="text-blue-600" />}
              content="核對成功後，請住戶在螢幕上完成電子簽名，系統將永久保存記錄，不需再用傳統紙本。"
            />
          </div>

          <div className="px-8 py-4 bg-slate-50 text-[10px] text-slate-400 text-center uppercase tracking-widest font-bold">
            Smart Community Package System - Admin Side
          </div>
        </section>
      </div>

      {/* Common FAQ or Footer */}
      <div className="bg-slate-800 text-white p-8 rounded-3xl flex flex-col md:flex-row items-center justify-between gap-6 print:bg-white print:text-slate-800 print:border-2 print:border-slate-200">
        <div className="space-y-2 text-center md:text-left">
          <h4 className="font-bold text-lg">⚠️ 系統注意事項</h4>
          <ul className="text-sm text-slate-400 space-y-1 list-disc list-inside print:text-slate-600">
            <li>驗證碼有效期為 10 分鐘，逾期請重新生成。</li>
            <li>戶號格式範例：10A1（樓層 + 棟別 + 門牌）。</li>
            <li>若住戶未帶手機，管理員可於「資料管理」進行手動領取。</li>
          </ul>
        </div>
        <div className="flex-shrink-0 bg-white/10 p-4 rounded-2xl backdrop-blur-md border border-white/10 text-center print:border-slate-200">
           <p className="text-xs text-blue-300 font-bold mb-1">技術支援</p>
           <p className="font-mono text-sm">HusPlay</p>
        </div>
      </div>
    </div>
  );
};

const Step = ({ number, title, content, icon }: any) => (
  <div className="flex gap-4">
    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center font-black text-slate-400">
      {number}
    </div>
    <div className="space-y-1">
      <div className="flex items-center gap-2 font-bold text-slate-800">
        {icon}
        {title}
      </div>
      <div className="text-sm text-slate-500 leading-relaxed">
        {content}
      </div>
    </div>
  </div>
);
