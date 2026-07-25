import type { Response } from "express";
import { AppError } from "../../../domain/errors/app-error";
import type { AuthedRequest } from "./require-auth";

type Handler = (req: AuthedRequest, res: Response) => Promise<unknown>;

/// Envelope {success,result,message} + tratamento de erro uniforme — usado
/// depois de requireAuth em toda rota autenticada.
export function routeHandler(handler: Handler) {
  return async (req: AuthedRequest, res: Response) => {
    try {
      const result = await handler(req, res);
      if (res.headersSent) return;
      res.json({ success: true, result, message: null });
    } catch (error) {
      if (error instanceof AppError) {
        res
          .status(error.statusCode)
          .json({ success: false, result: error.code ? { code: error.code } : null, message: error.message });
        return;
      }
      console.error("Erro não tratado:", error);
      res.status(500).json({ success: false, result: null, message: "Erro interno do servidor." });
    }
  };
}
