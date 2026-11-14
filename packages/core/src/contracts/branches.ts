import { z } from 'zod';
import { contactPhoneSchema } from './auth';

/**
 * The store's branches «الفروع» (settings.manage). A branch is never deleted: it is stopped, and
 * what was sold there stays. The plan's branch limit counts the active ones.
 *
 *   GET   /v1/branches              BranchAdminRow[]
 *   POST  /v1/branches              branchInput → BranchAdminRow
 *   PATCH /v1/branches/{id}         branchInput → BranchAdminRow
 *   POST  /v1/branches/{id}/active  { active } → BranchAdminRow
 */
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const branchInput = z.object({
  name: z.string('اسم الفرع مطلوب').trim().min(2, 'اكتب اسم الفرع').max(60, 'الاسم طويل'),
  address: optionalText(200, 'العنوان طويل'),
  phone: contactPhoneSchema,
});
export type BranchInput = z.output<typeof branchInput>;

export const branchActiveInput = z.object({ active: z.boolean('حدّد التشغيل أو الإيقاف') });

export interface BranchAdminRow {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  /** Active devices paired to the branch */
  deviceCount: number;
  /** Active staff whose role is limited to this branch */
  staffCount: number;
}
