import jwt from "jsonwebtoken";
import { env } from "../../config/env";

export interface SessionTokenPayload {
  sub: string; // userId
  companyId: string;
  typ: "session";
}

export interface RealtimeTokenPayload {
  sub: string;
  companyId: string;
  typ: "realtime";
}

/// Sessão do atendente: dura uma jornada de trabalho (8h) — token guardado em
/// memória no Desk-Console, não em cookie (origens diferentes do Agent-Api).
export function signSessionToken(userId: string, companyId: string): string {
  return jwt.sign({ sub: userId, companyId, typ: "session" } satisfies SessionTokenPayload, env.DESK_JWT_SECRET, {
    expiresIn: "8h",
  });
}

/// Token efêmero só pra autenticar o handshake do WebSocket — curto de
/// propósito, pra não expor a sessão de 8h numa query string.
export function signRealtimeToken(userId: string, companyId: string): string {
  return jwt.sign(
    { sub: userId, companyId, typ: "realtime" } satisfies RealtimeTokenPayload,
    env.DESK_REALTIME_JWT_SECRET,
    { expiresIn: "30s" },
  );
}

export function verifySessionToken(token: string): SessionTokenPayload {
  const payload = jwt.verify(token, env.DESK_JWT_SECRET) as SessionTokenPayload;
  if (payload.typ !== "session") throw new Error("Tipo de token inválido");
  return payload;
}

export function verifyRealtimeToken(token: string): RealtimeTokenPayload {
  const payload = jwt.verify(token, env.DESK_REALTIME_JWT_SECRET) as RealtimeTokenPayload;
  if (payload.typ !== "realtime") throw new Error("Tipo de token inválido");
  return payload;
}
