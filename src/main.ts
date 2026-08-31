import { createServer } from "http";
import cors from "cors";
import express from "express";
import { env } from "./config/env";
import { redis } from "./infrastructure/cache/redis/client";
import { pingMongo } from "./infrastructure/database/mongo/client";
import { prisma } from "./infrastructure/database/prisma/client";
import { startDeskEventsSubscriber } from "./infrastructure/realtime/desk-events-subscriber";
import { startWsServer } from "./infrastructure/realtime/ws-server";
import { getRabbitChannel } from "./infrastructure/queue/rabbitmq/connection";
import { ensurePublicMediaBucketPolicy } from "./infrastructure/storage/s3-client";
import { authRouter } from "./presentation/http/routes/auth.routes";
import { dispatchRouter } from "./presentation/http/routes/dispatch.routes";
import { queuesRouter } from "./presentation/http/routes/queues.routes";
import { targetsRouter } from "./presentation/http/routes/targets.routes";
import { ticketsRouter } from "./presentation/http/routes/tickets.routes";
import { uploadsRouter } from "./presentation/http/routes/uploads.routes";
import { whatsappChannelsRouter } from "./presentation/http/routes/whatsapp-channels.routes";

/// Presença (Member.status) só existe em memória enquanto o processo está de
/// pé — connectionsByUser (ws-server.ts) nasce vazio a cada boot. Se o
/// processo cair/reiniciar (deploy, crash, OOM) com atendentes conectados, o
/// evento de close do WebSocket deles nunca roda, e o banco fica com ONLINE
/// preso pra sempre (nenhum mecanismo detecta isso depois, já que o
/// heartbeat também é só em memória). Corrigido zerando toda presença ONLINE
/// no boot: nesse ponto ainda não existe nenhuma conexão WebSocket real, já
/// que startWsServer só é chamado depois — qualquer ONLINE aqui é lixo de
/// uma execução anterior.
async function reconcileStaleOnlineStatus(): Promise<void> {
  const { count } = await prisma.member.updateMany({
    where: { status: "ONLINE" },
    data: { status: "OFFLINE", statusUpdatedAt: new Date() },
  });
  if (count > 0) {
    console.log(`Desk-API boot: ${count} atendente(s) com presença ONLINE zerada (processo reiniciou).`);
  }
}

async function main() {
  await prisma.$connect();
  await reconcileStaleOnlineStatus();
  await getRabbitChannel();
  await ensurePublicMediaBucketPolicy();

  const app = express();
  app.use(
    cors({
      origin: env.CORS_ALLOWED_ORIGINS,
      credentials: true,
    }),
  );
  app.use(express.json());

  app.use("/", authRouter);
  app.use("/", dispatchRouter);
  app.use("/queues", queuesRouter);
  app.use("/tickets", ticketsRouter);
  app.use("/targets", targetsRouter);
  app.use("/uploads", uploadsRouter);
  app.use("/whatsapp-channels", whatsappChannelsRouter);

  app.get("/health", async (_req, res) => {
    const [dbOk, redisOk, mongoOk] = await Promise.all([
      prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      redis.ping().then(() => true).catch(() => false),
      pingMongo(),
    ]);

    res.json({ status: "ok", service: "desk-api", db: dbOk, redis: redisOk, mongo: mongoOk });
  });

  const server = createServer(app);
  startWsServer(server);
  startDeskEventsSubscriber();

  server.listen(env.PORT, () => {
    console.log(`Desk-API listening on port ${env.PORT}`);
  });
}

main().catch((error) => {
  console.error("Fatal error during Desk-API bootstrap:", error);
  process.exit(1);
});
