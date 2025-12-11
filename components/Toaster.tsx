import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  showToast: (message: string, type: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within Toaster");
  return context;
};

// This is the global listener for the custom event to trigger toasts from non-hook services
export const triggerToast = (message: string, type: ToastType) => {
  const event = new CustomEvent('app-toast', { detail: { message, type } });
  window.dispatchEvent(event);
};

export const Toaster: React.FC = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType) => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);

    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  useEffect(() => {
    const handleEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      showToast(detail.message, detail.type);
    };
    window.addEventListener('app-toast', handleEvent);
    return () => window.removeEventListener('app-toast', handleEvent);
  }, [showToast]);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`min-w-[300px] p-4 rounded-lg shadow-lg text-white transform transition-all animate-slide-in ${
            toast.type === 'success' ? 'bg-emerald-600' : 
            toast.type === 'error' ? 'bg-red-600' : 'bg-blue-600'
          }`}
        >
          <p className="font-medium text-sm">{toast.message}</p>
        </div>
      ))}
    </div>
  );
};
