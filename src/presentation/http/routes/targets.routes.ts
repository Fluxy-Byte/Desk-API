import { Router } from "express";
import { z } from "zod";
import { ticketService } from "../../../application/ticket/ticket-service";
import { ValidationError } from "../../../domain/errors/app-error";
import { requireAuth } from "../middlewares/require-auth";
import { routeHandler } from "../middlewares/route-handler";

export const targetsRouter = Router();
targetsRouter.use(requireAuth);

const updateTargetSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

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
