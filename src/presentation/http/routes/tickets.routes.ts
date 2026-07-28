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

const closeTicketSchema = z.object({
  closeTagId: z.string().trim().min(1).optional(),
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
    console.log(
      `[DESK-MSG] HTTP POST /tickets/${req.params.id}/messages recebido — userId=${req.auth!.userId} messageType=${parsed.data.messageType ?? "TEXT"} textLen=${parsed.data.text.length}`,
    );
    const result = await ticketService.sendMessage(String(req.params.id), req.auth!.userId, parsed.data);
    console.log(`[DESK-MSG] HTTP POST /tickets/${req.params.id}/messages concluído — result=${JSON.stringify(result)}`);
    return result;
  }),
);

ticketsRouter.post(
  "/:id/read",
  routeHandler(async (req) => ticketService.markRead(String(req.params.id), req.auth!.userId)),
);

ticketsRouter.post(
  "/:id/typing",
  routeHandler(async (req) => ticketService.notifyTyping(String(req.params.id), req.auth!.userId)),
);

ticketsRouter.get(
  "/:id/close-tags",
  routeHandler(async (req) => ticketService.getCloseTags(String(req.params.id), req.auth!.userId)),
);

ticketsRouter.post(
  "/:id/close",
  routeHandler(async (req) => {
    const parsed = closeTicketSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Dados inválidos.");
    return ticketService.close(String(req.params.id), req.auth!.userId, parsed.data.closeTagId);
  }),
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
