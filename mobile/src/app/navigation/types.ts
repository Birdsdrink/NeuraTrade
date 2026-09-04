import { RouteName } from '../../constants/routes';

export type RootStackParamList = {
  Markets: undefined;
  MarketDetail: { symbol?: string } | undefined;
  AIAnalysis: { symbol?: string } | undefined;
  Watchlist: undefined;
  Settings: undefined;
};
