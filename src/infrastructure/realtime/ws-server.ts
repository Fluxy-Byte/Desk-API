import type { Server } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { verifyRealtimeToken } from "../auth/jwt";

interface ConnectionMeta {
  userId: string;
  companyId: string;
}

const connectionsByUser = new Map<string, Set<WebSocket>>();
const metaByConnection = new WeakMap<WebSocket, ConnectionMeta>();

function addConnection(userId: string, ws: WebSocket): void {
  if (!connectionsByUser.has(userId)) connectionsByUser.set(userId, new Set());
  connectionsByUser.get(userId)!.add(ws);
}

function removeConnection(userId: string, ws: WebSocket): void {
  const set = connectionsByUser.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) connectionsByUser.delete(userId);
}

export function sendToUser(userId: string, payload: unknown): void {
  const set = connectionsByUser.get(userId);
  if (!set || set.size === 0) return;
  const message = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) ws.send(message);
  }
}

/// Handshake: o token vem por query string (?token=...) porque o WebSocket do
/// browser não permite header Authorization customizado — por isso é um token
/// à parte, curto (30s), nunca a sessão de 8h inteira.
export function startWsServer(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/ws")) return;

    const url = new URL(req.url, "http://internal");
    const token = url.searchParams.get("token");

    if (!token) {
      socket.destroy();
      return;
    }

    try {
      const payload = verifyRealtimeToken(token);
      wss.handleUpgrade(req, socket, head, (ws) => {
        const meta: ConnectionMeta = { userId: payload.sub, companyId: payload.companyId };
        metaByConnection.set(ws, meta);
        addConnection(meta.userId, ws);
        wss.emit("connection", ws, req);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on("connection", (ws: WebSocket) => {
    const meta = metaByConnection.get(ws);
    let alive = true;

    ws.on("pong", () => {
      alive = true;
    });

    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, 30_000);

    ws.on("close", () => {
      clearInterval(heartbeat);
      if (meta) removeConnection(meta.userId, ws);
    });

    ws.send(JSON.stringify({ type: "connected" }));
  });

  return wss;
}
