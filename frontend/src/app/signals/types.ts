export type SignalType = "BUY" | "SELL" | "WAIT";
export type Direction  = "bullish" | "bearish" | "neutral";

export interface Signal {
  symbol:              string;
  signal_type:         SignalType;
  confidence:          number;       // 0.0 – 1.0
  entry_price:         number;
  take_profit:         number;
  stop_loss:           number;
  risk_reward_ratio:   number;
  tft_direction:       Direction;
  tft_forecast_price:  number;
  smc_bias:            Direction;
  smc_key_levels:      { support: number[]; resistance: number[] };
  timeframe:           string;
  generated_at:        string;       // ISO-8601
  valid_until:         string;       // ISO-8601
  metadata:            Record<string, unknown>;
}

export interface SignalResponse {
  signals:       Signal[];
  last_updated:  string;
  market_status: string;
}

export type Outcome = "pending" | "tp_hit" | "sl_hit" | "expired";

export interface SignalHistoryRecord {
  id?:               string;
  symbol:            string;
  signal_type:       SignalType;
  confidence:        number;
  entry_price?:      number;
  take_profit?:      number;
  stop_loss?:        number;
  risk_reward_ratio?: number;
  tft_direction?:    string;
  smc_bias?:         string;
  generated_at:      string;
  valid_until:       string;
  outcome:           Outcome;
  outcome_price?:    number;
  outcome_at?:       string;
  metadata?:         Record<string, unknown>;
}

export interface HistoryResponse {
  records: SignalHistoryRecord[];
  total:   number;
  limit:   number;
  offset:  number;
}

export interface SymbolStats {
  symbol:         string;
  total:          number;
  wins:           number;
  losses:         number;
  expired:        number;
  pending:        number;
  win_rate:       number;
  avg_confidence: number;
  avg_rr:         number;
}

export interface StatsResponse {
  symbols: SymbolStats[];
}
