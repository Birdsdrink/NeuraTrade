from datetime import datetime, timedelta
from typing import Dict, Optional
from .models import TickModel


class CandleBuilder:
    """Aggregate ticks into OHLC candles for a given timeframe (seconds).

    Usage:
        cb = CandleBuilder(timeframe_seconds=60)
        await cb.add_tick(tick)
        finished = cb.maybe_emit()  # returns list of completed candles
    """

    def __init__(self, timeframe_seconds: int = 60):
        self.timeframe = timeframe_seconds
        self._current: Optional[Dict[str, any]] = None

    def _floor_ts(self, epoch: int) -> int:
        return (epoch // self.timeframe) * self.timeframe

    def add_tick(self, tick: TickModel):
        """Add a tick (Pydantic model) and update internal current candle."""
        epoch = int(tick.epoch)
        bucket = self._floor_ts(epoch)
        price = float(tick.quote)

        if self._current is None:
            self._current = {
                "ts": bucket,
                "open": price,
                "high": price,
                "low": price,
                "close": price,
                "volume": 0.0,
            }
            return []

        # If tick belongs to same bucket, update
        if bucket == self._current["ts"]:
            self._current["high"] = max(self._current["high"], price)
            self._current["low"] = min(self._current["low"], price)
            self._current["close"] = price
            self._current["volume"] += 0.0  # ticks may not include volume
            return []

        # New bucket -> emit finished candle and start new current
        finished = self._current
        self._current = {
            "ts": bucket,
            "open": price,
            "high": price,
            "low": price,
            "close": price,
            "volume": 0.0,
        }
        return [finished]

    def force_emit(self):
        """Force emit current candle even if incomplete."""
        if not self._current:
            return None
        c = self._current
        self._current = None
        return c
