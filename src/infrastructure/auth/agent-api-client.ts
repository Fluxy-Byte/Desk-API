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
