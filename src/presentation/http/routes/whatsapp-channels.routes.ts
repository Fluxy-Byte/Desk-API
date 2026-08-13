import { Router } from "express";
import { NotFoundError, ValidationError } from "../../../domain/errors/app-error";
import { getTemplateVariableCount, listWabaTemplates } from "../../../infrastructure/meta/meta-graph-client";
import { prisma } from "../../../infrastructure/database/prisma/client";
import { requireAuth } from "../middlewares/require-auth";
import { routeHandler } from "../middlewares/route-handler";

export const whatsappChannelsRouter = Router();
whatsappChannelsRouter.use(requireAuth);

/// Templates aprovados cadastrados na Meta pro canal — usado no disparo ativo
/// pelo Desk pra escolher o template. Mesmo shape de `GET /api/wc/:id/templates`
/// do Agent-Api (id/name/category/language/status/components/variableCount),
/// pra a tela de disparo do Desk poder reaproveitar o mesmo preview/lógica de
/// variáveis da tela "Nova campanha" do Agent Console.
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
        id: t.id,
        name: t.name,
        category: t.category,
        language: t.language,
        status: t.status,
        components: t.components,
        variableCount: getTemplateVariableCount(t.components),
      }));
  }),
);
