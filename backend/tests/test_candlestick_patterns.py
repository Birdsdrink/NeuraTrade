import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.infrastructure.ai.vision_service import _detect_candlestick_patterns


def test_detects_bullish_engulfing_pattern():
    candles = [
        {"open": 104, "high": 105, "low": 100, "close": 101},
        {"open": 101, "high": 102, "low": 99, "close": 100.5},
        {"open": 100.5, "high": 108, "low": 99.8, "close": 107},
        {"open": 107.2, "high": 108.1, "low": 106.2, "close": 107.6},
        {"open": 107.6, "high": 108.5, "low": 106.8, "close": 108.1},
    ]

    patterns = _detect_candlestick_patterns(candles)

    assert any("Bullish Engulfing" in pattern for pattern in patterns)


def test_detects_bearish_engulfing_pattern():
    candles = [
        {"open": 98, "high": 101, "low": 97, "close": 100.5},
        {"open": 100.8, "high": 102, "low": 99.9, "close": 101.4},
        {"open": 101.3, "high": 101.9, "low": 95.5, "close": 96.2},
        {"open": 96.4, "high": 98.7, "low": 95.1, "close": 97.1},
        {"open": 97.2, "high": 98.3, "low": 95.4, "close": 96.8},
    ]

    patterns = _detect_candlestick_patterns(candles)

    assert any("Bearish Engulfing" in pattern for pattern in patterns)
