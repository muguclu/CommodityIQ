"""
Smart Money Concepts (SMC) Detection Engine
=============================================
Detects institutional trading patterns from OHLCV data:

1. Swing Points: Local highs and lows using N-bar lookback
2. Market Structure: Higher Highs (HH), Higher Lows (HL), Lower Highs (LH), Lower Lows (LL)
3. Break of Structure (BOS): Continuation break in trend direction
4. Market Structure Break (MSB): Reversal break against the trend (also called CHoCH)
5. Supply Zones: Last bearish candle before a strong bullish move (institutional selling origin)
6. Demand Zones: Last bullish candle before a strong bearish move (institutional buying origin)
7. Liquidity Pools: Equal Highs (EQH), Equal Lows (EQL), Buy-Side Liquidity (BSL), Sell-Side Liquidity (SSL)

All detection is LOOKBACK ONLY — no future data leakage.
"""

import numpy as np
import pandas as pd
from typing import List, Dict, Optional
from dataclasses import dataclass, asdict

@dataclass
class SwingPoint:
    index: int
    date: str
    price: float
    type: str          # "high" or "low"
    strength: int      # How many bars on each side confirm it (higher = stronger)

@dataclass 
class StructurePoint:
    index: int
    date: str
    price: float
    label: str         # "HH", "HL", "LH", "LL"
    trend: str         # "bullish" or "bearish"

@dataclass
class StructureBreak:
    index: int
    date: str
    price: float
    type: str          # "BOS" (continuation) or "MSB" (reversal, also called CHoCH)
    direction: str     # "bullish" or "bearish"
    broken_level: float
    description: str   # Human readable: "Bullish MSB: Price broke above LH at $4,350"

@dataclass
class Zone:
    start_index: int
    end_index: int
    start_date: str
    end_date: str
    top: float         # Upper boundary of the zone
    bottom: float      # Lower boundary of the zone
    type: str          # "supply" or "demand"
    strength: str      # "fresh" (untested), "tested" (price revisited), "broken" (invalidated)
    origin_candle: dict # The candle that created the zone: {date, open, high, low, close}
    
@dataclass
class LiquidityPool:
    index: int
    date: str
    price: float
    type: str          # "EQH" (equal highs), "EQL" (equal lows), "BSL" (buy-side), "SSL" (sell-side)
    num_touches: int   # How many times price touched this level
    swept: bool        # Whether liquidity has been taken (price broke through and returned)
    swept_date: Optional[str]


class SMCEngine:
    """
    Detects Smart Money Concepts patterns from OHLCV data.
    All methods work on any timeframe — daily, hourly, 5-minute, etc.
    """
    
    def __init__(self, swing_lookback: int = 5, equal_threshold_pct: float = 0.1):
        """
        Args:
            swing_lookback: Number of bars on each side to confirm a swing point.
                           5 for daily, 3 for intraday recommended.
            equal_threshold_pct: Price difference threshold (%) to consider two 
                                highs/lows as "equal" for liquidity detection.
                                0.1 = 0.1% tolerance.
        """
        self.swing_lookback = swing_lookback
        self.equal_threshold_pct = equal_threshold_pct
    
    def detect_swing_points(self, df: pd.DataFrame) -> List[SwingPoint]:
        """
        Find swing highs and swing lows.
        A swing high: bar where HIGH is highest among N bars left AND right.
        A swing low: bar where LOW is lowest among N bars left AND right.
        
        CRITICAL: For the LAST N bars, we only use left-side confirmation
        (can't look right/future). These are marked with lower strength.
        """
        highs = df['high'].values
        lows = df['low'].values
        dates = df['date'].values if 'date' in df.columns else df.index.astype(str).values
        n = len(df)
        swings = []
        
        for i in range(self.swing_lookback, n):
            # Left lookback (always available)
            left_start = max(0, i - self.swing_lookback)
            left_highs = highs[left_start:i]
            left_lows = lows[left_start:i]
            
            # Right lookback (only if not at the edge)
            right_end = min(n, i + self.swing_lookback + 1)
            right_available = right_end - i - 1
            
            if right_available >= self.swing_lookback:
                right_highs = highs[i+1:right_end]
                right_lows = lows[i+1:right_end]
                strength = self.swing_lookback
            else:
                # Near the end — only use left side, mark as weaker
                right_highs = highs[i+1:right_end] if i + 1 < n else np.array([])
                right_lows = lows[i+1:right_end] if i + 1 < n else np.array([])
                strength = max(1, right_available)
            
            # Swing High: current high > all left highs AND all right highs
            is_swing_high = (
                highs[i] >= np.max(left_highs) and
                (len(right_highs) == 0 or highs[i] >= np.max(right_highs))
            )
            
            # Swing Low: current low <= all left lows AND all right lows
            is_swing_low = (
                lows[i] <= np.min(left_lows) and
                (len(right_lows) == 0 or lows[i] <= np.min(right_lows))
            )
            
            if is_swing_high:
                swings.append(SwingPoint(
                    index=i, date=str(dates[i]), price=float(highs[i]),
                    type="high", strength=strength
                ))
            
            if is_swing_low:
                swings.append(SwingPoint(
                    index=i, date=str(dates[i]), price=float(lows[i]),
                    type="low", strength=strength
                ))
        
        return swings
    
    def detect_market_structure(self, swings: List[SwingPoint]) -> List[StructurePoint]:
        """
        Label swing points as HH/HL/LH/LL based on sequence.
        
        Bullish structure: HH + HL (higher highs and higher lows)
        Bearish structure: LH + LL (lower highs and lower lows)
        """
        structure = []
        
        # Separate highs and lows
        swing_highs = [s for s in swings if s.type == "high"]
        swing_lows = [s for s in swings if s.type == "low"]
        
        # Label highs
        for i in range(1, len(swing_highs)):
            prev = swing_highs[i-1]
            curr = swing_highs[i]
            
            if curr.price > prev.price:
                label = "HH"
                trend = "bullish"
            else:
                label = "LH"
                trend = "bearish"
            
            structure.append(StructurePoint(
                index=curr.index, date=curr.date, price=curr.price,
                label=label, trend=trend
            ))
        
        # Label lows
        for i in range(1, len(swing_lows)):
            prev = swing_lows[i-1]
            curr = swing_lows[i]
            
            if curr.price > prev.price:
                label = "HL"
                trend = "bullish"
            else:
                label = "LL"
                trend = "bearish"
            
            structure.append(StructurePoint(
                index=curr.index, date=curr.date, price=curr.price,
                label=label, trend=trend
            ))
        
        # Sort by index
        structure.sort(key=lambda s: s.index)
        return structure
    
    def detect_breaks(
        self, df: pd.DataFrame, swings: List[SwingPoint], structure: List[StructurePoint]
    ) -> List[StructureBreak]:
        """
        Detect BOS (Break of Structure) and MSB (Market Structure Break / CHoCH).
        
        BOS = price breaks a swing point IN THE DIRECTION of the current trend
              (continuation signal)
        MSB = price breaks a swing point AGAINST the current trend
              (reversal signal, also called Change of Character / CHoCH)
        
        Detection: When a candle's close breaks above a previous swing high or 
                   below a previous swing low.
        """
        closes = df['close'].values
        dates = df['date'].values if 'date' in df.columns else df.index.astype(str).values
        breaks = []
        
        swing_highs = sorted([s for s in swings if s.type == "high"], key=lambda s: s.index)
        swing_lows = sorted([s for s in swings if s.type == "low"], key=lambda s: s.index)
        
        # Determine current trend from last few structure points
        def get_trend_at(idx: int) -> str:
            recent = [s for s in structure if s.index < idx]
            if len(recent) < 2:
                return "unknown"
            last_two = recent[-2:]
            bullish_count = sum(1 for s in last_two if s.trend == "bullish")
            return "bullish" if bullish_count >= 1 else "bearish"
        
        # Check each bar for breaks
        for i in range(1, len(df)):
            current_trend = get_trend_at(i)
            
            # Check break above swing highs
            for sh in reversed(swing_highs):
                if sh.index >= i:
                    continue
                if sh.index < i - 100:  # Don't look too far back
                    break
                    
                # Close broke above this swing high
                if closes[i] > sh.price and closes[i-1] <= sh.price:
                    if current_trend == "bearish":
                        break_type = "MSB"  # Breaking against trend = reversal
                        direction = "bullish"
                        desc = f"Bullish MSB: Price broke above swing high at ${sh.price:,.2f}"
                    else:
                        break_type = "BOS"  # Breaking with trend = continuation
                        direction = "bullish"
                        desc = f"Bullish BOS: Price broke above swing high at ${sh.price:,.2f}"
                    
                    breaks.append(StructureBreak(
                        index=i, date=str(dates[i]), price=float(closes[i]),
                        type=break_type, direction=direction,
                        broken_level=sh.price, description=desc
                    ))
                    break  # Only detect the most recent break
            
            # Check break below swing lows
            for sl in reversed(swing_lows):
                if sl.index >= i:
                    continue
                if sl.index < i - 100:
                    break
                    
                if closes[i] < sl.price and closes[i-1] >= sl.price:
                    if current_trend == "bullish":
                        break_type = "MSB"
                        direction = "bearish"
                        desc = f"Bearish MSB: Price broke below swing low at ${sl.price:,.2f}"
                    else:
                        break_type = "BOS"
                        direction = "bearish"
                        desc = f"Bearish BOS: Price broke below swing low at ${sl.price:,.2f}"
                    
                    breaks.append(StructureBreak(
                        index=i, date=str(dates[i]), price=float(closes[i]),
                        type=break_type, direction=direction,
                        broken_level=sl.price, description=desc
                    ))
                    break
        
        return breaks
    
    def detect_supply_demand_zones(
        self, df: pd.DataFrame, swings: List[SwingPoint], breaks: List[StructureBreak]
    ) -> List[Zone]:
        """
        Detect supply and demand zones.
        
        DEMAND ZONE: The last bearish (or small) candle before a strong bullish move.
                     This is where institutions placed buy orders.
                     Zone = that candle's low to open/close (whichever is higher).
        
        SUPPLY ZONE: The last bullish (or small) candle before a strong bearish move.
                     This is where institutions placed sell orders.
                     Zone = that candle's high to open/close (whichever is lower).
        
        Zone becomes "tested" when price revisits it, "broken" when price closes through it.
        """
        opens = df['open'].values
        highs = df['high'].values
        lows = df['low'].values
        closes = df['close'].values
        dates = df['date'].values if 'date' in df.columns else df.index.astype(str).values
        zones = []
        
        # Use structure breaks as zone origins — the candle BEFORE the break is the zone
        for brk in breaks:
            if brk.index < 2:
                continue
            
            origin_idx = brk.index - 1  # Candle before the break
            
            if brk.direction == "bullish":
                # DEMAND zone — area where buying started
                zone_bottom = float(lows[origin_idx])
                zone_top = float(max(opens[origin_idx], closes[origin_idx]))
                zone_type = "demand"
            else:
                # SUPPLY zone — area where selling started
                zone_top = float(highs[origin_idx])
                zone_bottom = float(min(opens[origin_idx], closes[origin_idx]))
                zone_type = "supply"
            
            # Check zone status: fresh, tested, or broken
            strength = "fresh"
            for j in range(brk.index + 1, len(df)):
                if zone_type == "demand":
                    if lows[j] <= zone_top and lows[j] >= zone_bottom:
                        strength = "tested"
                    if closes[j] < zone_bottom:
                        strength = "broken"
                        break
                else:  # supply
                    if highs[j] >= zone_bottom and highs[j] <= zone_top:
                        strength = "tested"
                    if closes[j] > zone_top:
                        strength = "broken"
                        break
            
            zones.append(Zone(
                start_index=origin_idx,
                end_index=len(df) - 1,  # Zone extends to current bar (or until broken)
                start_date=str(dates[origin_idx]),
                end_date=str(dates[-1]),
                top=zone_top,
                bottom=zone_bottom,
                type=zone_type,
                strength=strength,
                origin_candle={
                    "date": str(dates[origin_idx]),
                    "open": float(opens[origin_idx]),
                    "high": float(highs[origin_idx]),
                    "low": float(lows[origin_idx]),
                    "close": float(closes[origin_idx]),
                }
            ))
        
        return zones
    
    def detect_liquidity_pools(self, df: pd.DataFrame, swings: List[SwingPoint]) -> List[LiquidityPool]:
        """
        Detect liquidity pools where stop-losses cluster.
        
        EQUAL HIGHS (EQH): 2+ swing highs at similar price → buy-side liquidity above
        EQUAL LOWS (EQL): 2+ swing lows at similar price → sell-side liquidity below
        BSL (Buy-Side Liquidity): Area above obvious resistance (EQH, triple tops)
        SSL (Sell-Side Liquidity): Area below obvious support (EQL, triple bottoms)
        
        "Swept" = price broke through the level and returned (liquidity taken).
        """
        closes = df['close'].values
        highs = df['high'].values
        lows = df['low'].values
        dates = df['date'].values if 'date' in df.columns else df.index.astype(str).values
        pools = []
        
        swing_highs = [s for s in swings if s.type == "high"]
        swing_lows = [s for s in swings if s.type == "low"]
        
        threshold_mult = self.equal_threshold_pct / 100
        
        # Find Equal Highs (EQH)
        for i in range(len(swing_highs)):
            touches = [swing_highs[i]]
            for j in range(i + 1, len(swing_highs)):
                price_diff = abs(swing_highs[j].price - swing_highs[i].price)
                if price_diff / swing_highs[i].price < threshold_mult:
                    touches.append(swing_highs[j])
            
            if len(touches) >= 2:
                avg_price = np.mean([t.price for t in touches])
                last_touch = max(touches, key=lambda t: t.index)
                
                # Check if swept
                swept = False
                swept_date = None
                for k in range(last_touch.index + 1, len(df)):
                    if highs[k] > avg_price * (1 + threshold_mult):
                        swept = True
                        swept_date = str(dates[k])
                        break
                
                pools.append(LiquidityPool(
                    index=last_touch.index,
                    date=last_touch.date,
                    price=float(avg_price),
                    type="EQH",
                    num_touches=len(touches),
                    swept=swept,
                    swept_date=swept_date
                ))
        
        # Find Equal Lows (EQL)
        for i in range(len(swing_lows)):
            touches = [swing_lows[i]]
            for j in range(i + 1, len(swing_lows)):
                price_diff = abs(swing_lows[j].price - swing_lows[i].price)
                if price_diff / swing_lows[i].price < threshold_mult:
                    touches.append(swing_lows[j])
            
            if len(touches) >= 2:
                avg_price = np.mean([t.price for t in touches])
                last_touch = max(touches, key=lambda t: t.index)
                
                swept = False
                swept_date = None
                for k in range(last_touch.index + 1, len(df)):
                    if lows[k] < avg_price * (1 - threshold_mult):
                        swept = True
                        swept_date = str(dates[k])
                        break
                
                pools.append(LiquidityPool(
                    index=last_touch.index,
                    date=last_touch.date,
                    price=float(avg_price),
                    type="EQL",
                    num_touches=len(touches),
                    swept=swept,
                    swept_date=swept_date
                ))
        
        # Deduplicate pools at similar levels
        pools = self._deduplicate_pools(pools)
        return pools
    
    def _deduplicate_pools(self, pools: List[LiquidityPool]) -> List[LiquidityPool]:
        """Remove duplicate pools at very similar price levels."""
        if not pools:
            return pools
        
        threshold = self.equal_threshold_pct / 100
        unique = [pools[0]]
        for pool in pools[1:]:
            is_dup = False
            for u in unique:
                if (pool.type == u.type and 
                    abs(pool.price - u.price) / u.price < threshold):
                    if pool.num_touches > u.num_touches:
                        unique.remove(u)
                        unique.append(pool)
                    is_dup = True
                    break
            if not is_dup:
                unique.append(pool)
        return unique
    
    def analyze(self, df: pd.DataFrame) -> dict:
        """
        Run full SMC analysis on OHLCV DataFrame.
        
        Args:
            df: DataFrame with columns: date, open, high, low, close, volume
                Works with any timeframe.
                
        Returns:
            Complete SMC analysis result.
        """
        # Auto-adjust swing lookback for intraday data
        if len(df) > 2000:
            self.swing_lookback = 3  # Tighter for intraday
        
        swings = self.detect_swing_points(df)
        structure = self.detect_market_structure(swings)
        breaks = self.detect_breaks(df, swings, structure)
        zones = self.detect_supply_demand_zones(df, swings, breaks)
        liquidity = self.detect_liquidity_pools(df, swings)
        
        # Current market structure summary
        recent_structure = structure[-4:] if structure else []
        recent_breaks = breaks[-3:] if breaks else []
        
        bullish_count = sum(1 for s in recent_structure if s.trend == "bullish")
        current_bias = "bullish" if bullish_count > len(recent_structure) / 2 else "bearish"
        
        # Active zones (not broken)
        active_supply = [z for z in zones if z.type == "supply" and z.strength != "broken"]
        active_demand = [z for z in zones if z.type == "demand" and z.strength != "broken"]
        
        # Unswept liquidity
        unswept = [p for p in liquidity if not p.swept]
        
        return {
            "swing_points": [asdict(s) for s in swings],
            "structure": [asdict(s) for s in structure],
            "breaks": [asdict(b) for b in breaks],
            "zones": [asdict(z) for z in zones],
            "liquidity_pools": [asdict(p) for p in liquidity],
            
            "summary": {
                "current_bias": current_bias,
                "total_swing_points": len(swings),
                "total_breaks": len(breaks),
                "msb_count": sum(1 for b in breaks if b.type == "MSB"),
                "bos_count": sum(1 for b in breaks if b.type == "BOS"),
                "active_supply_zones": len(active_supply),
                "active_demand_zones": len(active_demand),
                "unswept_liquidity": len(unswept),
                "nearest_supply": min([z.bottom for z in active_supply], default=None),
                "nearest_demand": max([z.top for z in active_demand], default=None),
                "last_break": asdict(breaks[-1]) if breaks else None,
            }
        }
