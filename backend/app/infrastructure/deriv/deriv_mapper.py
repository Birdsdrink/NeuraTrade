from ...domain.entities.candle import Candle as DomainCandle
from .models import CandleModel


def map_candle_model_to_domain(cm: CandleModel) -> DomainCandle:
    return DomainCandle(
        timestamp=cm.timestamp,
        open=cm.open,
        high=cm.high,
        low=cm.low,
        close=cm.close,
        volume=cm.volume,
    )
