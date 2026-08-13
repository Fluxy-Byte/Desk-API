import { Router } from "express";
import { z } from "zod";
import { ticketService } from "../../../application/ticket/ticket-service";
import { ValidationError } from "../../../domain/errors/app-error";
import { prisma } from "../../../infrastructure/database/prisma/client";
import { requireAuth } from "../middlewares/require-auth";
import { routeHandler } from "../middlewares/route-handler";

export const targetsRouter = Router();
targetsRouter.use(requireAuth);

const updateTargetSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const searchTargetsQuerySchema = z.object({
  whatsappChannelId: z.string().trim().min(1),
  q: z.string().trim().min(1).optional(),
});

/// Contatos do canal, sem ticket aberto (WAITING/IN_PROGRESS) no momento —
/// usado no disparo ativo pelo Desk pra escolher um contato já conhecido.
targetsRouter.get(
  "/search",
  routeHandler(async (req) => {
    const parsed = searchTargetsQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new ValidationError("Parâmetros inválidos.");

    return prisma.target.findMany({
      where: {
        organizationId: req.auth!.companyId,
        whatsappChannelId: parsed.data.whatsappChannelId,
        tickets: { none: { status: { not: "CLOSED" } } },
        ...(parsed.data.q
          ? { OR: [{ name: { contains: parsed.data.q, mode: "insensitive" } }, { waId: { contains: parsed.data.q } }] }
          : {}),
      },
      select: { id: true, name: true, waId: true, email: true },
      orderBy: { lastInteractionAt: "desc" },
      take: 20,
    });
  }),
);

/// Desk Console é quem tem permissão de EDITAR contato/metadados (Agent
/// Console só visualiza) — "Atualizar dados do contato, adicionar novos dados
/// no metadado usando key:value".
targetsRouter.patch(
  "/:id",
  routeHandler(async (req) => {
    const parsed = updateTargetSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Dados inválidos.");
    return ticketService.updateTargetContact(req.auth!.userId, String(req.params.id), parsed.data);
  }),
);
