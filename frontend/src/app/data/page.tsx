"use client";

import React, { useState, useRef, useCallback, useEffect, DragEvent } from "react";
import {
  Database,
  UploadCloud,
  CheckCircle,
  AlertCircle,
  Trash2,
  ChevronUp,
  ChevronDown,
  RefreshCw,
} from "lucide-react";
import { LineChart, Line } from "recharts";
import { api, fetchAvailableCommodities, fetchMarketData } from "@/lib/api";
import type { CommodityDataset, CommodityInfo, DataInterval, FetchMarketResponse, OHLCVRecord } from "@/lib/types";
import { useCommodityStore } from "@/lib/store";

// ── Local types ───────────────────────────────────────────────────────────────

type MappingRole =
  | "date"
  | "open"
  | "high"
  | "low"
  | "close"
  | "volume"
  | "adjClose"
  | "ignore";

interface ColumnInfo {
  col_name: string;
  detected_as: string | null;
  samples: string[];
}

type SortDir = "asc" | "desc";
interface SortConfig {
  col: keyof OHLCVRecord;
  dir: SortDir;
}

type UploadPhase = "idle" | "uploading" | "mapped" | "error";

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ records }: { records: OHLCVRecord[] }) {
  const data = records.map((r) => ({ v: r.close }));
  return (
    <LineChart width={180} height={40} data={data}>
      <Line
        type="monotone"
        dataKey="v"
        stroke="#f59e0b"
        strokeWidth={1.5}
        dot={false}
        isAnimationActive={false}
      />
    </LineChart>
  );
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

const TABLE_COLS: Array<{ key: keyof OHLCVRecord; label: string }> = [
  { key: "date", label: "Date" },
  { key: "open", label: "Open" },
  { key: "high", label: "High" },
  { key: "low", label: "Low" },
  { key: "close", label: "Close" },
  { key: "volume", label: "Volume" },
];

const MAPPING_ROLES: MappingRole[] = [
  "date",
  "open",
  "high",
  "low",
  "close",
  "volume",
  "adjClose",
  "ignore",
];

// ── Tab 2 types & constants ───────────────────────────────────────────────────

type RangePill = "1W" | "2W" | "1M" | "2M" | "3M" | "6M" | "YTD" | "1Y" | "2Y" | "5Y" | "Max";
type Toast = { type: "success" | "warning"; message: string } | null;

function getVisibleRangePills(interval: DataInterval): RangePill[] {
  if (interval === "5m" || interval === "15m") return ["1W", "2W", "1M", "2M"];
  if (interval === "1h") return ["1M", "3M", "6M", "1Y", "2Y"];
  return ["1M", "3M", "6M", "YTD", "1Y", "2Y", "5Y", "Max"];
}

function getDefaultRangeForInterval(interval: DataInterval): RangePill {
  if (interval === "5m" || interval === "15m") return "1M";
  if (interval === "1h") return "1Y";
  return "5Y";
}

const STATIC_COMMODITIES: CommodityInfo[] = [
  { ticker: "BZ=F", name: "Brent Crude Oil", category: "Energy", currency: "USD" },
  { ticker: "CL=F", name: "WTI Crude Oil", category: "Energy", currency: "USD" },
  { ticker: "NG=F", name: "Natural Gas", category: "Energy", currency: "USD" },
  { ticker: "GC=F", name: "Gold", category: "Metals", currency: "USD" },
  { ticker: "SI=F", name: "Silver", category: "Metals", currency: "USD" },
  { ticker: "HG=F", name: "Copper", category: "Metals", currency: "USD" },
  { ticker: "PL=F", name: "Platinum", category: "Metals", currency: "USD" },
  { ticker: "ZW=F", name: "Wheat", category: "Agriculture", currency: "USD" },
  { ticker: "ZC=F", name: "Corn", category: "Agriculture", currency: "USD" },
  { ticker: "ZS=F", name: "Soybean", category: "Agriculture", currency: "USD" },
  { ticker: "KC=F", name: "Coffee", category: "Agriculture", currency: "USD" },
  { ticker: "CT=F", name: "Cotton", category: "Agriculture", currency: "USD" },
];

const CATEGORY_CONFIG: Record<
  string,
  { emoji: string; border: string; text: string }
> = {
  Energy:      { emoji: "🛢️",  border: "border-amber-500",  text: "text-amber-400"  },
  Metals:      { emoji: "⚡",  border: "border-yellow-500", text: "text-yellow-400" },
  Agriculture: { emoji: "🌾", border: "border-green-500",  text: "text-green-400"  },
};

const PRESET_PACKS = [
  { label: "🛢️ Energy Pack",  tickers: ["BZ=F", "CL=F", "NG=F"] },
  { label: "⚡ Metals Pack",  tickers: ["GC=F", "SI=F", "HG=F", "PL=F"] },
  { label: "🌾 Agri Pack",    tickers: ["ZW=F", "ZC=F", "ZS=F", "KC=F", "CT=F"] },
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getStartDate(range: RangePill): string {
  const now = new Date();
  const y = now.getFullYear();
  const shiftDays = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  };
  const shiftMonths = (months: number) => {
    const d = new Date(now);
    d.setMonth(d.getMonth() - months);
    return d.toISOString().slice(0, 10);
  };
  switch (range) {
    case "1W":  return shiftDays(7);
    case "2W":  return shiftDays(14);
    case "1M":  return shiftMonths(1);
    case "2M":  return shiftMonths(2);
    case "3M":  return shiftMonths(3);
    case "6M":  return shiftMonths(6);
    case "YTD": return `${y}-01-01`;
    case "1Y":  return shiftMonths(12);
    case "2Y":  return shiftMonths(24);
    case "5Y":  return shiftMonths(60);
    case "Max": return "1990-01-01";
  }
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DataPage() {
  const [activeTab, setActiveTab] = useState<"upload" | "fetch">("upload");

  // Upload
  const [dragOver, setDragOver] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadFilename, setUploadFilename] = useState("");
  const [pendingDataset, setPendingDataset] = useState<CommodityDataset | null>(null);
  const [columnInfo, setColumnInfo] = useState<ColumnInfo[]>([]);
  const [currentMapping, setCurrentMapping] = useState<Record<string, MappingRole>>({});

  // Shared datasets — persisted in global store
  const { datasets, activeDatasetIds, addDataset, addDatasets, removeDataset, toggleActiveDataset } = useCommodityStore();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);

  // Tab 2 — market fetch
  const [commodities, setCommodities] = useState<CommodityInfo[]>(STATIC_COMMODITIES);
  const [selectedTickers, setSelectedTickers] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState(() => getStartDate("5Y"));
  const [endDate, setEndDate] = useState(() => todayStr());
  const [fetchInterval, setFetchInterval] = useState<DataInterval>("1d");
  const [activeRange, setActiveRange] = useState<RangePill>("5Y");
  const [fetchPhase, setFetchPhase] = useState<"idle" | "fetching">("idle");
  const [fetchProgress, setFetchProgress] = useState({ current: 0, total: 0 });
  const [toast, setToast] = useState<Toast>(null);
  const [backendWarnings, setBackendWarnings] = useState<string[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);

  // ── File handling ────────────────────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith(".csv") && !file.name.endsWith(".tsv")) {
      setUploadPhase("error");
      setUploadError("Only .csv and .tsv files are supported.");
      return;
    }
    setUploadFilename(file.name);
    setUploadPhase("uploading");
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const { data: res } = await api.post("/api/data/upload-csv", formData);

      if (!res.success || !res.data) {
        throw new Error(res.error ?? "Unknown error from server.");
      }

      setPendingDataset(res.data as CommodityDataset);

      const info: ColumnInfo[] = res.column_info ?? [];
      setColumnInfo(info);
      const mapping: Record<string, MappingRole> = {};
      for (const ci of info) {
        mapping[ci.col_name] = (ci.detected_as as MappingRole) ?? "ignore";
      }
      setCurrentMapping(mapping);
      setUploadPhase("mapped");
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Upload failed. Please try again.";
      setUploadPhase("error");
      setUploadError(msg);
    }
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const resetUpload = () => {
    setPendingDataset(null);
    setColumnInfo([]);
    setCurrentMapping({});
    setUploadPhase("idle");
    setUploadFilename("");
    setUploadError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleConfirm = () => {
    if (!pendingDataset) return;
    addDataset(pendingDataset);
    resetUpload();
  };

  const handleDelete = (id: string) => {
    removeDataset(id);
    if (expandedId === id) setExpandedId(null);
  };

  // ── Tab 2 handlers ───────────────────────────────────────────────────────────

  useEffect(() => {
    fetchAvailableCommodities()
      .then(setCommodities)
      .catch(() => setCommodities(STATIC_COMMODITIES));
  }, []);

  const showToast = useCallback((t: NonNullable<Toast>) => {
    setToast(t);
    setTimeout(() => setToast(null), 4500);
  }, []);

  const toggleTicker = (ticker: string) =>
    setSelectedTickers((prev) => {
      const next = new Set(prev);
      next.has(ticker) ? next.delete(ticker) : next.add(ticker);
      return next;
    });

  const selectCategory = (category: string) => {
    const tickers = commodities
      .filter((c) => c.category === category)
      .map((c) => c.ticker);
    setSelectedTickers((prev) => {
      const next = new Set(prev);
      tickers.forEach((t) => next.add(t));
      return next;
    });
  };

  const deselectCategory = (category: string) => {
    const tickers = new Set(
      commodities.filter((c) => c.category === category).map((c) => c.ticker)
    );
    setSelectedTickers((prev) => {
      const next = new Set(prev);
      tickers.forEach((t) => next.delete(t));
      return next;
    });
  };

  const handleRangePill = (range: RangePill) => {
    setActiveRange(range);
    setStartDate(getStartDate(range));
    setEndDate(todayStr());
  };

  const handleIntervalChange = useCallback((iv: DataInterval) => {
    setFetchInterval(iv);
    const validPills = getVisibleRangePills(iv);
    if (!validPills.includes(activeRange)) {
      const defaultRange = getDefaultRangeForInterval(iv);
      setActiveRange(defaultRange);
      setStartDate(getStartDate(defaultRange));
      setEndDate(todayStr());
    }
  }, [activeRange]);

  const handleFetch = useCallback(
    async (tickerOverride?: string[]) => {
      const tickers = tickerOverride ?? Array.from(selectedTickers);
      if (tickers.length === 0) return;

      setFetchPhase("fetching");
      setFetchProgress({ current: 0, total: tickers.length });
      setBackendWarnings([]);

      const results: CommodityDataset[] = [];
      const collectedWarnings: string[] = [];
      const errors: string[] = [];

      for (let i = 0; i < tickers.length; i++) {
        setFetchProgress({ current: i + 1, total: tickers.length });
        try {
          const resp = await fetchMarketData({
            tickers: [tickers[i]],
            start_date: startDate || undefined,
            end_date: endDate || undefined,
            interval: fetchInterval,
          });
          results.push(
            ...resp.datasets.map((ds) => ({
              ...ds,
              interval: fetchInterval,
              name: `${ds.name} (${fetchInterval})`,
            }))
          );
          collectedWarnings.push(...resp.warnings);
        } catch {
          errors.push(tickers[i]);
        }
      }

      // Deduplicate warnings
      setBackendWarnings(Array.from(new Set(collectedWarnings)));
      addDatasets(results);
      setFetchPhase("idle");

      if (errors.length === 0) {
        showToast({
          type: "success",
          message: `Loaded ${results.length} dataset${results.length !== 1 ? "s" : ""}`,
        });
      } else {
        showToast({
          type: "warning",
          message: `Loaded ${results.length}/${tickers.length} datasets. Failed: ${errors.join(", ")}`,
        });
      }
    },
    [selectedTickers, startDate, endDate, fetchInterval, showToast]
  );

  const handlePresetPack = (tickers: string[]) => {
    setSelectedTickers(new Set(tickers));
    handleFetch(tickers);
  };

  const handleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
    setPreviewPage(1);
    setSortConfig(null);
  };

  const handleSort = (col: keyof OHLCVRecord) => {
    setSortConfig((prev) =>
      prev?.col === col
        ? { col, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { col, dir: "asc" }
    );
  };

  const getSorted = (records: OHLCVRecord[]) => {
    if (!sortConfig) return records;
    return [...records].sort((a, b) => {
      const av = a[sortConfig.col] ?? "";
      const bv = b[sortConfig.col] ?? "";
      if (av < bv) return sortConfig.dir === "asc" ? -1 : 1;
      if (av > bv) return sortConfig.dir === "asc" ? 1 : -1;
      return 0;
    });
  };

  // ── Section A: Upload zone ───────────────────────────────────────────────────

  const renderUploadZone = () => {
    const base =
      "flex flex-col items-center justify-center min-h-[200px] rounded-lg border-2 border-dashed transition-all duration-200 select-none";

    if (uploadPhase === "uploading") {
      return (
        <div className={`${base} border-commodity-border`}>
          <RefreshCw className="w-8 h-8 text-commodity-muted animate-spin-slow mb-3" />
          <p className="text-commodity-muted text-sm">Parsing CSV…</p>
        </div>
      );
    }

    if (uploadPhase === "mapped" && pendingDataset) {
      return (
        <div className={`${base} border-emerald-500/40 bg-emerald-500/5`}>
          <CheckCircle className="w-8 h-8 text-emerald-500 mb-3" />
          <p className="text-emerald-400 text-sm font-medium">{uploadFilename}</p>
          <p className="text-emerald-500/70 text-xs mt-1">
            {pendingDataset.metadata.rowCount.toLocaleString()} rows · ✓ Loaded successfully
          </p>
        </div>
      );
    }

    if (uploadPhase === "error") {
      return (
        <div className={`${base} border-red-500/40 bg-red-500/5`}>
          <AlertCircle className="w-7 h-7 text-red-400 mb-3" />
          <p className="text-red-400 text-sm font-medium">Upload failed</p>
          <p className="text-red-400/70 text-xs mt-2 text-center max-w-xs px-4">{uploadError}</p>
          <button
            onClick={resetUpload}
            className="mt-3 text-xs text-red-400 underline underline-offset-2 hover:text-red-300"
          >
            Try again
          </button>
        </div>
      );
    }

    // Idle / default
    return (
      <div
        className={`${base} cursor-pointer ${
          dragOver
            ? "border-amber-500 bg-amber-500/10"
            : "border-commodity-border hover:border-slate-500"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <UploadCloud
          className={`w-8 h-8 mb-3 ${dragOver ? "text-amber-400" : "text-commodity-muted"}`}
        />
        <p
          className={`text-sm font-medium ${
            dragOver ? "text-amber-400" : "text-commodity-muted"
          }`}
        >
          {dragOver ? "Drop to upload" : "Drop CSV file here"}
        </p>
        {!dragOver && (
          <>
            <p className="text-commodity-muted/50 text-xs my-2">or</p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                inputRef.current?.click();
              }}
              className="px-3 py-1.5 rounded-md bg-commodity-panel border border-commodity-border text-xs text-commodity-text hover:border-slate-500 transition-colors"
            >
              Browse Files
            </button>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>
    );
  };

  // ── Section B: Column mapping ────────────────────────────────────────────────

  const renderMappingPreview = () => {
    if (uploadPhase !== "mapped" || !pendingDataset || columnInfo.length === 0) return null;

    return (
      <div className="rounded-xl bg-commodity-card border border-commodity-border p-6">
        <h2 className="text-sm font-semibold text-commodity-text mb-4">
          Column Mapping Preview
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-commodity-border">
                <th className="text-left text-commodity-muted font-medium pb-2 pr-6 whitespace-nowrap">
                  Detected Column
                </th>
                <th className="text-left text-commodity-muted font-medium pb-2 pr-6 whitespace-nowrap">
                  Mapped To
                </th>
                <th className="text-left text-commodity-muted font-medium pb-2">
                  Sample Values
                </th>
              </tr>
            </thead>
            <tbody>
              {columnInfo.map((ci) => (
                <tr
                  key={ci.col_name}
                  className="border-b border-commodity-border/30 last:border-0"
                >
                  <td className="py-2 pr-6 font-mono text-commodity-text/80">
                    {ci.col_name}
                  </td>
                  <td className="py-2 pr-6">
                    <select
                      value={currentMapping[ci.col_name] ?? "ignore"}
                      onChange={(e) =>
                        setCurrentMapping((prev) => ({
                          ...prev,
                          [ci.col_name]: e.target.value as MappingRole,
                        }))
                      }
                      className="bg-commodity-panel border border-commodity-border rounded px-2 py-1 text-commodity-text text-xs focus:outline-none focus:border-amber-500/50 cursor-pointer"
                    >
                      {MAPPING_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 font-mono text-commodity-muted/70">
                    {ci.samples.join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-3 mt-5">
          <button
            onClick={handleConfirm}
            className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 text-xs font-semibold transition-colors"
          >
            Confirm &amp; Load Dataset
          </button>
          <button
            onClick={resetUpload}
            className="px-4 py-2 rounded-lg border border-commodity-border text-commodity-muted hover:text-commodity-text text-xs transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  };

  // ── Data preview table ────────────────────────────────────────────────────────

  const renderPreviewTable = (ds: CommodityDataset) => {
    const sorted = getSorted(ds.records);
    const visibleCount = previewPage * 50;
    const visible = sorted.slice(0, visibleCount);
    const remaining = sorted.length - visibleCount;

    return (
      <div className="p-4 border-t border-commodity-border">
        <div className="overflow-x-auto rounded-lg border border-commodity-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-commodity-panel border-b border-commodity-border">
                {TABLE_COLS.map(({ key, label }) => (
                  <th
                    key={key}
                    onClick={() => handleSort(key)}
                    className="text-left text-commodity-muted font-medium px-3 py-2 cursor-pointer hover:text-commodity-text whitespace-nowrap select-none"
                  >
                    <span className="inline-flex items-center gap-1">
                      {label}
                      {sortConfig?.col === key ? (
                        sortConfig.dir === "asc" ? (
                          <ChevronUp className="w-3 h-3 text-amber-500" />
                        ) : (
                          <ChevronDown className="w-3 h-3 text-amber-500" />
                        )
                      ) : (
                        <ChevronDown className="w-3 h-3 opacity-20" />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row, i) => (
                <tr
                  key={`${row.date}-${i}`}
                  className={i % 2 === 0 ? "" : "bg-commodity-card/30"}
                >
                  <td className="px-3 py-1.5 text-commodity-muted font-mono">
                    {fmtDate(row.date)}
                  </td>
                  <td className="px-3 py-1.5 text-commodity-text font-mono">
                    {row.open.toFixed(2)}
                  </td>
                  <td className="px-3 py-1.5 text-emerald-400 font-mono">
                    {row.high.toFixed(2)}
                  </td>
                  <td className="px-3 py-1.5 text-red-400 font-mono">
                    {row.low.toFixed(2)}
                  </td>
                  <td className="px-3 py-1.5 text-commodity-text font-mono font-semibold">
                    {row.close.toFixed(2)}
                  </td>
                  <td className="px-3 py-1.5 text-commodity-muted font-mono">
                    {row.volume.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {remaining > 0 && (
          <button
            onClick={() => setPreviewPage((p) => p + 1)}
            className="mt-3 text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2"
          >
            Show more ({remaining} remaining)
          </button>
        )}
      </div>
    );
  };

  // ── Section C: Loaded datasets ────────────────────────────────────────────────

  const renderDatasetsPanel = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-commodity-text">Loaded Datasets</h2>
        {datasets.length > 0 && (
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400">
            {datasets.length}
          </span>
        )}
      </div>

      {datasets.length === 0 ? (
        <p className="text-commodity-muted text-xs">
          No datasets loaded yet. Upload a CSV or fetch market data.
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {datasets.map((ds) => {
            const isExpanded = expandedId === ds.id;
            const isActive = activeDatasetIds.includes(ds.id);
            return (
              <div
                key={ds.id}
                className={`rounded-xl bg-commodity-panel border overflow-hidden transition-colors ${
                  isActive ? "border-amber-500/60" : "border-commodity-border"
                }`}
              >
                {/* Card header — click toggles active */}
                <div
                  className="p-4 cursor-pointer hover:bg-slate-800/40 transition-colors"
                  onClick={() => toggleActiveDataset(ds.id)}
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <p className="font-semibold text-commodity-text text-base truncate">
                          {ds.name}
                        </p>
                        <span
                          className={`font-mono text-[10px] px-1.5 py-0.5 rounded-full border ${
                            ds.source === "csv"
                              ? "bg-sky-500/10 border-sky-500/30 text-sky-400"
                              : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                          }`}
                        >
                          {ds.source.toUpperCase()}
                        </span>
                        {isActive && (
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400">
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <p className="text-commodity-muted text-xs">
                        {ds.metadata.rowCount.toLocaleString()} rows ·{" "}
                        {ds.dateRange.start} → {ds.dateRange.end}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleExpand(ds.id);
                        }}
                        className="p-1.5 rounded-md text-commodity-muted hover:text-commodity-text hover:bg-slate-700/50 transition-colors"
                        aria-label={isExpanded ? "Collapse preview" : "Expand preview"}
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(ds.id);
                        }}
                        className="p-1.5 rounded-md text-commodity-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        aria-label="Delete dataset"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {/* Sparkline */}
                  <Sparkline records={ds.records} />
                </div>

                {/* Expanded data preview */}
                {isExpanded && renderPreviewTable(ds)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // ── Tab 2 rendering ───────────────────────────────────────────────────────────

  const renderCommoditySelector = () => {
    const grouped = commodities.reduce<Record<string, CommodityInfo[]>>((acc, c) => {
      (acc[c.category] ??= []).push(c);
      return acc;
    }, {});

    return (
      <div className="rounded-xl bg-commodity-card border border-commodity-border p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-commodity-text">Select Commodities</h2>
          <span className="text-xs text-commodity-muted">
            {selectedTickers.size > 0
              ? `${selectedTickers.size} commodit${selectedTickers.size === 1 ? "y" : "ies"} selected`
              : "None selected"}
          </span>
        </div>

        <div className="space-y-5">
          {Object.entries(grouped).map(([category, items]) => {
            const cfg = CATEGORY_CONFIG[category] ?? { emoji: "", border: "border-commodity-border", text: "text-commodity-muted" };
            return (
              <div key={category}>
                <div className={`flex items-center justify-between border-l-2 pl-3 mb-2 ${cfg.border}`}>
                  <span className={`text-xs font-semibold ${cfg.text}`}>
                    {cfg.emoji} {category}
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => selectCategory(category)}
                      className="text-[11px] text-commodity-muted hover:text-amber-400 transition-colors"
                    >
                      Select All
                    </button>
                    <span className="text-commodity-border text-xs">·</span>
                    <button
                      onClick={() => deselectCategory(category)}
                      className="text-[11px] text-commodity-muted hover:text-amber-400 transition-colors"
                    >
                      Deselect All
                    </button>
                  </div>
                </div>
                <div className="space-y-0.5 pl-3">
                  {items.map((c) => (
                    <label
                      key={c.ticker}
                      className="flex items-center gap-3 py-1.5 cursor-pointer group"
                    >
                      <input
                        type="checkbox"
                        checked={selectedTickers.has(c.ticker)}
                        onChange={() => toggleTicker(c.ticker)}
                        className="accent-amber-500 w-3.5 h-3.5 cursor-pointer"
                      />
                      <span className="text-sm text-commodity-text group-hover:text-amber-400 transition-colors">
                        {c.name}
                      </span>
                      <span className="text-xs text-commodity-muted font-mono ml-auto">
                        {c.ticker}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderDateRange = () => {
    const isIntraday = fetchInterval === "5m" || fetchInterval === "15m" || fetchInterval === "1h";
    const minDate = fetchInterval === "5m" || fetchInterval === "15m"
      ? getStartDate("2M")
      : fetchInterval === "1h"
      ? getStartDate("2Y")
      : undefined;

    const INTERVAL_ROWS: Array<{ label: string; pills: Array<{ value: DataInterval; display: string }> }> = [
      {
        label: "Intraday",
        pills: [
          { value: "5m",  display: "5min"  },
          { value: "15m", display: "15min" },
          { value: "1h",  display: "1hour" },
        ],
      },
      {
        label: "Standard",
        pills: [
          { value: "1d",  display: "Daily"   },
          { value: "1wk", display: "Weekly"  },
          { value: "1mo", display: "Monthly" },
        ],
      },
    ];

    return (
      <div className="rounded-xl bg-commodity-card border border-commodity-border p-6">
        <h2 className="text-sm font-semibold text-commodity-text mb-4">Date Range &amp; Interval</h2>

        {/* Interval pill selector — two rows */}
        <div className="mb-5 space-y-2">
          {INTERVAL_ROWS.map((row) => (
            <div key={row.label} className="flex items-center gap-3">
              <span className="text-[10px] text-commodity-muted w-14 shrink-0 uppercase tracking-wider">
                {row.label}
              </span>
              <div className="flex gap-1.5">
                {row.pills.map(({ value, display }) => (
                  <button
                    key={value}
                    onClick={() => handleIntervalChange(value)}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      fetchInterval === value
                        ? "bg-amber-500 text-slate-900"
                        : "bg-commodity-panel border border-commodity-border text-commodity-muted hover:border-slate-500 hover:text-commodity-text"
                    }`}
                  >
                    {display}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Intraday info note */}
        {isIntraday && (
          <div className="flex items-start gap-2 mb-4 px-3 py-2 rounded-lg bg-amber-500/8 border border-amber-500/25 text-amber-400 text-xs">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              {fetchInterval === "1h"
                ? "1h interval limited to last 2 years of history."
                : "5m/15m intervals limited to last 60 days of history."}
            </span>
          </div>
        )}

        {/* Quick range pills — filtered by interval */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {getVisibleRangePills(fetchInterval).map((pill: RangePill) => (
            <button
              key={pill}
              onClick={() => handleRangePill(pill)}
              className={`px-2.5 py-1 rounded-md text-xs font-mono font-medium transition-colors ${
                activeRange === pill
                  ? "bg-amber-500 text-slate-900"
                  : "bg-commodity-panel border border-commodity-border text-commodity-muted hover:border-slate-500 hover:text-commodity-text"
              }`}
            >
              {pill}
            </button>
          ))}
        </div>

        {/* Date inputs */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-[11px] text-commodity-muted mb-1">Start Date</label>
            <input
              type="date"
              value={startDate}
              min={minDate}
              onChange={(e) => { setStartDate(e.target.value); setActiveRange("1M"); }}
              className="w-full bg-commodity-panel border border-commodity-border rounded-lg px-3 py-2 text-xs text-commodity-text focus:outline-none focus:border-amber-500/50 [color-scheme:dark]"
            />
          </div>
          <div className="flex-1">
            <label className="block text-[11px] text-commodity-muted mb-1">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setActiveRange("1M"); }}
              className="w-full bg-commodity-panel border border-commodity-border rounded-lg px-3 py-2 text-xs text-commodity-text focus:outline-none focus:border-amber-500/50 [color-scheme:dark]"
            />
          </div>
        </div>
      </div>
    );
  };

  const renderPresetPacks = () => (
    <div className="rounded-xl bg-commodity-card border border-commodity-border p-6">
      <h2 className="text-sm font-semibold text-commodity-text mb-4">Preset Packs</h2>
      <div className="flex flex-wrap gap-3">
        {PRESET_PACKS.map((pack) => (
          <button
            key={pack.label}
            onClick={() => handlePresetPack(pack.tickers)}
            disabled={fetchPhase === "fetching"}
            className="px-4 py-2.5 rounded-lg bg-commodity-panel border border-commodity-border text-sm text-commodity-text hover:border-amber-500/50 hover:bg-amber-500/5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pack.label}
          </button>
        ))}
      </div>
    </div>
  );

  const renderFetchSection = () => (
    <div className="rounded-xl bg-commodity-card border border-commodity-border p-6">
      <button
        onClick={() => handleFetch()}
        disabled={selectedTickers.size === 0 || fetchPhase === "fetching"}
        className="w-full py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {fetchPhase === "fetching"
          ? `Fetching ${fetchProgress.current}/${fetchProgress.total}…`
          : `Fetch Selected Data${selectedTickers.size > 0 ? ` (${selectedTickers.size})` : ""}`}
      </button>

      {fetchPhase === "fetching" && (
        <div className="mt-3">
          <div className="h-1 bg-commodity-border rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all duration-300 ease-out"
              style={{
                width: `${fetchProgress.total > 0
                  ? (fetchProgress.current / fetchProgress.total) * 100
                  : 0}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl animate-fade-in">
      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-lg bg-sky-500/10 border border-sky-500/20">
          <Database className="w-5 h-5 text-sky-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-commodity-text">Data Hub</h1>
          <p className="text-commodity-muted text-xs mt-0.5">
            Import and manage commodity datasets.
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-commodity-border mb-6">
        {(["upload", "fetch"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? "border-amber-500 text-amber-500"
                : "border-transparent text-commodity-muted hover:text-commodity-text"
            }`}
          >
            {tab === "upload" ? "Upload CSV" : "Fetch Market Data"}
          </button>
        ))}
      </div>

      {activeTab === "upload" ? (
        <div className="space-y-6">
          <div className="rounded-xl bg-commodity-card border border-commodity-border p-6">
            <h2 className="text-sm font-semibold text-commodity-text mb-4">Upload Zone</h2>
            {renderUploadZone()}
          </div>
          {renderMappingPreview()}
          <div className="rounded-xl bg-commodity-card border border-commodity-border p-6">
            {renderDatasetsPanel()}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {renderCommoditySelector()}
          {renderDateRange()}
          {renderPresetPacks()}
          {renderFetchSection()}
          {backendWarnings.length > 0 && (
            <div className="rounded-xl bg-amber-500/8 border border-amber-500/25 px-4 py-3 space-y-1">
              {backendWarnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-amber-400">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}
          <div className="rounded-xl bg-commodity-card border border-commodity-border p-6">
            {renderDatasetsPanel()}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-xl text-sm font-medium transition-all ${
            toast.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
              : "bg-amber-500/10 border-amber-500/30 text-amber-400"
          }`}
        >
          {toast.type === "success"
            ? <CheckCircle className="w-4 h-4 shrink-0" />
            : <AlertCircle className="w-4 h-4 shrink-0" />}
          {toast.message}
        </div>
      )}
    </div>
  );
}
