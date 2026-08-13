import { Router } from "express";
import { prisma } from "../../../infrastructure/database/prisma/client";
import { requireAuth } from "../middlewares/require-auth";
import { routeHandler } from "../middlewares/route-handler";

export const queuesRouter = Router();
queuesRouter.use(requireAuth);

queuesRouter.get(
  "/",
  routeHandler(async (req) => {
    const memberships = await prisma.queueMember.findMany({
      where: { userId: req.auth!.userId },
      include: {
        queue: {
          include: {
            members: { include: { user: true } },
            serviceIsland: { select: { id: true, allowActiveDispatch: true, whatsappChannelId: true } },
          },
        },
      },
    });
    return memberships.map((m) => m.queue);
  }),
);
