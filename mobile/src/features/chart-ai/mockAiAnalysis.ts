export interface AiInsight {
  key: string;
  label: string;
  value: string;
}

export interface AiBreakdownItem {
  title: string;
  content: string;
}

export interface AiAnalysis {
  score: number;
  status: string;
  riskLevel: string;
  confidenceLevel: string;
  insights: {
    trend: string;
    momentum: string;
    liq_bias: string;
    sentiment: string;
  };
  gamePlan: string;
  riskManagement: {
    rrRatio: string;
    stopLoss: string;
    positionSize: string;
  };
  tradePlan: {
    action: string;
    whenToBuy: string;
    whenToSell: string;
    whenToExit: string;
    stopLoss: string;
    rrRatio: string;
    positionSize: string;
  };
  multiTimeframe: {
    weekly: string;
    daily: string;
    h4: string;
    h1: string;
  };
  smc: {
    fvg: string;
    bullishOb: string;
    bearishOb: string;
    buySideLiq: string;
    sellSideLiq: string;
  };
  breakdown: AiBreakdownItem[];
}

export const mockAiAnalysis: AiAnalysis = {
  score: 65,
  status: 'NEUTRAL/BEARISH RETRACEMENT',
  riskLevel: 'Medium',
  confidenceLevel: 'Medium',
  insights: {
    trend: 'Bearish',
    momentum: 'Declining',
    liq_bias: 'Sell-side',
    sentiment: 'Cautionary',
  },
  gamePlan:
    'Wait for a retest of the broken moving average dynamic support. If it fails to hold, look for short entries targeting 4860.00 with SL above 4878.00.',
  riskManagement: {
    rrRatio: '1:2',
    stopLoss: 'Above 4878.00',
    positionSize: 'Conservative',
  },
  tradePlan: {
    action: 'SELL',
    whenToBuy: 'No long setup — wait for a retest above 4880.00.',
    whenToSell: 'On rejection of 4878.00, enter short near 4870.00.',
    whenToExit: 'Target 1 at 4860.00, target 2 at 4855.00, close if price reclaims 4880.00.',
    stopLoss: 'Above 4878.00',
    rrRatio: '1:2',
    positionSize: 'Conservative',
  },
  multiTimeframe: {
    weekly: 'Bullish',
    daily: 'Bullish',
    h4: 'Overextended',
    h1: 'Correction',
  },
  smc: {
    fvg: 'potential opening',
    bullishOb: 'Located at 4855.00',
    bearishOb: 'Forming at 4878.00',
    buySideLiq: 'Above 4880.00',
    sellSideLiq: 'Below 4860.00',
  },
  breakdown: [
    {
      title: 'Trend Analysis',
      content:
        'The Volatility 10 Index is currently undergoing a short-term bearish correction on the M5 timeframe after hitting a local peak near 4880. The price has crossed below the short-term moving average, indicating a shift in momentum.',
    },
    {
      title: 'Support & Resistance Levels',
      content:
        'Immediate support sits at 4860.00, with stronger demand near 4855.00. Resistance is capped at 4878.00, and a clean break above 4880.00 would invalidate the bearish retracement thesis.',
    },
    {
      title: 'Volume Analysis',
      content:
        'Sell-side volume has been expanding on the push lower, while rebounds are on declining volume — consistent with a corrective move rather than a full trend reversal.',
    },
    {
      title: 'Candlestick Patterns',
      content:
        'A bearish engulfing candle printed at the 4880.00 high, followed by lower highs. No strong reversal pattern yet; watch for a bullish hammer at the 4860.00 support.',
    },
    {
      title: 'Momentum Indicators',
      content:
        'RSI has slid from overbought territory toward the midline, and MACD is rolling over with a widening bearish histogram — momentum favors sellers on the M5 chart.',
    },
  ],
};
