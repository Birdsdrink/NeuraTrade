import { useEffect } from 'react';
import WebSocketManager from '../services/websocket/WebSocketManager';

export function useWebSocket(onMessage: (data: any) => void) {
  useEffect(() => {
    WebSocketManager.connect();
    const unsub = WebSocketManager.subscribe('default', onMessage);
    return () => {
      unsub();
      // keep connection open globally; do not disconnect here
    };
  }, [onMessage]);
}
