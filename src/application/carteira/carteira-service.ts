import { ForbiddenError, NotFoundError, ValidationError } from "../../domain/errors/app-error";
import { prisma } from "../../infrastructure/database/prisma/client";

/// O atendente só mexe nas carteiras da ilha do ticket que ele está
/// atendendo, e só se a ilha liberou (ServiceIsland.allowAttendantCarteira —
/// switch em Configurações Gerais no Agent Console).
async function loadTicketForCarteira(ticketId: string, userId: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      targetId: true,
      assignedUserId: true,
      queue: { select: { serviceIslandId: true, serviceIsland: { select: { allowAttendantCarteira: true } } } },
    },
  });
  if (!ticket) throw new NotFoundError("Ticket não encontrado.");
  if (ticket.assignedUserId !== userId) throw new ForbiddenError("Você não é o atendente responsável por este ticket.");
  if (!ticket.queue.serviceIsland.allowAttendantCarteira) {
    throw new ForbiddenError("Esta ilha não permite que atendentes adicionem clientes a carteiras.");
  }
  return ticket;
}

async function listIslandCarteiras(serviceIslandId: string, targetId: string) {
  const carteiras = await prisma.carteira.findMany({
    where: { queue: { serviceIslandId, deletedAt: null } },
    select: { id: true, name: true, targetIds: true, queue: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return carteiras.map(({ targetIds, ...carteira }) => ({ ...carteira, checked: targetIds.includes(targetId) }));
}

export const carteiraService = {
  async listForTicket(ticketId: string, userId: string) {
    const ticket = await loadTicketForCarteira(ticketId, userId);
    return listIslandCarteiras(ticket.queue.serviceIslandId, ticket.targetId);
  },

  /// carteiraIds é a lista completa (das carteiras desta ilha) em que o
  /// contato deve ficar — carteiras de outras ilhas não são tocadas.
  async setForTicket(ticketId: string, userId: string, carteiraIds: string[]) {
    const ticket = await loadTicketForCarteira(ticketId, userId);
    const targetId = ticket.targetId;
    const carteiras = await listIslandCarteiras(ticket.queue.serviceIslandId, targetId);

    const validIds = new Set(carteiras.map((c) => c.id));
    if (carteiraIds.some((id) => !validIds.has(id))) {
      throw new ValidationError("Uma ou mais carteiras selecionadas são inválidas.");
    }

    const wanted = new Set(carteiraIds);
    const toAdd = carteiras.filter((c) => wanted.has(c.id) && !c.checked).map((c) => c.id);
    const toRemove = carteiras.filter((c) => !wanted.has(c.id) && c.checked).map((c) => c.id);

    // Mesmo SQL do Agent-Api/carteira-service.ts#setForTarget: altera o array
    // no banco em vez de sobrescrever, sem perder alteração concorrente.
    await prisma.$transaction([
      ...(toAdd.length > 0
        ? [
            prisma.$executeRaw`
              UPDATE "Carteira" SET "targetIds" = array_append("targetIds", ${targetId}), "updatedAt" = now()
              WHERE id = ANY(${toAdd}::text[]) AND NOT (${targetId} = ANY("targetIds"))
            `,
          ]
        : []),
      ...(toRemove.length > 0
        ? [
            prisma.$executeRaw`
              UPDATE "Carteira" SET "targetIds" = array_remove("targetIds", ${targetId}), "updatedAt" = now()
              WHERE id = ANY(${toRemove}::text[])
            `,
          ]
        : []),
    ]);

    return listIslandCarteiras(ticket.queue.serviceIslandId, targetId);
  },
};
