import { Router } from "express";
import { z } from "zod";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../domain/errors/app-error";
import { dispatchCampaign } from "../../../infrastructure/campaign/dispatch-client";
import { prisma } from "../../../infrastructure/database/prisma/client";
import { requireAuth } from "../middlewares/require-auth";
import { routeHandler } from "../middlewares/route-handler";

export const dispatchRouter = Router();
dispatchRouter.use(requireAuth);

const templateParameterSchema = z.object({ type: z.string(), text: z.string() });

const dispatchSchema = z.object({
  queueId: z.string().trim().min(1),
  templateName: z.string().trim().min(1),
  templateHeaderText: z.string().optional(),
  templateBodyText: z.string().optional(),
  contact: z.object({
    phone: z.string().trim().min(8),
    name: z.string().trim().optional(),
    email: z.string().trim().email().optional(),
    parametersHeader: z.array(templateParameterSchema).optional(),
    parametersBody: z.array(templateParameterSchema).optional(),
  }),
});

/// Disparo ativo pelo Desk — sempre volta pro próprio atendente (idAttendant)
/// na fila que ele escolheu (idQueue), na mesma fila em que ele é membro.
/// Precisa do switch ServiceIsland.allowActiveDispatch ligado.
dispatchRouter.post(
  "/dispatch",
  routeHandler(async (req) => {
    const parsed = dispatchSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Dados inválidos.");

    const { userId, companyId } = req.auth!;

    const membership = await prisma.queueMember.findFirst({ where: { queueId: parsed.data.queueId, userId } });
    if (!membership) throw new ForbiddenError("Você não pertence a esta fila.");

    const queue = await prisma.queue.findFirst({
      where: { id: parsed.data.queueId },
      include: { serviceIsland: { include: { whatsappChannel: true } } },
    });
    if (!queue) throw new NotFoundError("Fila não encontrada.");
    if (!queue.serviceIsland.allowActiveDispatch) {
      throw new ForbiddenError("Disparo ativo pelo Desk não está habilitado para esta fila.");
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });

    const result = await dispatchCampaign({
      organizationId: companyId,
      whatsappChannelId: queue.serviceIsland.whatsappChannel.id,
      campaignName: `Disparo ativo — ${user?.name ?? "Atendente"} — ${new Date().toLocaleDateString("pt-BR")}`,
      templateName: parsed.data.templateName,
      idQueue: parsed.data.queueId,
      idAttendant: userId,
      createdByName: user?.name,
      skipTransferMessage: true,
      templateHeaderText: parsed.data.templateHeaderText,
      templateBodyText: parsed.data.templateBodyText,
      contacts: [
        {
          numberContact: parsed.data.contact.phone,
          nameContact: parsed.data.contact.name,
          emailContact: parsed.data.contact.email,
          parametersHeader: parsed.data.contact.parametersHeader,
          parametersBody: parsed.data.contact.parametersBody,
        },
      ],
    });

    return result;
  }),
);
