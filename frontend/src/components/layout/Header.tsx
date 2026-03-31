"use client";

import { BarChart2, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function Header() {
  const [apiStatus, setApiStatus] = useState<"checking" | "online" | "offline">("checking");

  useEffect(() => {
    const checkHealth = async () => {
      try {
        await api.get("/health");
        setApiStatus("online");
      } catch {
        setApiStatus("offline");
      }
    };
    checkHealth();
  }, []);

  return (
    <header className="h-12 flex items-center justify-between px-6 border-b border-slate-800 bg-commodity-sidebar/80 backdrop-blur-sm shrink-0">
      {/* Left: branding */}
      <div className="flex items-center gap-2">
        <BarChart2 className="w-4 h-4 text-amber-400" />
        <span className="font-mono text-xs font-bold tracking-widest text-amber-400 uppercase">
          CommodityIQ
        </span>
        <span className="ml-2 font-mono text-[10px] text-slate-600 select-none">v0.1.0</span>
      </div>

      {/* Right: API status */}
      <div className="flex items-center gap-2">
        {apiStatus === "online" ? (
          <>
            <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-mono text-[11px] text-emerald-400">API ONLINE</span>
          </>
        ) : apiStatus === "offline" ? (
          <>
            <WifiOff className="w-3.5 h-3.5 text-red-400" />
            <span className="font-mono text-[11px] text-red-400">API OFFLINE</span>
          </>
        ) : (
          <>
            <div className="w-3.5 h-3.5 rounded-full border border-amber-500/50 border-t-amber-400 animate-spin" />
            <span className="font-mono text-[11px] text-amber-500/60">CHECKING</span>
          </>
        )}
        <div
          className={`w-1.5 h-1.5 rounded-full ${
            apiStatus === "online"
              ? "bg-emerald-400 animate-pulse"
              : apiStatus === "offline"
              ? "bg-red-400"
              : "bg-amber-500/60"
          }`}
        />
      </div>
    </header>
  );
}
