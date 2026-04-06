"use client";

import { useEffect, useState } from "react";

type PermissionState = "default" | "granted" | "denied" | "unsupported";

export interface NotificationToggleProps {
  enabled:   boolean;
  onChange:  (enabled: boolean) => void;
}

export function useNotificationPermission(): {
  permission: PermissionState;
  request:    () => Promise<boolean>;
  register:   () => Promise<void>;
} {
  const [permission, setPermission] = useState<PermissionState>("default");

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission as PermissionState);
  }, []);

  async function register() {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    try {
      await navigator.serviceWorker.register("/sw.js");
    } catch {
      /* ignore */
    }
  }

  async function request(): Promise<boolean> {
    if (typeof window === "undefined" || !("Notification" in window)) return false;
    const result = await Notification.requestPermission();
    setPermission(result as PermissionState);
    if (result === "granted") await register();
    return result === "granted";
  }

  return { permission, request, register };
}

export async function sendSignalNotification(
  symbol: string,
  signalType: string,
  confidence: number,
  entryPrice: number
): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  if (!reg) return;
  reg.active?.postMessage({
    type:  "SIGNAL_NOTIFICATION",
    title: `${signalType === "BUY" ? "🟢" : "🔴"} ${symbol} ${signalType} Signal`,
    body:  `${Math.round(confidence * 100)}% confidence · Entry: ${entryPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
    tag:   `signal-${symbol}`,
  });
}

export default function NotificationToggle({ enabled, onChange }: NotificationToggleProps) {
  const { permission, request } = useNotificationPermission();

  if (permission === "unsupported") return null;

  async function handleToggle() {
    if (!enabled) {
      if (permission !== "granted") {
        const ok = await request();
        if (!ok) return;
      }
      onChange(true);
    } else {
      onChange(false);
    }
  }

  return (
    <button
      onClick={handleToggle}
      title={
        permission === "denied"
          ? "Notifications blocked — enable in browser settings"
          : enabled ? "Disable notifications" : "Enable signal notifications"
      }
      disabled={permission === "denied"}
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        enabled
          ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
          : "border-slate-700 bg-slate-900 text-slate-500 hover:text-slate-300"
      }`}
    >
      <span className={`text-sm ${enabled ? "animate-pulse-slow" : ""}`}>🔔</span>
      <span>{enabled ? "Alerts on" : "Alerts off"}</span>
    </button>
  );
}
