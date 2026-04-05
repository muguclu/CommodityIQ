import type { Direction } from "../types";

const ICON: Record<Direction, string>    = { bullish: "↑", bearish: "↓", neutral: "→" };
const COLOR: Record<Direction, string>   = {
  bullish: "text-emerald-400",
  bearish: "text-red-400",
  neutral: "text-slate-400",
};

interface Props {
  tftDirection: Direction;
  smcBias:      Direction;
}

export default function IndicatorRow({ tftDirection, smcBias }: Props) {
  const agree = tftDirection !== "neutral" && smcBias !== "neutral" && tftDirection === smcBias;

  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <Indicator label="TFT" direction={tftDirection} />
      {agree && (
        <span className="text-emerald-500/70 text-[10px] font-medium tracking-wider uppercase">
          Agree
        </span>
      )}
      <Indicator label="SMC" direction={smcBias} />
    </div>
  );
}

function Indicator({ label, direction }: { label: string; direction: Direction }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-slate-500">{label}:</span>
      <span className={`font-bold ${COLOR[direction]}`} aria-label={`${label} direction: ${direction}`}>
        {ICON[direction]}
      </span>
      <span className={`${COLOR[direction]} hidden sm:inline`}>{direction}</span>
    </div>
  );
}
