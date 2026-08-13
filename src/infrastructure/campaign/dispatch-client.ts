import { env } from "../../config/env";
import { UpstreamError } from "../../domain/errors/app-error";

export interface DispatchCampaignContact {
  numberContact: string;
  nameContact?: string;
  emailContact?: string;
}

export interface DispatchCampaignPayload {
  organizationId: string;
  whatsappChannelId: string;
  campaignName: string;
  templateName: string;
  idQueue: string;
  idAttendant: string;
  createdByName?: string;
  skipTransferMessage?: boolean;
  contacts: DispatchCampaignContact[];
}

/// Disparo ativo pelo Desk — mesmo contrato interno usado pela API externa
/// (Fluxy-Agents-Api/src/infrastructure/agent-api/agent-api-client.ts).
/// idQueue/idAttendant sempre vêm do próprio atendente que está disparando —
/// é assim que o ticket criado volta pra ele (ver Agent-Api campaignService.dispatch).
export async function dispatchCampaign(payload: DispatchCampaignPayload): Promise<unknown> {
  const response = await fetch(`${env.AGENT_API_BASE_URL}/internal/campaigns/dispatch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-api-key": env.INTERNAL_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new UpstreamError((body as { message?: string } | null)?.message ?? "Falha ao disparar a campanha.");
  }

  return (body as { result?: unknown } | null)?.result ?? null;
}
