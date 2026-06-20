import { useEffect, useRef, useState, useCallback } from "react";

export type WsEventType =
  | "document_updated"
  | "document_created"
  | "document_deleted"
  | "document_reindexed"
  | "revision_added";

export interface WsEvent {
  type: WsEventType;
  document_id: string;
  timestamp: string;
  detail?: Record<string, unknown>;
}

type WsListener = (event: WsEvent) => void;

/**
 * React hook for WebSocket real-time updates.
 *
 * Connects to the /ws endpoint, reconnects with exponential backoff,
 * and provides a subscribe method for TanStack Query invalidation.
 */
export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Map<string, Set<WsListener>>>(new Map());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnectDelayRef = useRef<number>(1000);

  const getWsUrl = useCallback((): string => {
    const loc = window.location;
    const proto = loc.protocol === "https:" ? "wss:" : "ws:";
    // In production (Caddy proxy), /ws is relative to the API base
    const base = import.meta.env.VITE_OPENBRAIN_API_URL?.replace(/\/$/, "") ?? "";
    if (base) {
      // Strip the http(s) protocol and replace with ws(s)
      const wsBase = base.replace(/^https?:/, proto);
      return `${wsBase}/ws`;
    }
    return `${proto}//${loc.host}/web/api/ws`;
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const url = getWsUrl();
    const ws = new WebSocket(url);

    ws.onopen = () => {
      setConnected(true);
      reconnectDelayRef.current = 1000; // reset backoff
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      // Reconnect with exponential backoff (1s → 30s cap)
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(delay * 2, 30000);
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      // onclose will fire after onerror, which handles reconnect
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as WsEvent;
        // Notify all listeners for this event type
        const typeListeners = listenersRef.current.get(data.type);
        if (typeListeners) {
          for (const listener of typeListeners) {
            listener(data);
          }
        }
        // Also notify wildcard listeners
        const wildcards = listenersRef.current.get("*");
        if (wildcards) {
          for (const listener of wildcards) {
            listener(data);
          }
        }
      } catch {
        // Ignore non-JSON messages (pong, etc.)
      }
    };

    wsRef.current = ws;
  }, [getWsUrl]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const subscribe = useCallback(
    (eventType: WsEventType | "*", listener: WsListener) => {
      if (!listenersRef.current.has(eventType)) {
        listenersRef.current.set(eventType, new Set());
      }
      listenersRef.current.get(eventType)!.add(listener);
      return () => {
        listenersRef.current.get(eventType)?.delete(listener);
      };
    },
    []
  );

  return { connected, subscribe };
}