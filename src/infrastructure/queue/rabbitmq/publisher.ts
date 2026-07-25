import type { Channel } from "amqplib";
import { assertQueueWithDlq } from "./connection";

export const QUEUE_OUTBOUND_MESSAGE_SEND = "outbound.message.send";
export const QUEUE_DESK_MESSAGE_OUTBOUND = "desk.message.outbound";

interface OutboundMessagePayload {
  target: unknown;
  whatsappChannel: unknown;
  messagingSession: unknown;
  answer: { text: string; audio: string; image: string };
  finishesProcessing: boolean;
  origin: "SYSTEM" | "ATTENDANT";
  ticketId?: string;
}

interface DeskMessageOutboundPayload {
  ticketId: string;
  text: string;
  attendantUserId: string;
  messageType?: "TEXT" | "AUDIO" | "IMAGE" | "DOCUMENT" | "STICKER";
  mediaUrl?: string;
}

async function publish(channel: Channel, queue: string, payload: object): Promise<void> {
  await assertQueueWithDlq(channel, queue);
  channel.sendToQueue(queue, Buffer.from(JSON.stringify(payload)), { persistent: true });
}

/// Usado só para mensagens de sistema (fechamento com closingMessage) — o
/// envio normal de um atendente vai por publishDeskMessageOutbound, que o
/// Desk-Worker intercepta antes de repassar pro Outbound-Worker.
export async function publishOutboundMessage(channel: Channel, payload: OutboundMessagePayload): Promise<void> {
  await publish(channel, QUEUE_OUTBOUND_MESSAGE_SEND, payload);
}

export async function publishDeskMessageOutbound(channel: Channel, payload: DeskMessageOutboundPayload): Promise<void> {
  await publish(channel, QUEUE_DESK_MESSAGE_OUTBOUND, payload);
}
