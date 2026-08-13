import { Router } from "express";
import { NotFoundError, ValidationError } from "../../../domain/errors/app-error";
import { listWabaTemplates } from "../../../infrastructure/meta/meta-graph-client";
import { prisma } from "../../../infrastructure/database/prisma/client";
import { requireAuth } from "../middlewares/require-auth";
import { routeHandler } from "../middlewares/route-handler";

export const whatsappChannelsRouter = Router();
whatsappChannelsRouter.use(requireAuth);

/// Templates aprovados/cadastrados na Meta pro canal — usado no disparo ativo
/// pelo Desk pra escolher o template (mesmo formato que o Agent Console usa).
whatsappChannelsRouter.get(
  "/:id/templates",
  routeHandler(async (req) => {
    const channel = await prisma.whatsappChannel.findFirst({
      where: { id: String(req.params.id), organizationId: req.auth!.companyId },
    });
    if (!channel) throw new NotFoundError("WhatsApp Channel não encontrado.");
    if (!channel.metaAccessToken) {
      throw new ValidationError("Este canal ainda não tem um token de acesso da Meta cadastrado.");
    }

    const templates = await listWabaTemplates(channel.wabaId, channel.metaAccessToken);

    return templates
      .filter((t) => t.status === "APPROVED")
      .map((t) => ({
        name: t.name,
        language: t.language,
        category: t.category,
        headerText: t.components.find((c) => c.type === "HEADER")?.text ?? null,
        bodyText: t.components.find((c) => c.type === "BODY")?.text ?? null,
      }));
  }),
);
