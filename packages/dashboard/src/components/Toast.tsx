import { useEffect, useState, useCallback } from "react";

interface Toast {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

let nextId = 0;
let addToastFn: ((message: string, type: Toast["type"]) => void) | null = null;

export function toast(message: string, type: Toast["type"] = "info") {
  addToastFn?.(message, type);
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const add = useCallback((message: string, type: Toast["type"]) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  useEffect(() => {
    addToastFn = add;
    return () => { addToastFn = null; };
  }, [add]);

  if (!toasts.length) return null;

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
