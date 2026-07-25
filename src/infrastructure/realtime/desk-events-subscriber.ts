import { redisSubscriber } from "../cache/redis/subscriber-client";
import { prisma } from "../database/prisma/client";
import { sendToUser } from "./ws-server";

const DESK_EVENTS_CHANNEL = "desk:events";

interface DeskEvent {
  type: "ticket_new" | "ticket_message" | "ticket_updated";
  queueId?: string;
  ticketId?: string;
  payload: unknown;
}

async function sendToQueue(queueId: string, payload: unknown): Promise<void> {
  const members = await prisma.queueMember.findMany({ where: { queueId }, select: { userId: true } });
  for (const member of members) sendToUser(member.userId, payload);
}

/// Assina o canal que TANTO o Desk-Worker (novo ticket/mensagem inbound)
/// QUANTO este próprio serviço (transferências/fechamento) publicam, e
/// repassa por WebSocket. Ticket sem atendente (WAITING) vai pra fila
/// inteira; ticket já atribuído vai só pro responsável.
export function startDeskEventsSubscriber(): void {
  redisSubscriber.subscribe(DESK_EVENTS_CHANNEL, (err) => {
    if (err) console.error("Falha ao assinar desk:events:", err);
  });

  redisSubscriber.on("message", (channel, raw) => {
    if (channel !== DESK_EVENTS_CHANNEL) return;

    void (async () => {
      try {
        const event = JSON.parse(raw) as DeskEvent;

        let assignedUserId: string | null = null;
        if (event.ticketId) {
          const ticket = await prisma.ticket.findUnique({
            where: { id: event.ticketId },
            select: { assignedUserId: true },
          });
          assignedUserId = ticket?.assignedUserId ?? null;
        }

        if (assignedUserId) {
          sendToUser(assignedUserId, event);
        } else if (event.queueId) {
          await sendToQueue(event.queueId, event);
        }
      } catch (err) {
        console.error("Erro processando evento de desk:events:", err);
      }
    })();
  });

  console.log("Assinando eventos em tempo real do canal desk:events.");
}
