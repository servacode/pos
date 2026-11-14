import { z } from 'zod';
import { passwordSchema, phoneSchema } from './auth';
import { uuidSchema } from './common';
import { staffPinSchema } from './staff';
import type { Permission } from '../permissions';

/**
 * Managing the store's staff «الموظفون» (needs `users.manage`; the owner's by default).
 *
 *   GET   /v1/staff                  StaffListResponse (people, the roles to pick from, the branches)
 *   POST  /v1/staff                  staffCreateInput → 201 StaffMember
 *   PATCH /v1/staff/:id              staffUpdateInput → StaffMember
 *   POST  /v1/staff/:id/pin          staffPinInput → 204 (a new till PIN; the person's old one stops working)
 *   POST  /v1/staff/:id/deactivate   → StaffMember (sessions ended, no till sign-in)
 *   POST  /v1/staff/:id/reactivate   → StaffMember
 *
 * Roles are the store's own role rows (owner, manager, cashier; `owner` is never given here).
 * `branchIds: null` means every branch. A person with a phone and a password also signs in to the
 * admin panel; one with only a PIN signs in on the till. The owner cannot be changed, demoted or
 * deactivated here, and nobody can give a role holding a permission they lack themselves.
 */

const fullName = z.string('الاسم مطلوب').trim().min(2, 'الاسم حرفان على الأقل').max(80, 'الاسم طويل جداً');
/** «نسبة العمولة» of a seller in basis points of the net sales (250 = 2.5%); reports only */
const commissionBp = z
  .int('اكتب نسبة صحيحة')
  .min(0, 'النسبة من 0 إلى 100')
  .max(10_000, 'النسبة من 0 إلى 100');
const branchIds = z.array(uuidSchema).min(1, 'اختر فرعاً واحداً على الأقل').max(200).nullable();

export const staffCreateInput = z
  .object({
    fullName,
    /** Optional; needed with `password` (the login for the admin panel) */
    phone: phoneSchema.optional(),
    /** Gives the person a login to the admin panel */
    password: passwordSchema.optional(),
    roleKey: z.string('اختر الدور').trim().min(1, 'اختر الدور').max(40),
    branchIds,
    pin: staffPinSchema,
    commissionBp: commissionBp.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.password && !v.phone) {
      ctx.addIssue({ code: 'custom', path: ['phone'], message: 'رقم الجوال مطلوب لدخول لوحة الإدارة' });
    }
  });
export type StaffCreateInput = z.input<typeof staffCreateInput>;
export type StaffCreateData = z.output<typeof staffCreateInput>;

export const staffUpdateInput = z
  .object({
    fullName: fullName.optional(),
    phone: phoneSchema.nullable().optional(),
    /** Sets a new admin-panel password */
    password: passwordSchema.optional(),
    roleKey: z.string().trim().min(1).max(40).optional(),
    branchIds: branchIds.optional(),
    /** Needed when the new role asks for a 6-digit PIN and the person has a 4-digit one */
    pin: staffPinSchema.optional(),
    commissionBp: commissionBp.nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'لا تغيير لحفظه');
export type StaffUpdateInput = z.input<typeof staffUpdateInput>;
export type StaffUpdateData = z.output<typeof staffUpdateInput>;

/**
 *   POST /v1/staff/pin-check   { pin, exceptId? } → { sharedWith } (users.manage)
 * Who else has this till code, so the owner is warned (not stopped) before two people share one.
 */
export const staffPinCheckInput = z.object({
  pin: z.string().regex(/^\d{4,6}$/, 'رمز الدخول 4 أو 6 أرقام'),
  exceptId: z.uuid().optional(),
});
export interface StaffPinCheck {
  /** The names of the active staff who already use this code */
  sharedWith: string[];
}

export const staffPinInput = z.object({ pin: staffPinSchema });
export type StaffPinInput = z.input<typeof staffPinInput>;
export type StaffPinData = z.output<typeof staffPinInput>;

export interface StaffRoleOption {
  key: string;
  name: string;
  permissions: Permission[];
  /** The PIN length the role asks for: 6 for owners, managers and approvers */
  pinLength: 4 | 6;
  /** False for roles the caller may not give (the owner's, or one holding a permission they lack) */
  assignable: boolean;
}

export interface StaffMember {
  id: string;
  fullName: string;
  phone: string | null;
  status: 'active' | 'disabled';
  isOwner: boolean;
  roleKey: string;
  roleName: string;
  /** null = every branch */
  branchIds: string[] | null;
  /** True when a PIN is set, i.e. the person can sign in on the till */
  hasPin: boolean;
  pinLength: 4 | 6 | null;
  /** True when the person can sign in to the admin panel */
  hasLogin: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  /** «نسبة العمولة» in basis points; null: none set */
  commissionBp: number | null;
}

export interface StaffListResponse {
  staff: StaffMember[];
  roles: StaffRoleOption[];
  branches: { id: string; name: string }[];
}
