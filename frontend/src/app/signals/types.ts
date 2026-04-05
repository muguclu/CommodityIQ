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
