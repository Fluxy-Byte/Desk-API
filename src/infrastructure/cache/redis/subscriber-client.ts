import Redis from "ioredis";
import { env } from "../../../config/env";

/// Conexão dedicada para subscribe — o Redis proíbe misturar modo subscribe
/// com outros comandos na mesma conexão (o client.ts principal continua livre
/// para publish/outros comandos).
export const redisSubscriber = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
});
