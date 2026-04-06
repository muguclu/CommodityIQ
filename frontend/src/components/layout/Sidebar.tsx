"use client";

import { useCommodityStore } from "@/lib/store";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Database,
  TrendingUp,
  Sparkles,
  Target,
  Thermometer,
  Link2,
  Bot,
  Radio,
  History as HistoryIcon,
  ChevronLeft,
  ChevronRight,
  BarChart2,
} from "lucide-react";

const navItems = [
  {
    label: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
    description: "Overview & metrics",
  },
  {
    label: "Data Hub",
    href: "/data",
    icon: Database,
    description: "Manage data sources",
  },
  {
    label: "Regression",
    href: "/regression",
    icon: TrendingUp,
    description: "Price regression models",
  },
  {
    label: "Forecast",
    href: "/forecast",
    icon: Sparkles,
    description: "Price forecasting",
  },
  {
    label: "Scenario",
    href: "/scenario",
    icon: Target,
    description: "Scenario analysis",
  },
  {
    label: "Seasonality",
    href: "/seasonality",
    icon: Thermometer,
    description: "Seasonal patterns",
  },
  {
    label: "Correlation",
    href: "/correlation",
    icon: Link2,
    description: "Asset correlations",
  },
  {
    label: "AI Chat",
    href: "/chat",
    icon: Bot,
    description: "Ask AI about markets",
  },
  {
    label: "Signals",
    href: "/signals",
    icon: Radio,
    description: "Live trading signals",
  },
  {
    label: "Sig. History",
    href: "/signals/history",
    icon: HistoryIcon,
    description: "Signal history & stats",
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { sidebarCollapsed: collapsed, toggleSidebar: toggleCollapsed } = useCommodityStore();

  return (
    <aside
      className={`relative flex flex-col h-screen bg-commodity-sidebar border-r border-slate-800 transition-all duration-300 ease-in-out shrink-0 ${
        collapsed ? "w-16" : "w-60"
      }`}
    >
      {/* Logo */}
      <div
        className={`flex items-center gap-3 px-4 py-5 border-b border-slate-800 ${
          collapsed ? "justify-center" : ""
        }`}
      >
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 shrink-0">
          <BarChart2 className="w-4 h-4 text-amber-400" />
        </div>
        {!collapsed && (
          <span className="font-mono text-sm font-bold tracking-widest text-amber-400 uppercase">
            CommodityIQ
          </span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-150 ${
                isActive
                  ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                  : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-100 border border-transparent"
              } ${collapsed ? "justify-center" : ""}`}
            >
              <Icon
                className={`shrink-0 w-4 h-4 ${
                  isActive ? "text-amber-400" : "text-slate-500 group-hover:text-slate-300"
                }`}
              />
              {!collapsed && (
                <span className="truncate font-medium">{item.label}</span>
              )}
              {isActive && !collapsed && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="px-2 pb-4 border-t border-slate-800 pt-3">
        <button
          onClick={toggleCollapsed}
          className="flex items-center justify-center w-full gap-2 rounded-lg px-3 py-2 text-slate-500 hover:text-slate-300 hover:bg-slate-800/60 transition-colors text-xs"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <>
              <ChevronLeft className="w-4 h-4" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
