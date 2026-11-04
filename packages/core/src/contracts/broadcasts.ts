import { z } from 'zod';
import { uuidSchema } from './common';

/**
 * Messages to the store's customers on WhatsApp (03 › الألبسة: رسائل للزبائن): «وصلت التشكيلة
 * الشتوية»، «تنزيلات 30٪». Sent through the store's message gateway (the one that sends the codes),
 * one at a time with a pause so the number is not taken for spam; a customer marked «لا يريد
 * رسائل» never gets one, and each message says how to stop them.
 *
 *   POST /v1/broadcasts/preview   customers.manage   { audience } → { count }
 *   POST /v1/broadcasts           customers.manage   broadcastInput → Broadcast (201)
 *   GET  /v1/broadcasts           customers.manage   → { items: Broadcast[] }
 */

export const broadcastAudienceSchema = z.discriminatedUnion('kind', [
  /** Every customer with a phone */
  z.object({ kind: z.literal('all') }),
  /** Those who bought from a department (and its sub-categories) */
  z.object({ kind: z.literal('category'), categoryId: uuidSchema }),
  /** Those who bought in the last `days` days */
  z.object({ kind: z.literal('recent'), days: z.int().min(1).max(365) }),
]);
export type BroadcastAudience = z.infer<typeof broadcastAudienceSchema>;

export const MAX_BROADCAST_RECIPIENTS = 2000;

export const broadcastPreviewInput = z.object({ audience: broadcastAudienceSchema });

export const broadcastInput = z.object({
  text: z.string().trim().min(5, 'اكتب الرسالة').max(700, 'الرسالة طويلة'),
  audience: broadcastAudienceSchema,
});
export type BroadcastInput = z.input<typeof broadcastInput>;

export interface Broadcast {
  id: string;
  text: string;
  audience: BroadcastAudience;
  /** sending, or done once every recipient was tried */
  status: 'sending' | 'done';
  total: number;
  sent: number;
  failed: number;
  createdAt: string;
  finishedAt: string | null;
}

/** What closes every message: how a customer stops them */
export const BROADCAST_FOOTER = 'لا تريد رسائلنا؟ أخبرنا ونوقفها.';
