import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(7079),

  DATABASE_URL: z.string().min(1),

  INTERNAL_API_KEY: z.string().min(1),
  AGENT_API_BASE_URL: z.string().min(1),

  // Tokens próprios do Desk-API — distintos do Better Auth do Agent-Api.
  // DESK_JWT_SECRET assina a sessão do atendente (~8h); DESK_REALTIME_JWT_SECRET
  // assina o token de handshake do WebSocket (vida curta, ~30s).
  DESK_JWT_SECRET: z.string().min(1),
  DESK_REALTIME_JWT_SECRET: z.string().min(1),

  /// CORS com wildcard "*" não funciona com credentials: "include" — precisa
  /// de lista explícita de origens do frontend.
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default("https://desk.fluxytechnologies.com.br,http://localhost:7080")
    .transform((value) => value.split(",").map((origin) => origin.trim())),

  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().min(1),

  RABBITMQ_URL: z.string().min(1),

  MONGO_URL: z.string().min(1),
  MONGO_DB_NAME: z.string().default("orquestrador"),

  SEAWEEDFS_S3_ENDPOINT: z.string().min(1),
  SEAWEEDFS_S3_ACCESS_KEY: z.string().min(1),
  SEAWEEDFS_S3_SECRET_KEY: z.string().min(1),
  SEAWEEDFS_S3_BUCKET: z.string().min(1),
  SEAWEEDFS_S3_REGION: z.string().default("us-east-1"),
  SEAWEEDFS_S3_PREFIX: z.string().default("fluxy-saas/desk-api"),

  APP_TIMEZONE: z.string().default("America/Sao_Paulo"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables");
}

export const env = parsed.data;
