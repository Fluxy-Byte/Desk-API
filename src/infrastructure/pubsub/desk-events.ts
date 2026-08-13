import { redis } from "../cache/redis/client";

export type DeskEventType = "ticket_new" | "ticket_message" | "ticket_updated" | "attendant_status_changed";

interface DeskEvent {
  type: DeskEventType;
  queueId?: string;
  ticketId?: string;
  /// Só usado por attendant_status_changed — repassado direto pra esse
  /// usuário (útil pra sincronizar múltiplas abas do mesmo atendente), sem
  /// passar pela resolução de ticket/fila do subscriber.
  userId?: string;
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
