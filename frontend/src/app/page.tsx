"use client";

import React from "react";
import Link from "next/link";
import {
  Database,
  TrendingUp,
  Sparkles,
  Target,
  Thermometer,
  Link2,
  Bot,
  ArrowRight,
  BarChart2,
} from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────────

const modules = [
  {
    label: "Data Hub",
    href: "/data",
    icon: Database,
    description: "Import, clean, and manage commodity datasets",
    status: "active" as const,
    color: "text-sky-400",
    iconBg: "bg-sky-500/10 border-sky-500/20",
  },
  {
    label: "Regression",
    href: "/regression",
    icon: TrendingUp,
    description: "OLS regression, multi-variate analysis, structural breaks",
    status: "active" as const,
    color: "text-violet-400",
    iconBg: "bg-violet-500/10 border-violet-500/20",
  },
  {
    label: "Forecast",
    href: "/forecast",
    icon: Sparkles,
    description: "ARIMA, ETS, and linear trend forecasting with confidence bands",
    status: "active" as const,
    color: "text-amber-400",
    iconBg: "bg-amber-500/10 border-amber-500/20",
  },
  {
    label: "Scenario",
    href: "/scenario",
    icon: Target,
    description: "Monte Carlo simulation and what-if scenario modeling",
    status: "active" as const,
    color: "text-rose-400",
    iconBg: "bg-rose-500/10 border-rose-500/20",
  },
  {
    label: "Seasonality",
    href: "/seasonality",
    icon: Thermometer,
    description: "Seasonal decomposition, monthly heatmaps, YoY overlays",
    status: "active" as const,
    color: "text-teal-400",
    iconBg: "bg-teal-500/10 border-teal-500/20",
  },
  {
    label: "Correlation",
    href: "/correlation",
    icon: Link2,
    description: "Cross-asset correlation matrix, rolling correlation, Granger causality",
    status: "active" as const,
    color: "text-indigo-400",
    iconBg: "bg-indigo-500/10 border-indigo-500/20",
  },
  {
    label: "AI Chat",
    href: "/chat",
    icon: Bot,
    description: "Natural language interface to all analytics via Claude AI",
    status: "active" as const,
    color: "text-emerald-400",
    iconBg: "bg-emerald-500/10 border-emerald-500/20",
  },
];

// ── Dashboard Page ────────────────────────────────────────────────────────────

export default function DashboardPage() {
  return (
    <div className="p-6 md:p-8 animate-fade-in">
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <BarChart2 className="w-5 h-5 text-amber-400" />
          <span className="font-mono text-xs text-amber-400/80 tracking-widest uppercase">
            Analytics Platform
          </span>
        </div>
        <h1 className="text-4xl font-bold text-slate-100 mb-2 tracking-tight">CommodityIQ</h1>
        <p className="text-slate-400 text-lg">AI-Powered Commodity Trading Analytics</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {modules.map((mod) => {
          const Icon = mod.icon;
          return (
            <Link
              key={mod.href}
              href={mod.href}
              className="group glass-card rounded-xl p-6 border border-commodity-border hover:border-amber-500/30 transition-all duration-200 hover:-translate-y-0.5 backdrop-blur-sm"
            >
              <div className="flex items-start justify-between mb-4">
                <div className={`flex items-center justify-center w-10 h-10 rounded-lg border ${mod.iconBg}`}>
                  <Icon className={`w-5 h-5 ${mod.color}`} />
                </div>
                <span
                  className={`font-mono text-[11px] px-2.5 py-1 rounded-full border ${
                    mod.status === "active"
                      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
                      : "text-amber-400 bg-amber-500/10 border-amber-500/30"
                  }`}
                >
                  {mod.status === "active" ? "Active" : "Coming Soon"}
                </span>
              </div>
              <h3 className="font-semibold text-slate-100 text-base mb-1.5 group-hover:text-white transition-colors">
                {mod.label}
              </h3>
              <p className="text-slate-500 text-sm leading-relaxed mb-4">{mod.description}</p>
              <div
                className={`flex items-center gap-1 text-xs font-medium ${mod.color} opacity-0 group-hover:opacity-100 transition-opacity`}
              >
                <span>Open module</span>
                <ArrowRight className="w-3 h-3" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
