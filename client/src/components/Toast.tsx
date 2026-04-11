import { useEffect, useState, useCallback } from 'react';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  message: string;
  variant: ToastVariant;
}

type ToastHandler = (msg: ToastMessage) => void;

// Global event emitter for toasts
const listeners = new Set<ToastHandler>();

let toastCounter = 0;

export function showToast(message: string, variant: ToastVariant = 'info') {
  const id = `toast-${++toastCounter}-${Date.now()}`;
  const toast: ToastMessage = { id, message, variant };
  listeners.forEach(fn => fn(toast));
}

const VARIANT_STYLES: Record<ToastVariant, { bg: string; border: string; icon: string; color: string }> = {
  success: { bg: 'rgba(16,32,20,0.95)', border: 'rgba(74,222,128,0.35)', icon: '✓', color: '#4ade80' },
  error:   { bg: 'rgba(32,12,12,0.95)', border: 'rgba(248,113,113,0.35)', icon: '✕', color: '#f87171' },
  warning: { bg: 'rgba(32,24,8,0.95)',  border: 'rgba(250,204,21,0.35)',  icon: '⚠', color: '#facc15' },
  info:    { bg: 'rgba(12,20,36,0.95)', border: 'rgba(96,165,250,0.35)',  icon: 'ℹ', color: '#60a5fa' },
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((toast: ToastMessage) => {
    setToasts(prev => [...prev, toast]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== toast.id));
    }, 4000);
  }, []);

  useEffect(() => {
    listeners.add(addToast);
    return () => { listeners.delete(addToast); };
  }, [addToast]);

  function dismiss(id: string) {
    setToasts(prev => prev.filter(t => t.id !== id));
  }

  if (!toasts.length) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 20,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 99999,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      alignItems: 'center',
      pointerEvents: 'none',
    }}>
      {toasts.map(toast => {
        const s = VARIANT_STYLES[toast.variant];
        return (
          <div
            key={toast.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 16px',
              background: s.bg,
              border: `1px solid ${s.border}`,
              borderRadius: 12,
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              minWidth: 240,
              maxWidth: 420,
              pointerEvents: 'auto',
              animation: 'toastIn 0.2s ease-out',
            }}
          >
            <span style={{ fontSize: 14, color: s.color, fontWeight: 700, flexShrink: 0 }}>
              {s.icon}
            </span>
            <span style={{ fontSize: 13, color: 'rgba(220,230,245,0.9)', flex: 1, fontFamily: 'monospace' }}>
              {toast.message}
            </span>
            <button
              onClick={() => dismiss(toast.id)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'rgba(255,255,255,0.3)', fontSize: 16, lineHeight: 1,
                padding: '0 2px', flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
