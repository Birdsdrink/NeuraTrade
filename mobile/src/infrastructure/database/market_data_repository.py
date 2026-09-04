import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime

Base = declarative_base()


class CandleRow(Base):
    __tablename__ = 'candles'
    id = sa.Column(sa.Integer, primary_key=True)
    symbol = sa.Column(sa.String, index=True)
    timeframe = sa.Column(sa.Integer, index=True)
    timestamp = sa.Column(sa.DateTime, index=True)
    open = sa.Column(sa.Float)
    high = sa.Column(sa.Float)
    low = sa.Column(sa.Float)
    close = sa.Column(sa.Float)
    volume = sa.Column(sa.Float)


class MarketDataRepository:
    def __init__(self, database_url: str):
        self.engine = create_async_engine(database_url, echo=False)
        self.async_session = sessionmaker(self.engine, expire_on_commit=False, class_=AsyncSession)

    async def init_models(self):
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    async def save_candles(self, candles):
        async with self.async_session() as s:
            async with s.begin():
                for c in candles:
                    row = CandleRow(symbol=c.symbol, timeframe=c.timeframe, timestamp=c.timestamp, open=c.open, high=c.high, low=c.low, close=c.close, volume=c.volume)
                    s.add(row)

    async def get_latest_candle(self, symbol: str, timeframe: int):
        async with self.async_session() as s:
            q = sa.select(CandleRow).where(CandleRow.symbol == symbol).where(CandleRow.timeframe == timeframe).order_by(CandleRow.timestamp.desc()).limit(1)
            res = await s.execute(q)
            return res.scalars().first()
