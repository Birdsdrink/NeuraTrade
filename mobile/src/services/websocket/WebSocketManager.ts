class WebSocketManager {
  private ws?: WebSocket;
  private url: string;
  private subscribers: Map<string, Set<(data: any) => void>> = new Map();
  private reconnectTimeout = 2000;

  constructor(url: string) {
    this.url = url;
  }

  connect() {
    if (this.ws) return;
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log('WS connected');
      this.reconnectTimeout = 2000;
    };

    this.ws.onmessage = (ev) => {
      // dispatch to topic subscribers
      let payload: any = ev.data;
      try {
        payload = JSON.parse(ev.data as string);
      } catch (e) {
        // keep raw
      }
      // assume payload contains a symbol or topic field
      const topic = payload?.symbol || payload?.topic || 'default';
      const set = this.subscribers.get(topic) || new Set();
      set.forEach((s) => s(payload));
    };

    this.ws.onclose = () => {
      console.log('WS closed');
      this.ws = undefined;
      // attempt reconnect
      setTimeout(() => this.connect(), this.reconnectTimeout);
      this.reconnectTimeout = Math.min(60000, this.reconnectTimeout * 2);
    };

    this.ws.onerror = (e) => {
      console.warn('WS error', e);
    };
  }

  disconnect() {
    if (!this.ws) return;
    this.ws.close();
    this.ws = undefined;
  }

  send(data: any) {
    if (!this.ws) return;
    this.ws.send(JSON.stringify(data));
  }

  subscribe(topic: string, fn: (data: any) => void) {
    if (!this.subscribers.has(topic)) this.subscribers.set(topic, new Set());
    this.subscribers.get(topic)!.add(fn);
    return () => this.subscribers.get(topic)!.delete(fn);
  }
}

const defaultUrl = (process.env.REACT_APP_WS_URL as string) || 'ws://localhost:8000/api/ws/market';
export default new WebSocketManager(defaultUrl);
