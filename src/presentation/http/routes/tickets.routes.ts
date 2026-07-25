import { Router } from "express";
import { z } from "zod";
import { ticketService } from "../../../application/ticket/ticket-service";
import { ValidationError } from "../../../domain/errors/app-error";
import { requireAuth } from "../middlewares/require-auth";
import { routeHandler } from "../middlewares/route-handler";

export const ticketsRouter = Router();
ticketsRouter.use(requireAuth);

const sendMessageSchema = z.object({
  text: z.string(),
  messageType: z.enum(["TEXT", "AUDIO", "IMAGE", "DOCUMENT", "STICKER"]).optional(),
  mediaUrl: z.string().optional(),
});

ticketsRouter.get(
  "/",
  routeHandler(async (req) => {
    const status = req.query.status;
    if (status === "waiting") return ticketService.listWaiting(req.auth!.userId);
    if (status === "mine") return ticketService.listMine(req.auth!.userId);
    throw new ValidationError("Parâmetro status deve ser 'waiting' ou 'mine'.");
  }),
);

ticketsRouter.post(
  "/:id/pull",
  routeHandler(async (req) => ticketService.pull(String(req.params.id), req.auth!.userId)),
);

ticketsRouter.get(
  "/:id",
  routeHandler(async (req) => ticketService.getById(String(req.params.id), req.auth!.userId)),
);

ticketsRouter.post(
  "/:id/messages",
  routeHandler(async (req) => {
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Dados inválidos.");
    return ticketService.sendMessage(String(req.params.id), req.auth!.userId, parsed.data);
  }),
);

ticketsRouter.post(
  "/:id/close",
  routeHandler(async (req) => ticketService.close(String(req.params.id), req.auth!.userId)),
);

ticketsRouter.post(
  "/:id/transfer-queue",
  routeHandler(async (req) => {
    const parsed = z.object({ queueId: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Informe queueId.");
    return ticketService.transferQueue(String(req.params.id), req.auth!.userId, parsed.data.queueId);
  }),
);

ticketsRouter.post(
  "/:id/transfer-attendant",
  routeHandler(async (req) => {
    const parsed = z.object({ userId: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Informe userId.");
    return ticketService.transferAttendant(String(req.params.id), req.auth!.userId, parsed.data.userId);
  }),
);
