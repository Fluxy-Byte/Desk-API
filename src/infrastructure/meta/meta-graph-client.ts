import { env } from "../../config/env";
import { UpstreamError } from "../../domain/errors/app-error";

export interface MetaTemplateComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: string;
  text?: string;
  buttons?: { type: string; text: string }[];
}

export interface MetaTemplate {
  id: string;
  name: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  language: string;
  status: string;
  components: MetaTemplateComponent[];
}

interface MetaTemplatesResponse {
  data: MetaTemplate[];
}

interface MetaErrorResponse {
  error?: { message?: string };
}

/// Conta quantas variáveis {{1}}, {{2}}... existem em um texto de componente —
/// usado pra saber quantos campos de preenchimento mostrar por contato no
/// disparo ativo pelo Desk. Mesma função de Agent-Api/meta-graph-client.ts.
function countVariables(text?: string): number {
  if (!text) return 0;
  const matches = text.match(/\{\{\d+\}\}/g);
  return matches ? new Set(matches).size : 0;
}

export function getTemplateVariableCount(components: MetaTemplateComponent[]): { header: number; body: number } {
  const header = components.find((c) => c.type === "HEADER");
  const body = components.find((c) => c.type === "BODY");
  return {
    header: countVariables(header?.text),
    body: countVariables(body?.text),
  };
}

/// Lista os templates de mensagem cadastrados no WABA — mesma chamada usada
/// em Agent-Api/Campaign-Worker/Fluxy-Agents-Api, duplicada aqui porque cada
/// serviço do monorepo tem sua própria cópia do client da Meta.
export async function listWabaTemplates(wabaId: string, accessToken: string): Promise<MetaTemplate[]> {
  const url = `https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${wabaId}/message_templates`;

  const response = await fetch(`${url}?access_token=${encodeURIComponent(accessToken)}`);
  const body = (await response.json()) as MetaTemplatesResponse & MetaErrorResponse;

  if (!response.ok) {
    throw new UpstreamError(body.error?.message ?? "Falha ao consultar os templates do WABA na Meta.");
  }

  return body.data ?? [];
}
