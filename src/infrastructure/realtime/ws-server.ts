import type { Server } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { verifyRealtimeToken } from "../auth/jwt";
import { prisma } from "../database/prisma/client";
import { publishDeskEvent } from "../pubsub/desk-events";

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

/// ONLINE/OFFLINE são sempre automáticos, amarrados a ter (ou não) pelo menos
/// uma conexão WebSocket aberta — nunca mexe no status se já for o que
/// estamos tentando setar (evita update+publish à toa a cada nova aba).
async function setAutomaticStatus(
  organizationId: string,
  userId: string,
  status: "ONLINE" | "OFFLINE",
): Promise<void> {
  const member = await prisma.member.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
  if (!member || member.status === status) return;

  await prisma.member.update({
    where: { id: member.id },
    data: { status, statusUpdatedAt: new Date() },
  });

  await publishDeskEvent({
    type: "attendant_status_changed",
    userId,
    payload: { userId, status },
  });
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
        const isFirstConnection = !connectionsByUser.get(meta.userId)?.size;
        metaByConnection.set(ws, meta);
        addConnection(meta.userId, ws);
        if (isFirstConnection) {
          setAutomaticStatus(meta.companyId, meta.userId, "ONLINE").catch((err) =>
            console.error("Falha ao marcar atendente como online:", err),
          );
        }
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
      if (meta) {
        removeConnection(meta.userId, ws);
        if (!connectionsByUser.get(meta.userId)?.size) {
          setAutomaticStatus(meta.companyId, meta.userId, "OFFLINE").catch((err) =>
            console.error("Falha ao marcar atendente como offline:", err),
          );
        }
      }
    });

    ws.send(JSON.stringify({ type: "connected" }));
  });

  return wss;
}
