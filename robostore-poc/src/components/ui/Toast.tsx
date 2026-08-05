import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";

type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  show: (type: ToastType, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TYPE_STYLES: Record<ToastType, { icon: typeof CheckCircle2; className: string }> = {
  success: { icon: CheckCircle2, className: "border-emerald-500/40 text-emerald-400" },
  error: { icon: XCircle, className: "border-rose-500/40 text-rose-400" },
  info: { icon: Info, className: "border-blue-500/40 text-blue-400" },
};

const AUTO_DISMISS_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idCounter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (type: ToastType, message: string) => {
      const id = idCounter.current++;
      setToasts((prev) => [...prev, { id, type, message }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
        {toasts.map((toast) => {
          const { icon: Icon, className } = TYPE_STYLES[toast.type];
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto flex animate-fade-up items-start gap-3 rounded-xl border bg-surface/95 px-4 py-3 shadow-lg backdrop-blur ${className}`}
            >
              <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p className="flex-1 text-sm text-text">{toast.message}</p>
              <button
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss notification"
                className="text-textDim hover:text-text"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
