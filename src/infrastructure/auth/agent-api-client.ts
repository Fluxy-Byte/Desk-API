import { env } from "../../config/env";

/// Delega a verificação de email/senha pro Better Auth que já roda no
/// Agent-Api — este serviço nunca vê nem guarda hash de senha, só confirma se
/// a credencial é válida e pega os dados básicos do usuário. A sessão do
/// Better Auth (cookie) criada nessa chamada é descartada; a partir daqui o
/// Desk-API usa seu próprio JWT (ver infrastructure/auth/jwt.ts).
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<{ id: string; name: string; email: string } | null> {
  const response = await fetch(`${env.AGENT_API_BASE_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Better Auth do Agent-Api valida trustedOrigins mesmo em chamadas
      // servidor-a-servidor — precisa de uma origem cadastrada em
      // CORS_ALLOWED_ORIGINS lá. Usamos a primeira origem da nossa própria
      // lista (a do Desk-Console), que já é mantida em sincronia com a lista
      // do Agent-Api nos três .env deste serviço.
      Origin: env.CORS_ALLOWED_ORIGINS[0],
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) return null;

  const body = (await response.json().catch(() => null)) as {
    user?: { id: string; name: string; email: string };
  } | null;

  if (!body?.user?.id) return null;

  return body.user;
}

/// Dispara o e-mail de redefinição de senha do Better Auth do Agent-Api —
/// mesma conta/hash de senha usada pelo login acima. `redirectTo` precisa
/// estar na lista de trustedOrigins do Agent-Api (CORS_ALLOWED_ORIGINS de
/// lá já inclui as origens de produção/dev do Desk-Console).
export async function requestPasswordReset(email: string, redirectTo: string): Promise<void> {
  const response = await fetch(`${env.AGENT_API_BASE_URL}/api/auth/request-password-reset`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: env.CORS_ALLOWED_ORIGINS[0],
    },
    body: JSON.stringify({ email, redirectTo }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? "Não foi possível solicitar a redefinição de senha.");
  }
}

/// Confirma a redefinição (token do link recebido por e-mail + nova senha) —
/// atualiza a mesma conta/hash usada pelo Agent-Api e por este login.
export async function resetPassword(newPassword: string, token: string): Promise<void> {
  const response = await fetch(`${env.AGENT_API_BASE_URL}/api/auth/reset-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: env.CORS_ALLOWED_ORIGINS[0],
    },
    body: JSON.stringify({ newPassword, token }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? "Não foi possível redefinir a senha. O link pode ter expirado.");
  }
}
