"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import Link from "next/link";
import {
  Bot, SendHorizontal, Trash2,
  ChevronDown, ChevronRight, Wrench, AlertTriangle,
} from "lucide-react";
import { useCommodityStore } from "@/lib/store";
import { sendChatMessage } from "@/lib/api";
import type { AIChatMessage, AIToolCall, ChatRequest } from "@/lib/types";

// ── Constants ──────────────────────────────────────────────────────────────────

const TOOL_PAGE_MAP: Record<string, string> = {
  run_regression:     "/regression",
  run_forecast:       "/forecast",
  run_scenario:       "/scenario",
  run_seasonality:    "/seasonality",
  run_correlation:    "/correlation",
  get_risk_metrics:   "/scenario",
  get_dataset_summary:"/data",
  run_smc_analysis:   "/forecast",
};

const TOOL_LABELS: Record<string, string> = {
  run_regression:      "OLS Regression",
  run_forecast:        "Hybrid TFT Forecast",
  run_scenario:        "Monte Carlo Scenario",
  run_seasonality:     "Seasonality Analysis",
  run_correlation:     "Correlation Matrix",
  get_risk_metrics:    "Risk Metrics",
  get_dataset_summary: "Dataset Summary",
  run_smc_analysis:    "SMC Supply & Demand",
};

const FOLLOW_UPS: Record<string, string[]> = {
  run_regression:      ["Forecast the dependent variable", "Run full correlation matrix", "Add another independent variable"],
  run_forecast:        ["Show supply & demand zones", "What's the downside risk?", "Check seasonal patterns"],
  run_scenario:        ["Try a bear case scenario", "Calculate VaR & max drawdown", "Replay a historical crisis"],
  run_seasonality:     ["Backtest the seasonal strategy", "Best months to go long?", "Run year-over-year comparison"],
  run_correlation:     ["Run regression on the top pair", "Forecast the most correlated asset", "Check portfolio risk"],
  get_risk_metrics:    ["Run a 90-day price forecast", "Monte Carlo scenario analysis", "View historical stress tests"],
  get_dataset_summary: ["Forecast this asset for 60 days", "Analyze supply & demand structure", "Calculate risk metrics"],
  run_smc_analysis:    ["Run TFT forecast with these levels", "Where is the nearest demand zone?", "What does market structure say?"],
};

const STARTER_QUESTIONS = [
  { emoji: "📈", text: "What's the relationship between Gold and Silver?" },
  { emoji: "🔮", text: "Where will Gold be in 90 days?" },
  { emoji: "🎯", text: "What happens to Oil if there's a supply shock?" },
  { emoji: "🌡️", text: "When is the best time to buy Gold?" },
];

// ── Tool Call Card ─────────────────────────────────────────────────────────────

function ToolCallCard({ tc }: { tc: AIToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const pagePath   = TOOL_PAGE_MAP[tc.tool_name] ?? "/";
  const label      = TOOL_LABELS[tc.tool_name] ?? tc.tool_name;
  const inputPairs = Object.entries(tc.tool_input ?? {}).filter(([, v]) => v != null);
  const resultPairs = Object.entries(tc.tool_result_summary ?? {})
    .filter(([, v]) => v != null && typeof v !== "object")
    .slice(0, 10);

  return (
    <div className="mb-2 rounded-lg border-l-[3px] border-amber-500/70 bg-commodity-panel/60 overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-commodity-panel/80 transition-colors"
      >
        <Wrench className="w-3 h-3 text-amber-500 shrink-0" />
        <span className="text-[11px] font-medium text-amber-400">Used: {label}</span>
        <span className="ml-auto">
          {expanded
            ? <ChevronDown  className="w-3 h-3 text-commodity-muted/50" />
            : <ChevronRight className="w-3 h-3 text-commodity-muted/50" />}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-2.5 border-t border-commodity-border/40 text-[11px] font-mono">
          {inputPairs.length > 0 && (
            <div className="space-y-0.5 pt-1.5">
              <p className="text-[9px] text-commodity-muted/50 uppercase tracking-wider mb-1">Input</p>
              {inputPairs.map(([k, v]) => (
                <div key={k} className="flex gap-2 leading-relaxed">
                  <span className="text-commodity-muted/60 shrink-0 min-w-[100px]">{k}:</span>
                  <span className="text-commodity-text break-all">
                    {Array.isArray(v) ? (v as unknown[]).join(", ") : String(v)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {resultPairs.length > 0 && (
            <div className="space-y-0.5">
              <p className="text-[9px] text-commodity-muted/50 uppercase tracking-wider mb-1">Result Summary</p>
              {resultPairs.map(([k, v]) => (
                <div key={k} className="flex gap-2 leading-relaxed">
                  <span className="text-commodity-muted/60 shrink-0 min-w-[100px]">{k}:</span>
                  <span className="text-amber-400/80 break-all">{String(v)}</span>
                </div>
              ))}
            </div>
          )}

          <Link
            href={pagePath}
            className="inline-flex items-center gap-1 text-[11px] text-teal-400 hover:text-teal-300 transition-colors pt-0.5"
          >
            View full results →
          </Link>
        </div>
      )}
    </div>
  );
}

// ── Step metric extractor ─────────────────────────────────────────────────────

function getStepMetric(tc: AIToolCall): string {
  const s = tc.tool_result_summary;
  if (!s || (s.error as string)) return s?.error ? "Error" : "Done";
  switch (tc.tool_name) {
    case "run_regression":
      return `R²: ${s.r_squared ?? "—"}`;
    case "run_forecast": {
      const models = s.models as Array<{ model: string; terminal_price?: number }> | undefined;
      const best = models?.find(m => m.model === s.best_model);
      return `${s.best_model ?? "—"} → $${best?.terminal_price?.toFixed(0) ?? "—"}`;
    }
    case "run_scenario":
      return `P50: $${(s.terminal_p50 as number)?.toFixed(0) ?? "—"} · Prob↑: ${s.prob_above_current != null ? ((s.prob_above_current as number) * 100).toFixed(1) + "%" : "—"}`;
    case "run_seasonality":
      return `${s.seasonal_strength_label ?? "—"} (${s.seasonal_strength != null ? ((s.seasonal_strength as number) * 100).toFixed(0) + "%" : "—"})`;
    case "run_correlation": {
      const top = (s.top_pairs as Array<{ pair: string; correlation: number }> | undefined)?.[0];
      return top ? `${top.pair}: ${top.correlation}` : "Done";
    }
    case "get_risk_metrics": {
      const var95 = (s.var_results as Array<{ confidence_level: number; var_pct_formatted?: string }> | undefined)
        ?.find(v => v.confidence_level === 0.95);
      return `VaR 95%: ${var95?.var_pct_formatted ?? "—"} · MaxDD: ${s.max_drawdown_pct ?? "—"}%`;
    }
    case "get_dataset_summary":
      return `$${s.current_price ?? "—"} · Vol: ${s.annualised_volatility_pct ?? "—"}%`;
    case "run_smc_analysis":
      return `${s.current_bias ?? "—"} · Supply: $${s.nearest_supply != null ? (s.nearest_supply as number).toFixed(0) : "—"} · Demand: $${s.nearest_demand != null ? (s.nearest_demand as number).toFixed(0) : "—"}`;
    default:
      return "Done";
  }
}

// ── Multi-step tool panel ──────────────────────────────────────────────────────

function MultiStepToolPanel({
  toolCalls, elapsed_ms, iterations,
}: {
  toolCalls: AIToolCall[];
  elapsed_ms?: number;
  iterations?: number;
}) {
  const isSingle = toolCalls.length === 1;
  const [panelOpen, setPanelOpen] = useState(!isSingle);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  if (isSingle) {
    return <ToolCallCard tc={toolCalls[0]} />;
  }

  const elapsedSec = elapsed_ms != null ? (elapsed_ms / 1000).toFixed(1) : null;

  return (
    <div className="mb-2 rounded-lg border-l-[3px] border-amber-500/70 bg-commodity-panel/60 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setPanelOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-commodity-panel/80 transition-colors"
      >
        <Wrench className="w-3 h-3 text-amber-500 shrink-0" />
        <span className="text-[11px] font-medium text-amber-400">
          Analysis Steps ({toolCalls.length})
        </span>
        <span className="ml-auto">
          {panelOpen
            ? <ChevronDown  className="w-3 h-3 text-commodity-muted/50" />
            : <ChevronRight className="w-3 h-3 text-commodity-muted/50" />}
        </span>
      </button>

      {panelOpen && (
        <div className="border-t border-commodity-border/40">
          {/* Steps */}
          <div className="px-3 py-2 space-y-0.5">
            {toolCalls.map((tc, idx) => {
              const isFirst  = idx === 0;
              const isLast   = idx === toolCalls.length - 1;
              const connector = isFirst ? "┌" : isLast ? "└" : "├";
              const label    = TOOL_LABELS[tc.tool_name] ?? tc.tool_name;
              const metric   = getStepMetric(tc);
              const dsName   = (tc.tool_input?.dataset_name
                ?? tc.tool_input?.dependent
                ?? "") as string;
              const stepOpen = expandedStep === idx;
              const hasError = !!(tc.tool_result_summary?.error);

              return (
                <div key={idx}>
                  <button
                    onClick={() => setExpandedStep(stepOpen ? null : idx)}
                    className="w-full flex items-start gap-2 py-1.5 text-left hover:bg-commodity-panel/60 rounded px-1.5 transition-colors group"
                  >
                    <span className="text-[11px] text-amber-500/60 font-mono shrink-0 mt-px w-3">{connector}</span>
                    <span className={`text-[10px] font-mono shrink-0 mt-px w-4 ${
                      hasError ? "text-red-400" : "text-amber-400/70"
                    }`}>{idx + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] font-medium text-commodity-text/90">{label}</span>
                      {dsName && (
                        <span className="text-[10px] text-commodity-muted/50 ml-1.5">({dsName})</span>
                      )}
                      <span className="ml-2 text-[10px] font-mono text-amber-400/70">
                        {hasError ? "⚠ " + String(tc.tool_result_summary.error).slice(0, 60) : "→ " + metric}
                      </span>
                    </div>
                    <ChevronRight className={`w-2.5 h-2.5 text-commodity-muted/30 shrink-0 mt-0.5 transition-transform ${
                      stepOpen ? "rotate-90" : ""
                    }`} />
                  </button>

                  {stepOpen && (
                    <div className="ml-7 mb-1 px-2 py-2 rounded bg-commodity-panel/80 text-[11px] font-mono space-y-1.5 border border-commodity-border/30">
                      {Object.entries(tc.tool_input ?? {}).filter(([, v]) => v != null).map(([k, v]) => (
                        <div key={k} className="flex gap-2">
                          <span className="text-commodity-muted/50 shrink-0 min-w-[80px]">{k}:</span>
                          <span className="text-commodity-text/80 break-all">
                            {Array.isArray(v) ? (v as unknown[]).join(", ") : String(v)}
                          </span>
                        </div>
                      ))}
                      {Object.entries(tc.tool_result_summary ?? {})
                        .filter(([, v]) => v != null && typeof v !== "object")
                        .slice(0, 8)
                        .map(([k, v]) => (
                          <div key={k} className="flex gap-2">
                            <span className="text-commodity-muted/50 shrink-0 min-w-[80px]">{k}:</span>
                            <span className="text-amber-400/70 break-all">{String(v)}</span>
                          </div>
                        ))}
                      <Link
                        href={TOOL_PAGE_MAP[tc.tool_name] ?? "/"}
                        className="inline-flex items-center gap-1 text-[10px] text-teal-400 hover:text-teal-300 transition-colors pt-0.5"
                      >
                        View full results →
                      </Link>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="px-3 py-2 border-t border-commodity-border/30 flex items-center gap-2">
            <span className="text-[10px] text-commodity-muted/40">
              AI ran {iterations ?? toolCalls.length} {(iterations ?? toolCalls.length) === 1 ? "analysis" : "analyses"}
              {elapsedSec ? ` in ${elapsedSec}s` : ""}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Markdown components ────────────────────────────────────────────────────────

const mdComponents = {
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="bg-slate-900/80 border border-commodity-border rounded-lg p-3 my-2 overflow-x-auto">
      {children}
    </pre>
  ),
  code: ({ className, children }: { className?: string; children?: React.ReactNode }) =>
    className ? (
      <code className="text-xs font-mono text-slate-300">{children}</code>
    ) : (
      <code className="bg-slate-800 px-1 py-0.5 rounded text-amber-300 text-[11px] font-mono">{children}</code>
    ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} className="text-teal-400 hover:text-teal-300 underline" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="text-commodity-text font-semibold">{children}</strong>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc list-inside space-y-0.5 my-1.5">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal list-inside space-y-0.5 my-1.5">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="text-commodity-text text-sm leading-relaxed">{children}</li>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-base font-bold text-commodity-text mt-3 mb-1.5">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-sm font-bold text-commodity-text mt-2.5 mb-1">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-sm font-semibold text-commodity-text mt-2 mb-0.5">{children}</h3>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto my-2">
      <table className="w-full text-xs border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-commodity-panel">{children}</thead>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="px-3 py-1.5 text-left text-commodity-muted border border-commodity-border font-normal">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="px-3 py-1 text-commodity-text border border-commodity-border">{children}</td>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-amber-500/50 pl-3 text-commodity-muted/80 italic my-1.5">{children}</blockquote>
  ),
};

// ── Loading Dots ───────────────────────────────────────────────────────────────

function LoadingDots() {
  return (
    <div className="flex gap-3 items-start">
      <div className="w-7 h-7 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0 mt-0.5">
        <Bot className="w-3.5 h-3.5 text-amber-400" />
      </div>
      <div className="bg-commodity-card border border-commodity-border rounded-2xl rounded-bl-sm px-5 py-3.5">
        <div className="flex gap-1.5 items-center">
          {[0, 1, 2].map(i => (
            <span
              key={i}
              className="w-2 h-2 rounded-full bg-amber-500/70 animate-pulse"
              style={{ animationDelay: `${i * 0.2}s` }}
            />
          ))}
        </div>
        <p className="text-[11px] text-commodity-muted/60 mt-1.5">Analyzing…</p>
      </div>
    </div>
  );
}

// ── Message Bubble ─────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: AIChatMessage }) {
  const isUser = msg.role === "user";
  const time   = msg.timestamp
    ? new Date(msg.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
    : "";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[78%] space-y-1">
          <div className="bg-amber-500/20 border border-amber-500/20 text-commodity-text rounded-2xl rounded-br-sm px-4 py-2.5 text-sm leading-relaxed">
            {msg.content}
          </div>
          {time && <p className="text-[10px] text-commodity-muted/40 text-right pr-1">{time}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0 mt-0.5">
        <Bot className="w-3.5 h-3.5 text-amber-400" />
      </div>
      <div className="max-w-[85%] min-w-0 space-y-1">
        {msg.tool_calls && msg.tool_calls.length > 0 && (
          <MultiStepToolPanel
            toolCalls={msg.tool_calls}
            elapsed_ms={msg.elapsed_ms}
            iterations={msg.iterations}
          />
        )}
        <div className="bg-commodity-card border border-commodity-border text-commodity-text rounded-2xl rounded-bl-sm px-4 py-3 text-sm">
          <ReactMarkdown components={mdComponents as never}>{msg.content}</ReactMarkdown>
        </div>
        {time && <p className="text-[10px] text-commodity-muted/40 pl-1">{time}</p>}
      </div>
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyState({ onQuestion }: { onQuestion: (q: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 px-4 py-8 text-center">
      <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
        <Bot className="w-8 h-8 text-amber-500/50" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-base font-semibold text-commodity-text">CommodityIQ AI Trading Analyst</h2>
        <p className="text-sm text-commodity-muted max-w-md leading-relaxed">
          Ask me anything about your loaded commodities. I can run regression, forecasts, scenarios, seasonality analysis, and more.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-lg mt-1">
        {STARTER_QUESTIONS.map(q => (
          <button
            key={q.text}
            onClick={() => onQuestion(q.text)}
            className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-commodity-card border border-commodity-border hover:border-amber-500/30 hover:bg-amber-500/5 transition-colors text-left group"
          >
            <span className="text-base shrink-0 mt-0.5">{q.emoji}</span>
            <span className="text-xs text-commodity-muted group-hover:text-commodity-text/80 leading-relaxed transition-colors">{q.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const { datasets, activeDatasetIds } = useCommodityStore();
  const [messages, setMessages]       = useState<AIChatMessage[]>([]);
  const [inputValue, setInputValue]   = useState("");
  const [isLoading, setIsLoading]     = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);

  const activeDatasets = useMemo(
    () => datasets.filter(d => activeDatasetIds.includes(d.id)),
    [datasets, activeDatasetIds],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const lastToolName = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
        return m.tool_calls[0].tool_name;
      }
    }
    return null;
  }, [messages]);

  const followUps = useMemo(
    () => (lastToolName ? (FOLLOW_UPS[lastToolName] ?? []).slice(0, 3) : []),
    [lastToolName],
  );

  const buildRequest = useCallback((userText: string): ChatRequest => ({
    messages: [...messages, { role: "user", content: userText }],
    available_datasets: activeDatasets.map(d => ({
      name: d.name,
      ticker: d.ticker,
      rows: d.metadata.rowCount,
      date_range: `${d.dateRange.start} — ${d.dateRange.end}`,
    })),
    dataset_data: Object.fromEntries(
      activeDatasets.map(d => [
        d.name,
        {
          dates:   d.records.map(r => r.date),
          values:  d.records.map(r => r.close),
          opens:   d.records.map(r => r.open),
          highs:   d.records.map(r => r.high),
          lows:    d.records.map(r => r.low),
          volumes: d.records.map(r => r.volume),
        },
      ]),
    ),
    active_dataset_names: activeDatasets.map(d => d.name),
  }), [messages, activeDatasets]);

  const sendMsg = useCallback(async (text?: string) => {
    const userText = (text ?? inputValue).trim();
    if (!userText || isLoading) return;

    const userMsg: AIChatMessage = {
      role: "user",
      content: userText,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInputValue("");
    setIsLoading(true);
    const startMs = Date.now();

    try {
      const request  = buildRequest(userText);
      const response = await sendChatMessage(request);
      const elapsed_ms = Date.now() - startMs;
      setMessages(prev => [...prev, {
        role:       "assistant",
        content:    response.response,
        tool_calls: response.tool_calls,
        timestamp:  new Date().toISOString(),
        iterations: response.iterations,
        elapsed_ms,
      }]);
    } catch {
      setMessages(prev => [...prev, {
        role:      "assistant",
        content:   "Sorry, I encountered an error. Please verify the backend is running and `ANTHROPIC_API_KEY` is set in `backend/.env`.",
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [inputValue, isLoading, buildRequest]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMsg();
    }
  }, [sendMsg]);

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: "calc(100vh - 57px)" }}>

      {/* ── A: Header ── */}
      <div className="shrink-0 flex items-center gap-3 px-6 py-3 bg-commodity-panel/50 border-b border-commodity-border">
        <Bot className="w-4.5 h-4.5 text-amber-400" />
        <span className="font-semibold text-commodity-text text-sm">AI Trading Analyst</span>
        <span className="text-[10px] text-commodity-muted/60 bg-commodity-card border border-commodity-border px-2 py-0.5 rounded-full ml-1">
          Claude Sonnet
        </span>
        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            className="ml-auto flex items-center gap-1.5 text-[11px] text-commodity-muted/50 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10"
          >
            <Trash2 className="w-3 h-3" />
            Clear Chat
          </button>
        )}
      </div>
      <div className="shrink-0 h-[2px] bg-gradient-to-r from-transparent via-amber-500/50 to-transparent" />

      {/* ── No datasets warning ── */}
      {datasets.length === 0 && (
        <div className="shrink-0 mx-5 mt-3 flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-amber-500/8 border border-amber-500/25 text-amber-400/90 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            No datasets loaded.{" "}
            <Link href="/data" className="underline hover:text-amber-300">Load data in the Data Hub</Link>
            {" "}for AI analytics tools to work.
          </span>
        </div>
      )}

      {/* ── B: Messages ── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-5">
        {messages.length === 0 && !isLoading ? (
          <EmptyState onQuestion={q => sendMsg(q)} />
        ) : (
          <>
            {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}
            {isLoading && <LoadingDots />}

            {/* Follow-up suggestions */}
            {!isLoading && followUps.length > 0 && (
              <div className="flex flex-wrap gap-2 pl-10">
                {followUps.map(q => (
                  <button
                    key={q}
                    onClick={() => sendMsg(q)}
                    className="px-3 py-1.5 rounded-full text-xs text-commodity-muted border border-commodity-border hover:border-amber-500/40 hover:text-amber-400 transition-colors bg-commodity-panel/40"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* ── D: Input ── */}
      <div className="shrink-0 px-5 py-4 bg-commodity-panel/20 border-t border-commodity-border">
        <div className="flex items-end gap-3 bg-commodity-card border border-commodity-border rounded-2xl px-4 py-3 focus-within:border-amber-500/40 transition-colors">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            placeholder="Ask about your commodities… (e.g., 'Forecast Gold for 60 days')"
            rows={1}
            className="flex-1 bg-transparent text-commodity-text text-sm placeholder:text-commodity-muted/40 resize-none outline-none min-h-[24px] max-h-[120px] leading-6 disabled:opacity-50"
          />
          <div className="flex items-center gap-2 shrink-0 pb-0.5">
            {inputValue.length > 80 && (
              <span className="text-[10px] text-commodity-muted/30 font-mono tabular-nums">{inputValue.length}</span>
            )}
            <button
              onClick={() => sendMsg()}
              disabled={!inputValue.trim() || isLoading}
              className="w-8 h-8 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors shrink-0"
            >
              <SendHorizontal className="w-4 h-4 text-slate-900" />
            </button>
          </div>
        </div>
        <p className="text-[10px] text-commodity-muted/25 mt-1.5 text-center">
          Enter to send · Shift+Enter for new line · Claude may make mistakes — verify important analysis
        </p>
      </div>
    </div>
  );
}
