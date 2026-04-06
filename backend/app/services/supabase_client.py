"""
Supabase REST client — uses httpx, not the Python SDK.
All calls are async. Failures are logged and swallowed so they never
break the signal-generation path.
"""

import logging
from typing import Any, Dict, List, Optional

import httpx

from app.config import settings

logger = logging.getLogger("commodityiq.supabase")

TABLE = "signals_history"
TIMEOUT = 10.0


def _headers() -> Dict[str, str]:
    key = settings.SUPABASE_SERVICE_ROLE_KEY
    return {
        "apikey":        key,
        "Authorization": f"Bearer {key}",
        "Content-Type":  "application/json",
        "Prefer":        "return=minimal",
    }


def _base() -> str:
    return f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/{TABLE}"


def _is_configured() -> bool:
    return bool(settings.SUPABASE_URL and settings.SUPABASE_SERVICE_ROLE_KEY)


# ── Write ─────────────────────────────────────────────────────────────────────

async def insert_signal(record: Dict[str, Any]) -> bool:
    """INSERT one row into signals_history. Returns True on success."""
    if not _is_configured():
        logger.debug("Supabase not configured — skipping insert.")
        return False
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.post(_base(), headers=_headers(), json=record)
            if r.status_code not in (200, 201):
                logger.warning("Supabase insert failed %s: %s", r.status_code, r.text[:200])
                return False
        return True
    except Exception as exc:
        logger.warning("Supabase insert error: %s", exc)
        return False


async def update_outcome(
    record_id: str,
    outcome: str,
    outcome_price: Optional[float],
    outcome_at: str,
) -> bool:
    """PATCH outcome fields for a specific row by id."""
    if not _is_configured():
        return False
    payload = {
        "outcome":       outcome,
        "outcome_price": outcome_price,
        "outcome_at":    outcome_at,
    }
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.patch(
                _base(),
                headers={**_headers(), "Prefer": "return=minimal"},
                params={"id": f"eq.{record_id}"},
                json=payload,
            )
            if r.status_code not in (200, 204):
                logger.warning("Supabase update failed %s: %s", r.status_code, r.text[:200])
                return False
        return True
    except Exception as exc:
        logger.warning("Supabase update error: %s", exc)
        return False


# ── Read ──────────────────────────────────────────────────────────────────────

async def fetch_history(
    symbol:      Optional[str] = None,
    signal_type: Optional[str] = None,
    from_date:   Optional[str] = None,
    to_date:     Optional[str] = None,
    limit:       int           = 50,
    offset:      int           = 0,
) -> List[Dict[str, Any]]:
    """
    SELECT from signals_history with optional filters.
    Returns up to `limit` rows starting at `offset` (offset pagination).
    Supabase REST max is 1000 per request — callers should page accordingly.
    """
    if not _is_configured():
        return []

    params: Dict[str, str] = {
        "order":  "generated_at.desc",
        "limit":  str(min(limit, 1000)),
        "offset": str(offset),
    }
    if symbol:
        params["symbol"] = f"eq.{symbol.upper()}"
    if signal_type:
        params["signal_type"] = f"eq.{signal_type.upper()}"
    if from_date:
        params["generated_at"] = f"gte.{from_date}"
    if to_date:
        # Combine gte + lte requires two separate filter params — use PostgREST syntax
        existing = params.pop("generated_at", None)
        if existing:
            params["generated_at"] = existing          # gte already set
        # Append lte as a second filter via query string duplication — handled by httpx
        params["and"] = f"(generated_at.lte.{to_date})"

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            headers = {**_headers(), "Prefer": "count=exact"}
            r = await client.get(_base(), headers=headers, params=params)
            if r.status_code not in (200, 206):
                logger.warning("Supabase fetch failed %s: %s", r.status_code, r.text[:200])
                return []
            return r.json()
    except Exception as exc:
        logger.warning("Supabase fetch error: %s", exc)
        return []


async def fetch_pending_signals() -> List[Dict[str, Any]]:
    """Return all rows with outcome = 'pending'."""
    if not _is_configured():
        return []
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(
                _base(),
                headers=_headers(),
                params={"outcome": "eq.pending", "limit": "1000"},
            )
            if r.status_code not in (200, 206):
                return []
            return r.json()
    except Exception as exc:
        logger.warning("Supabase fetch pending error: %s", exc)
        return []


async def fetch_closed_signals(
    symbol:    Optional[str] = None,
    from_date: Optional[str] = None,
    to_date:   Optional[str] = None,
    limit:     int           = 500,
) -> List[Dict[str, Any]]:
    """Return all settled (non-pending) rows with full column set."""
    if not _is_configured():
        return []
    params: Dict[str, str] = {
        "outcome": "neq.pending",
        "order":   "generated_at.desc",
        "limit":   str(min(limit, 1000)),
    }
    if symbol:
        params["symbol"] = f"eq.{symbol.upper()}"
    if from_date:
        params["generated_at"] = f"gte.{from_date}"
    if to_date:
        params["and"] = f"(generated_at.lte.{to_date})"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(_base(), headers=_headers(), params=params)
            if r.status_code not in (200, 206):
                logger.warning("Supabase closed fetch failed %s", r.status_code)
                return []
            return r.json()
    except Exception as exc:
        logger.warning("Supabase closed fetch error: %s", exc)
        return []


async def fetch_stats() -> List[Dict[str, Any]]:
    """
    Return aggregate stats per symbol.
    We fetch all rows grouped manually (Supabase REST doesn't support GROUP BY
    directly without RPC; we aggregate in Python instead).
    """
    if not _is_configured():
        return []
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(
                _base(),
                headers=_headers(),
                params={
                    "select": "symbol,signal_type,outcome,confidence,risk_reward_ratio",
                    "limit":  "1000",
                },
            )
            if r.status_code not in (200, 206):
                return []
            return r.json()
    except Exception as exc:
        logger.warning("Supabase stats fetch error: %s", exc)
        return []
