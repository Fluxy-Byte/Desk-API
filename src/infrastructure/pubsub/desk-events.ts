import { redis } from "../cache/redis/client";

export type DeskEventType = "ticket_new" | "ticket_message" | "ticket_updated";

interface DeskEvent {
  type: DeskEventType;
  queueId?: string;
  ticketId?: string;
  payload: unknown;
}

const DESK_EVENTS_CHANNEL = "desk:events";

/// Mesmo canal que o Desk-Worker publica — Desk-API publica aqui também
/// quando É ELE (não o Desk-Worker) quem muda o estado de um ticket
/// diretamente (transferências, fechamento), e assina o mesmo canal pra
/// repassar por WebSocket (ver infrastructure/realtime/desk-events-subscriber.ts).
export async function publishDeskEvent(event: DeskEvent): Promise<void> {
  await redis.publish(DESK_EVENTS_CHANNEL, JSON.stringify(event));
}
