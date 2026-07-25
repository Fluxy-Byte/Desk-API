import { randomUUID } from "crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Router } from "express";
import { z } from "zod";
import { env } from "../../../config/env";
import { ValidationError } from "../../../domain/errors/app-error";
import { s3Client } from "../../../infrastructure/storage/s3-client";
import { requireAuth } from "../middlewares/require-auth";
import { routeHandler } from "../middlewares/route-handler";

export const uploadsRouter = Router();
uploadsRouter.use(requireAuth);

const presignSchema = z.object({
  fileName: z.string().trim().min(1),
  contentType: z.string().trim().min(1),
});

/// Fluxo de mídia (áudio/foto/documento): cliente pede uma URL assinada,
/// sobe o arquivo direto pro S3, e só então referencia essa URL em
/// POST /tickets/:id/messages (messageType + mediaUrl).
uploadsRouter.post(
  "/presign",
  routeHandler(async (req) => {
    const parsed = presignSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Informe fileName e contentType.");

    const key = `${env.SEAWEEDFS_S3_PREFIX}/tickets/${randomUUID()}-${parsed.data.fileName}`;

    const uploadUrl = await getSignedUrl(
      s3Client,
      new PutObjectCommand({ Bucket: env.SEAWEEDFS_S3_BUCKET, Key: key, ContentType: parsed.data.contentType }),
      { expiresIn: 300 },
    );

    const mediaUrl = `${env.SEAWEEDFS_S3_ENDPOINT}/${env.SEAWEEDFS_S3_BUCKET}/${key}`;

    return { uploadUrl, mediaUrl, key };
  }),
);
