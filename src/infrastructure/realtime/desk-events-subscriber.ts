import { redisSubscriber } from "../cache/redis/subscriber-client";
import { prisma } from "../database/prisma/client";
import { sendToUser } from "./ws-server";

const DESK_EVENTS_CHANNEL = "desk:events";

interface DeskEvent {
  type: "ticket_new" | "ticket_message" | "ticket_updated" | "message_status";
  queueId?: string;
  ticketId?: string;
  messagingSessionId?: string;
  payload: unknown;
}

async function sendToQueue(queueId: string, payload: unknown): Promise<void> {
  const members = await prisma.queueMember.findMany({ where: { queueId }, select: { userId: true } });
  for (const member of members) sendToUser(member.userId, payload);
}

/// Assina o canal que Desk-Worker (novo ticket/mensagem inbound), este
/// próprio serviço (transferências/fechamento) e o Notification-Worker
/// (status de entrega/leitura da Meta) publicam, e repassa por WebSocket.
/// Ticket sem atendente (WAITING) vai pra fila inteira; ticket já atribuído
/// vai só pro responsável. Notification-Worker não conhece Ticket (bounded
/// context diferente) — manda messagingSessionId, e é aqui que resolvemos
/// pro ticket aberto mais recente daquela sessão, anexando ticketId ao
/// payload repassado pra o frontend não precisar tratar dois formatos.
export function startDeskEventsSubscriber(): void {
  redisSubscriber.subscribe(DESK_EVENTS_CHANNEL, (err) => {
    if (err) console.error("Falha ao assinar desk:events:", err);
  });

  redisSubscriber.on("message", (channel, raw) => {
    if (channel !== DESK_EVENTS_CHANNEL) return;

    void (async () => {
      try {
        const event = JSON.parse(raw) as DeskEvent;

        let ticket: { id: string; assignedUserId: string | null; queueId: string } | null = null;

        if (event.ticketId) {
          ticket = await prisma.ticket.findUnique({
            where: { id: event.ticketId },
            select: { id: true, assignedUserId: true, queueId: true },
          });
        } else if (event.messagingSessionId) {
          ticket = await prisma.ticket.findFirst({
            where: { messagingSessionId: event.messagingSessionId },
            orderBy: { createdAt: "desc" },
            select: { id: true, assignedUserId: true, queueId: true },
          });
        }

        const outgoing = ticket ? { ...event, ticketId: ticket.id } : event;

        if (ticket?.assignedUserId) {
          sendToUser(ticket.assignedUserId, outgoing);
        } else if (event.queueId ?? ticket?.queueId) {
          await sendToQueue((event.queueId ?? ticket?.queueId)!, outgoing);
        }
      } catch (err) {
        console.error("Erro processando evento de desk:events:", err);
      }
    })();
  });

  console.log("Assinando eventos em tempo real do canal desk:events.");
}
