/**
 * WebSocket broadcaster for real-time document change events.
 *
 * Maintains a set of connected WebSocket clients and broadcasts
 * typed events when document mutations occur.
 */

import type { WSContext } from "hono/ws";

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

/** Minimal WSContext-like shape we track – avoids coupling to Hono internals. */
interface ManagedClient {
  send: (data: string) => void;
  readyState: number;
  close: (code?: number, reason?: string) => void;
}

const clients = new Set<ManagedClient>();

/** Register a newly-connected client. Returns an unsubscribe function. */
export function registerWsClient(ws: WSContext | ManagedClient): () => void {
  const client: ManagedClient = {
    send: (data: string) => ws.send(data),
    readyState: ws.readyState,
    close: (code?: number, reason?: string) => ws.close(code, reason),
  };
  clients.add(client);
  return () => {
    clients.delete(client);
  };
}

/** Broadcast a typed event to all connected clients. */
export function broadcastWsEvent(event: WsEvent): void {
  const payload = JSON.stringify(event);
  let liveCount = 0;
  for (const client of clients) {
    // 1 = OPEN (WebSocket.OPEN)
    if (client.readyState === 1) {
      try {
        client.send(payload);
        liveCount++;
      } catch {
        // Client may have disconnected between the check and send
        clients.delete(client);
      }
    } else {
      // Prune stale clients
      clients.delete(client);
    }
  }
  if (liveCount > 0) {
    console.log(`[ws] Broadcast ${event.type} for ${event.document_id} to ${liveCount} client(s)`);
  }
}

/** Helper to create a broadcast event with the current timestamp. */
export function wsEvent(
  type: WsEventType,
  documentId: string,
  detail?: Record<string, unknown>,
): WsEvent {
  return {
    type,
    document_id: documentId,
    timestamp: new Date().toISOString(),
    ...(detail ? { detail } : {}),
  };
}

/** Return current connected client count (useful for health/debug). */
export function wsClientCount(): number {
  return clients.size;
}
