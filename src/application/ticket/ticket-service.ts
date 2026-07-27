import { Prisma } from "../../../generated/prisma/client";
import { MESSAGES_COLLECTION, type MessageDocument } from "../../domain/contracts/message-document";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../domain/errors/app-error";
import { getMongoDb } from "../../infrastructure/database/mongo/client";
import { prisma } from "../../infrastructure/database/prisma/client";
import { publishDeskEvent } from "../../infrastructure/pubsub/desk-events";
import { getRabbitChannel } from "../../infrastructure/queue/rabbitmq/connection";
import { publishDeskMessageOutbound, publishMarkRead, publishOutboundMessage } from "../../infrastructure/queue/rabbitmq/publisher";

const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

async function listMyQueueIds(userId: string): Promise<string[]> {
  const memberships = await prisma.queueMember.findMany({ where: { userId }, select: { queueId: true } });
  return memberships.map((m) => m.queueId);
}

/// Última mensagem do CLIENTE na sessão — é ela que precisa ser marcada como
/// lida (a Cloud API só aceita marcar leitura de uma mensagem inbound).
async function getLastInboundExternalMessageId(messagingSessionId: string): Promise<string | null> {
  const db = await getMongoDb();
  const docs = await db
    .collection<MessageDocument>(MESSAGES_COLLECTION)
    .find({ messagingSessionId, direction: "INBOUND" })
    .sort({ createdAt: -1 })
    .limit(1)
    .toArray();
  return docs[0]?.externalMessageId ?? null;
}

async function notifyReadReceipt(ticketId: string, userId: string, typingIndicator: boolean) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { target: { include: { whatsappChannel: true } } },
  });
  if (!ticket) throw new NotFoundError("Ticket não encontrado.");
  if (ticket.assignedUserId !== userId) throw new ForbiddenError("Você não é o atendente responsável por este ticket.");

  const externalMessageId = await getLastInboundExternalMessageId(ticket.messagingSessionId);
  if (!externalMessageId) return { queued: false };

  const channel = await getRabbitChannel();
  await publishMarkRead(channel, {
    phoneNumberId: ticket.target.whatsappChannel.phoneNumberId,
    externalMessageId,
    typingIndicator,
  });

  return { queued: true };
}

export const ticketService = {
  async listWaiting(userId: string) {
    const queueIds = await listMyQueueIds(userId);
    if (queueIds.length === 0) return [];

    return prisma.ticket.findMany({
      where: { queueId: { in: queueIds }, status: "WAITING" },
      include: { queue: true, target: true },
      orderBy: { createdAt: "asc" },
    });
  },

  async listMine(userId: string) {
    return prisma.ticket.findMany({
      where: { assignedUserId: userId, status: "IN_PROGRESS" },
      include: { queue: true, target: true },
      orderBy: { updatedAt: "desc" },
    });
  },

  /// Claim atômico: só sucede se o ticket ainda estiver WAITING e sem
  /// atendente — updateMany com guarda no WHERE, count===0 é o sinal
  /// definitivo de corrida perdida (não um SELECT prévio).
  async pull(ticketId: string, userId: string) {
    const result = await prisma.ticket.updateMany({
      where: { id: ticketId, status: "WAITING", assignedUserId: null },
      data: { assignedUserId: userId, assignedAt: new Date(), status: "IN_PROGRESS" },
    });

    if (result.count === 0) {
      throw new ConflictError("Este ticket já foi puxado por outro atendente.", "TICKET_ALREADY_TAKEN");
    }

    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    await publishDeskEvent({ type: "ticket_updated", queueId: ticket.queueId, ticketId: ticket.id, payload: ticket });
    return ticket;
  },

  async getById(ticketId: string, userId: string) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { queue: true, target: true, messagingSession: true, messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!ticket) throw new NotFoundError("Ticket não encontrado.");
    if (ticket.assignedUserId !== userId) throw new ForbiddenError("Você não é o atendente responsável por este ticket.");

    const db = await getMongoDb();
    const history = await db
      .collection<MessageDocument>(MESSAGES_COLLECTION)
      .find({ messagingSessionId: ticket.messagingSessionId })
      .sort({ createdAt: 1 })
      .toArray();

    return { ...ticket, history };
  },

  async sendMessage(
    ticketId: string,
    userId: string,
    input: { text: string; messageType?: "TEXT" | "AUDIO" | "IMAGE" | "DOCUMENT" | "STICKER"; mediaUrl?: string },
  ) {
    console.log(`[DESK-MSG][ticket-service.sendMessage] início — ticketId=${ticketId} userId=${userId}`);

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { messagingSession: true },
    });
    if (!ticket) {
      console.error(`[DESK-MSG][ticket-service.sendMessage] ticket ${ticketId} não encontrado`);
      throw new NotFoundError("Ticket não encontrado.");
    }
    if (ticket.assignedUserId !== userId) {
      console.error(
        `[DESK-MSG][ticket-service.sendMessage] ticket ${ticketId} pertence a assignedUserId=${ticket.assignedUserId}, não a userId=${userId}`,
      );
      throw new ForbiddenError("Você não é o atendente responsável por este ticket.");
    }
    if (ticket.status !== "IN_PROGRESS") {
      console.error(`[DESK-MSG][ticket-service.sendMessage] ticket ${ticketId} com status=${ticket.status}, esperado IN_PROGRESS`);
      throw new ValidationError("Ticket não está em atendimento.");
    }

    // Regra das 24h: sempre calculada a partir da ÚLTIMA mensagem do cliente,
    // nunca armazenada como flag — ver MessagingSession no schema canônico.
    const elapsed = Date.now() - ticket.messagingSession.lastCustomerMessageAt.getTime();
    console.log(
      `[DESK-MSG][ticket-service.sendMessage] ticketId=${ticketId} janela 24h — elapsedMs=${elapsed} lastCustomerMessageAt=${ticket.messagingSession.lastCustomerMessageAt.toISOString()}`,
    );
    if (elapsed > SESSION_WINDOW_MS) {
      console.error(`[DESK-MSG][ticket-service.sendMessage] ticketId=${ticketId} janela de 24h expirada — mensagem NÃO será enviada`);
      throw new ConflictError(
        "A janela de atendimento de 24 horas foi encerrada. É necessário um disparo ativo com template aprovado pela Meta para reiniciar a conversa.",
        "SESSION_WINDOW_EXPIRED",
      );
    }

    console.log(`[DESK-MSG][ticket-service.sendMessage] ticketId=${ticketId} publicando em desk.message.outbound`);
    const channel = await getRabbitChannel();
    await publishDeskMessageOutbound(channel, {
      ticketId: ticket.id,
      text: input.text,
      attendantUserId: userId,
      messageType: input.messageType ?? "TEXT",
      mediaUrl: input.mediaUrl,
    });
    console.log(`[DESK-MSG][ticket-service.sendMessage] ticketId=${ticketId} publicado com sucesso em desk.message.outbound`);

    return { queued: true };
  },

  /// Chamado quando o atendente abre o ticket — marca a última mensagem do
  /// cliente como lida (tique azul) no WhatsApp dele.
  async markRead(ticketId: string, userId: string) {
    return notifyReadReceipt(ticketId, userId, false);
  },

  /// Chamado (com throttle no frontend) enquanto o atendente digita — liga o
  /// indicador "digitando..." no WhatsApp do cliente por ~25s.
  async notifyTyping(ticketId: string, userId: string) {
    return notifyReadReceipt(ticketId, userId, true);
  },

  async close(ticketId: string, userId: string) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { target: { include: { whatsappChannel: { include: { agent: true } } } }, messagingSession: true },
    });
    if (!ticket) throw new NotFoundError("Ticket não encontrado.");
    if (ticket.assignedUserId !== userId) throw new ForbiddenError("Você não é o atendente responsável por este ticket.");
    if (ticket.status === "CLOSED") throw new ValidationError("Ticket já está encerrado.");

    const updated = await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: "CLOSED", closedAt: new Date(), closeReason: "RESOLVED" },
    });

    // Devolve o contato pra IA — um ticket resolvido não deve deixar o target
    // preso em HUMAN pra sempre (mesmo padrão comprovado do sistema anterior).
    await prisma.target.update({ where: { id: ticket.targetId }, data: { status: "AI" } });

    const agent = ticket.target.whatsappChannel.agent;
    if (agent.closingEnabled && agent.closingMessage) {
      const channel = await getRabbitChannel();
      await publishOutboundMessage(channel, {
        target: ticket.target,
        whatsappChannel: ticket.target.whatsappChannel,
        messagingSession: ticket.messagingSession,
        answer: { text: agent.closingMessage, audio: "", image: "" },
        finishesProcessing: true,
        origin: "SYSTEM",
      });
    }

    await publishDeskEvent({ type: "ticket_updated", queueId: ticket.queueId, ticketId: ticket.id, payload: updated });
    return updated;
  },

  async transferQueue(ticketId: string, userId: string, newQueueId: string) {
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundError("Ticket não encontrado.");
    if (ticket.assignedUserId !== userId) throw new ForbiddenError("Você não é o atendente responsável por este ticket.");

    const newQueue = await prisma.queue.findUnique({ where: { id: newQueueId } });
    if (!newQueue) throw new ValidationError("Fila de destino inválida.");

    const newTicket = await transferTicket(ticket, {
      queueId: newQueueId,
      status: "WAITING",
      assignedUserId: null,
      assignedAt: null,
      closeReason: "TRANSFERRED_QUEUE",
    });

    await publishDeskEvent({ type: "ticket_new", queueId: newQueueId, ticketId: newTicket.id, payload: newTicket });
    return newTicket;
  },

  async transferAttendant(ticketId: string, userId: string, newUserId: string) {
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundError("Ticket não encontrado.");
    if (ticket.assignedUserId !== userId) throw new ForbiddenError("Você não é o atendente responsável por este ticket.");

    const member = await prisma.queueMember.findUnique({
      where: { queueId_userId: { queueId: ticket.queueId, userId: newUserId } },
    });
    if (!member) throw new ValidationError("O novo atendente não faz parte desta fila.");

    const newTicket = await transferTicket(ticket, {
      queueId: ticket.queueId,
      status: "IN_PROGRESS",
      assignedUserId: newUserId,
      assignedAt: new Date(),
      closeReason: "TRANSFERRED_AGENT",
    });

    // Notifica o novo responsável (a sala aparece na lista "meus tickets" dele)
    // e a fila antiga (pra sumir da visão de quem não é mais responsável).
    await publishDeskEvent({ type: "ticket_updated", queueId: ticket.queueId, ticketId: newTicket.id, payload: newTicket });
    return newTicket;
  },

  async updateTargetContact(userId: string, targetId: string, input: { name?: string; email?: string; metadata?: Record<string, unknown> }) {
    void userId; // reservado para auditoria futura
    const target = await prisma.target.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundError("Contato não encontrado.");

    const mergedMetadata = input.metadata ? { ...((target.metadata as object) ?? {}), ...input.metadata } : target.metadata;

    return prisma.target.update({
      where: { id: target.id },
      data: {
        name: input.name ?? target.name,
        email: input.email ?? target.email,
        metadata: mergedMetadata as object,
      },
    });
  },
};

interface TransferData {
  queueId: string;
  status: "WAITING" | "IN_PROGRESS";
  assignedUserId: string | null;
  assignedAt: Date | null;
  closeReason: "TRANSFERRED_QUEUE" | "TRANSFERRED_AGENT";
}

/// Fecha o ticket atual e cria um novo — nunca faz update in-place do
/// queueId/assignedUserId (regra exata do escopo: "encerra o ticket atual e
/// coloca novamente..."). O índice único parcial (uq_ticket_open_per_session)
/// é satisfeito porque o CLOSE do ticket antigo acontece antes do INSERT do
/// novo, na mesma transação — mas ainda protegido contra corrida (P2002).
async function transferTicket(
  oldTicket: { id: string; organizationId: string; targetId: string; messagingSessionId: string },
  data: TransferData,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.ticket.update({
        where: { id: oldTicket.id },
        data: { status: "CLOSED", closedAt: new Date(), closeReason: data.closeReason },
      });

      const counter = await tx.ticketCounter.upsert({
        where: { organizationId: oldTicket.organizationId },
        create: { organizationId: oldTicket.organizationId, lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
      });

      return tx.ticket.create({
        data: {
          organizationId: oldTicket.organizationId,
          queueId: data.queueId,
          targetId: oldTicket.targetId,
          messagingSessionId: oldTicket.messagingSessionId,
          ticketNumber: counter.lastNumber,
          status: data.status,
          assignedUserId: data.assignedUserId,
          assignedAt: data.assignedAt,
          transferredFromTicketId: oldTicket.id,
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictError("Já existe um ticket aberto para esta sessão.", "TICKET_ALREADY_OPEN");
    }
    throw error;
  }
}
