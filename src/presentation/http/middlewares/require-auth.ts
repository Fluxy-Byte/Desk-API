import type { NextFunction, Request, Response } from "express";
import { verifySessionToken } from "../../../infrastructure/auth/jwt";

export interface AuthedRequest extends Request {
  auth?: { userId: string; companyId: string };
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;

  if (!token) {
    res.status(401).json({ success: false, result: null, message: "Não autenticado." });
    return;
  }

  try {
    const payload = verifySessionToken(token);
    req.auth = { userId: payload.sub, companyId: payload.companyId };
    next();
  } catch {
    res.status(401).json({ success: false, result: null, message: "Sessão inválida ou expirada." });
  }
}
