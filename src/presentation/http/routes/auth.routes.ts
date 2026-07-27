import { Router } from "express";
import { env } from "../../../config/env";
import { requestPasswordReset, resetPassword, verifyCredentials } from "../../../infrastructure/auth/agent-api-client";
import { signRealtimeToken, signSessionToken } from "../../../infrastructure/auth/jwt";
import { prisma } from "../../../infrastructure/database/prisma/client";
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";

export const authRouter = Router();

authRouter.post("/auth/forgot-password", async (req, res) => {
  const { email } = req.body ?? {};
  if (!email) {
    res.status(400).json({ success: false, result: null, message: "Informe o e-mail." });
    return;
  }

  try {
    await requestPasswordReset(email, `${env.CORS_ALLOWED_ORIGINS[0]}/reset-password`);
    res.json({ success: true, result: null, message: "Se este e-mail existir, você vai receber o link de redefinição." });
  } catch (err) {
    res.status(502).json({ success: false, result: null, message: err instanceof Error ? err.message : "Erro ao solicitar redefinição." });
  }
});

authRouter.post("/auth/reset-password", async (req, res) => {
  const { newPassword, token } = req.body ?? {};
  if (!newPassword || !token) {
    res.status(400).json({ success: false, result: null, message: "Informe a nova senha e o token." });
    return;
  }

  try {
    await resetPassword(newPassword, token);
    res.json({ success: true, result: null, message: "Senha redefinida com sucesso." });
  } catch (err) {
    res.status(400).json({ success: false, result: null, message: err instanceof Error ? err.message : "Não foi possível redefinir a senha." });
  }
});

authRouter.post("/auth/login", async (req, res) => {
  const { email, password, companyId } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ success: false, result: null, message: "Informe email e senha." });
    return;
  }

  const user = await verifyCredentials(email, password);
  if (!user) {
    res.status(401).json({ success: false, result: null, message: "Credenciais inválidas." });
    return;
  }

  const memberships = await prisma.member.findMany({ where: { userId: user.id } });
  if (memberships.length === 0) {
    res.status(403).json({ success: false, result: null, message: "Usuário sem empresa vinculada." });
    return;
  }

  let resolvedCompanyId = companyId as string | undefined;

  if (!resolvedCompanyId) {
    if (memberships.length > 1) {
      const organizations = await prisma.organization.findMany({
        where: { id: { in: memberships.map((m) => m.organizationId) } },
        select: { id: true, name: true },
      });
      res.json({
        success: true,
        result: { needsCompanySelection: true, companies: organizations },
        message: "Selecione a empresa.",
      });
      return;
    }
    resolvedCompanyId = memberships[0].organizationId;
  }

  const membership = memberships.find((m) => m.organizationId === resolvedCompanyId);
  if (!membership) {
    res.status(403).json({ success: false, result: null, message: "Usuário não pertence a esta empresa." });
    return;
  }

  const token = signSessionToken(user.id, resolvedCompanyId);
  res.json({
    success: true,
    result: { token, user: { id: user.id, name: user.name, email: user.email }, companyId: resolvedCompanyId },
    message: "Login realizado.",
  });
});

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const { userId, companyId } = req.auth!;

  const [user, queueMemberships] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true } }),
    prisma.queueMember.findMany({ where: { userId }, select: { queueId: true } }),
  ]);

  res.json({
    success: true,
    result: { user, companyId, queueIds: queueMemberships.map((m) => m.queueId) },
    message: null,
  });
});

authRouter.get("/realtime-token", requireAuth, async (req: AuthedRequest, res) => {
  const { userId, companyId } = req.auth!;
  res.json({ success: true, result: { token: signRealtimeToken(userId, companyId) }, message: null });
});
