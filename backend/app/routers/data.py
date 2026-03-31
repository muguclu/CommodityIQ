import uuid
from datetime import datetime, timezone
from typing import Optional

import pandas as pd
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from app.models.schemas import (
    CSVUploadResponse,
    CommodityDataset,
    ColumnSampleInfo,
    DatasetMetadata,
    DateRange,
    OHLCVRecord,
)

router = APIRouter(tags=["data"])

# Column name aliases for auto-detection (lowercase)
_DATE_HINTS = {"date", "time", "timestamp", "datetime", "day", "period"}
_OPEN_HINTS = {"open", "open price"}
_HIGH_HINTS = {"high", "high price", "max", "maximum"}
_LOW_HINTS = {"low", "low price", "min", "minimum"}
_CLOSE_HINTS = {"close", "closing", "close price", "last", "price", "settle", "settlement"}
_VOLUME_HINTS = {"volume", "vol", "qty", "quantity", "turnover"}
_ADJ_HINTS = {"adj close", "adjusted close", "adj. close", "adjclose", "adjusted"}


def _detect_column(candidates: list[str], hints: set[str]) -> Optional[str]:
    for col in candidates:
        if col.lower().strip() in hints:
            return col
    for col in candidates:
        for hint in hints:
            if hint in col.lower():
                return col
    return None


def _safe_float(val) -> Optional[float]:
    try:
        f = float(val)
        return None if pd.isna(f) else f
    except (ValueError, TypeError):
        return None


@router.post("/upload-csv", response_model=CSVUploadResponse)
async def upload_csv(file: UploadFile = File(...)):
    # Validate file type
    filename = file.filename or ""
    if not (filename.endswith(".csv") or filename.endswith(".tsv")):
        raise HTTPException(status_code=400, detail="Only .csv and .tsv files are accepted.")

    try:
        content = await file.read()
        sep = "\t" if filename.endswith(".tsv") else ","
        df = pd.read_csv(
            pd.io.common.BytesIO(content),
            sep=sep,
            thousands=",",
            on_bad_lines="skip",
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to parse file: {exc}") from exc

    if df.empty:
        raise HTTPException(status_code=400, detail="The file is empty.")

    columns = df.columns.tolist()

    # Auto-detect columns
    date_col = _detect_column(columns, _DATE_HINTS)
    open_col = _detect_column(columns, _OPEN_HINTS)
    high_col = _detect_column(columns, _HIGH_HINTS)
    low_col = _detect_column(columns, _LOW_HINTS)
    close_col = _detect_column(columns, _CLOSE_HINTS)
    volume_col = _detect_column(columns, _VOLUME_HINTS)
    adj_col = _detect_column(columns, _ADJ_HINTS)

    if date_col is None:
        raise HTTPException(
            status_code=400,
            detail=f"Could not detect a date column. Available columns: {columns}",
        )
    if close_col is None:
        raise HTTPException(
            status_code=400,
            detail=f"Could not detect a close/price column. Available columns: {columns}",
        )

    # Parse dates
    try:
        df[date_col] = pd.to_datetime(df[date_col], infer_datetime_format=True)
    except Exception:
        raise HTTPException(
            status_code=400,
            detail=f"Column '{date_col}' could not be parsed as dates.",
        )

    # Drop rows where date or close are NaN
    df = df.dropna(subset=[date_col, close_col])
    if len(df) < 10:
        raise HTTPException(
            status_code=400,
            detail=f"Dataset has fewer than 10 valid rows after cleaning (got {len(df)}).",
        )

    df = df.sort_values(date_col).reset_index(drop=True)

    # Build records
    records: list[OHLCVRecord] = []
    for _, row in df.iterrows():
        close_val = _safe_float(row[close_col])
        if close_val is None:
            continue
        records.append(
            OHLCVRecord(
                date=row[date_col].strftime("%Y-%m-%d"),
                open=_safe_float(row[open_col]) if open_col else close_val,
                high=_safe_float(row[high_col]) if high_col else close_val,
                low=_safe_float(row[low_col]) if low_col else close_val,
                close=close_val,
                volume=_safe_float(row[volume_col]) if volume_col else 0.0,
                adjClose=_safe_float(row[adj_col]) if adj_col else None,
            )
        )

    date_range = DateRange(
        start=records[0].date,
        end=records[-1].date,
    )

    dataset_name = filename.rsplit(".", 1)[0].replace("_", " ").replace("-", " ").title()

    dataset = CommodityDataset(
        id=str(uuid.uuid4()),
        name=dataset_name,
        source="csv",
        records=records,
        dateRange=date_range,
        metadata=DatasetMetadata(
            rowCount=len(records),
            columns=columns,
            uploadedAt=datetime.now(timezone.utc).isoformat(),
        ),
    )

    # Build column role map for mapping preview
    col_role_map: dict[str, str] = {}
    if date_col:
        col_role_map[date_col] = "date"
    if open_col:
        col_role_map[open_col] = "open"
    if high_col:
        col_role_map[high_col] = "high"
    if low_col:
        col_role_map[low_col] = "low"
    if close_col:
        col_role_map[close_col] = "close"
    if volume_col:
        col_role_map[volume_col] = "volume"
    if adj_col:
        col_role_map[adj_col] = "adjClose"

    column_info = [
        ColumnSampleInfo(
            col_name=col,
            detected_as=col_role_map.get(col),
            samples=[str(v) for v in df[col].dropna().head(3).tolist()],
        )
        for col in columns
    ]

    return CSVUploadResponse(success=True, data=dataset, column_info=column_info)
