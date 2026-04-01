"use client";

import React, { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import Link from "next/link";
import { Bot, Loader2, X, ChevronDown, ChevronUp, Send } from "lucide-react";
import { explainResults } from "@/lib/api";

interface ExplainButtonProps {
  analysisType: "regression" | "forecast" | "scenario" | "seasonality" | "correlation" | "risk";
  resultsSummary: Record<string, unknown>;
  datasetNames: string[];
}

const mdComponents = {
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="bg-slate-900/60 border border-commodity-border rounded p-2.5 my-1.5 overflow-x-auto text-xs">
      {children}
    </pre>
  ),
  code: ({ className, children }: { className?: string; children?: React.ReactNode }) =>
    className ? (
      <code className="text-xs font-mono text-slate-300">{children}</code>
    ) : (
      <code className="bg-slate-800/70 px-1 py-0.5 rounded text-amber-300 text-[11px] font-mono">{children}</code>
    ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="text-commodity-text font-semibold">{children}</strong>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc list-inside space-y-0.5 my-1">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal list-inside space-y-0.5 my-1">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="text-commodity-text/90 text-sm leading-relaxed">{children}</li>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-sm font-bold text-commodity-text mt-2 mb-1">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-sm font-semibold text-commodity-text mt-2 mb-1">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-xs font-semibold text-commodity-text mt-1.5 mb-0.5">{children}</h3>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-amber-500/40 pl-3 text-commodity-muted/80 italic my-1">{children}</blockquote>
  ),
};

export default function ExplainButton({
  analysisType,
  resultsSummary,
  datasetNames,
}: ExplainButtonProps) {
  const [phase, setPhase]               = useState<"idle" | "loading" | "done">("idle");
  const [explanation, setExplanation]   = useState("");
  const [followUp, setFollowUp]         = useState("");
  const [followLoading, setFollowLoading] = useState(false);
  const [followAnswer, setFollowAnswer] = useState("");
  const [collapsed, setCollapsed]       = useState(false);

  const fetchExplanation = useCallback(async (userContext = "") => {
    if (userContext) {
      setFollowLoading(true);
    } else {
      setPhase("loading");
    }
    try {
      const res = await explainResults({
        analysis_type: analysisType,
        results_summary: resultsSummary,
        dataset_names: datasetNames,
        user_context: userContext,
      });
      if (userContext) {
        setFollowAnswer(res.explanation);
      } else {
        setExplanation(res.explanation);
        setPhase("done");
        setCollapsed(false);
      }
    } catch {
      const errMsg = "Failed to get AI explanation. Please check the backend is running and ANTHROPIC_API_KEY is set.";
      if (userContext) {
        setFollowAnswer(errMsg);
      } else {
        setExplanation(errMsg);
        setPhase("done");
      }
    } finally {
      setFollowLoading(false);
    }
  }, [analysisType, resultsSummary, datasetNames]);

  const handleFollowUp = useCallback(() => {
    const q = followUp.trim();
    if (!q || followLoading) return;
    setFollowAnswer("");
    fetchExplanation(q);
    setFollowUp("");
  }, [followUp, followLoading, fetchExplanation]);

  const chatContext = encodeURIComponent(
    `Explain ${analysisType} results for ${datasetNames.join(", ")}`
  );

  return (
    <div className="space-y-3">
      {/* Trigger button */}
      {phase === "idle" && (
        <button
          onClick={() => fetchExplanation()}
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium bg-commodity-card border border-commodity-border hover:border-amber-500/40 hover:bg-amber-500/5 text-commodity-muted hover:text-amber-400 transition-colors"
        >
          <Bot className="w-3.5 h-3.5" />
          Explain with AI
        </button>
      )}

      {phase === "loading" && (
        <button
          disabled
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium bg-commodity-card border border-commodity-border text-commodity-muted/50 cursor-not-allowed"
        >
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Analyzing…
        </button>
      )}

      {/* Explanation card */}
      {phase === "done" && (
        <div className="rounded-xl border-l-[4px] border-amber-500/50 bg-commodity-panel border border-commodity-border overflow-hidden">
          {/* Card header */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-commodity-border/60">
            <Bot className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider">AI Analysis</span>
            <span className="ml-1 text-[10px] text-commodity-muted/40 font-normal normal-case tracking-normal">
              {datasetNames.join(", ")}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => setCollapsed(c => !c)}
                className="p-1 rounded text-commodity-muted/40 hover:text-commodity-muted transition-colors"
                title={collapsed ? "Expand" : "Collapse"}
              >
                {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => { setPhase("idle"); setExplanation(""); setFollowAnswer(""); setFollowUp(""); }}
                className="p-1 rounded text-commodity-muted/40 hover:text-red-400 transition-colors"
                title="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {!collapsed && (
            <div className="px-4 py-3.5 space-y-3.5">
              {/* Main explanation */}
              <div className="text-sm text-commodity-text/90">
                <ReactMarkdown components={mdComponents as never}>{explanation}</ReactMarkdown>
              </div>

              {/* Follow-up answer */}
              {followAnswer && (
                <div className="pt-2 border-t border-commodity-border/40">
                  <p className="text-[10px] text-commodity-muted/50 uppercase tracking-wider mb-1.5">Follow-up</p>
                  <div className="text-sm text-commodity-text/90">
                    <ReactMarkdown components={mdComponents as never}>{followAnswer}</ReactMarkdown>
                  </div>
                </div>
              )}

              {/* Follow-up input */}
              <div className="pt-1.5 border-t border-commodity-border/40 space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={followUp}
                    onChange={e => setFollowUp(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleFollowUp(); }}
                    disabled={followLoading}
                    placeholder="Ask a follow-up question…"
                    className="flex-1 bg-commodity-card border border-commodity-border rounded-lg px-3 py-1.5 text-xs text-commodity-text placeholder:text-commodity-muted/40 outline-none focus:border-amber-500/40 transition-colors disabled:opacity-50"
                  />
                  <button
                    onClick={handleFollowUp}
                    disabled={!followUp.trim() || followLoading}
                    className="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
                    title="Send"
                  >
                    {followLoading
                      ? <Loader2 className="w-3.5 h-3.5 text-slate-900 animate-spin" />
                      : <Send className="w-3.5 h-3.5 text-slate-900" />
                    }
                  </button>
                </div>
                <Link
                  href={`/chat?context=${chatContext}`}
                  className="inline-flex items-center gap-1.5 text-[11px] text-teal-400 hover:text-teal-300 transition-colors"
                >
                  <Bot className="w-3 h-3" />
                  Open in Chat →
                </Link>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
