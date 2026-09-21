import { PutBucketPolicyCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../../config/env";

export const s3Client = new S3Client({
  endpoint: env.SEAWEEDFS_S3_ENDPOINT,
  region: env.SEAWEEDFS_S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.SEAWEEDFS_S3_ACCESS_KEY,
    secretAccessKey: env.SEAWEEDFS_S3_SECRET_KEY,
  },
});

/// A Meta baixa a mídia (image/audio/document) direto da URL logo depois de
/// aceitar o envio — sem leitura pública nesse prefixo, o download falha e a
/// mensagem volta com status "failed" (SeaweedFS não honra ACL por-objeto no
/// PutObject, só policy de bucket). Roda no boot, idempotente — se o bucket
/// for recriado ou a policy for resetada, a próxima subida do serviço já
/// reaplica sozinha.
///
/// A policy do bucket é única (PutBucketPolicy substitui a anterior), então
/// TODOS os prefixos públicos precisam estar aqui — ver
/// SEAWEEDFS_S3_PUBLIC_PREFIXES pros de outros serviços.
export async function ensurePublicMediaBucketPolicy(): Promise<void> {
  const publicPrefixes = [
    env.SEAWEEDFS_S3_PREFIX,
    ...env.SEAWEEDFS_S3_PUBLIC_PREFIXES.split(",")
      .map((prefix) => prefix.trim().replace(/\/+$/, ""))
      .filter(Boolean),
  ];

  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "PublicReadDeskMedia",
        Effect: "Allow",
        Principal: "*",
        Action: ["s3:GetObject"],
        Resource: publicPrefixes.map((prefix) => `arn:aws:s3:::${env.SEAWEEDFS_S3_BUCKET}/${prefix}/*`),
      },
    ],
  };

  try {
    await s3Client.send(new PutBucketPolicyCommand({ Bucket: env.SEAWEEDFS_S3_BUCKET, Policy: JSON.stringify(policy) }));
    console.log(`[DESK-MSG][s3] policy de leitura pública garantida para ${publicPrefixes.map((prefix) => `${env.SEAWEEDFS_S3_BUCKET}/${prefix}/*`).join(", ")}`);
  } catch (error) {
    console.error("[DESK-MSG][s3] falha ao garantir policy pública do bucket de mídia — anexos podem falhar ao enviar:", error);
  }
}
