import { z } from 'zod';

/**
 * Currency / rate schemas share a common "money" shape: non-negative, up to
 * 2 decimals, capped high enough to represent monthly executive salaries
 * without overflow but low enough to catch fat-fingered zeros.
 */
const moneyPositiveOrNull = z
  .number()
  .nonnegative('Nilai tidak boleh negatif')
  .max(999_999_999_999, 'Nilai terlalu besar')
  .refine((n) => Math.round(n * 100) === n * 100, {
    message: 'Maksimum 2 angka di belakang koma',
  })
  .nullable();

const multiplierSchema = z
  .number()
  .min(1, 'Multiplier minimum 1× (tidak boleh mengurangi upah)')
  .max(10, 'Multiplier maksimum 10×')
  .refine((n) => Math.round(n * 100) === n * 100, {
    message: 'Maksimum 2 angka di belakang koma',
  });

const maxHoursSchema = z
  .number()
  .positive('Maksimum jam harus lebih dari 0')
  .max(24, 'Maksimum jam tidak boleh lebih dari 24')
  .refine((n) => Math.round(n * 100) === n * 100, {
    message: 'Maksimum 2 angka di belakang koma',
  });

const submitWindowSchema = z
  .number()
  .int('Jendela pengajuan harus bilangan bulat')
  .min(1, 'Jendela pengajuan minimal 1 hari')
  .max(365, 'Jendela pengajuan maksimal 365 hari');

const graceDaysSchema = z
  .number()
  .int('Grace period harus bilangan bulat')
  .min(0, 'Grace period minimum 0 hari')
  .max(30, 'Grace period maksimum 30 hari');

const payrollLockedUntilSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus dalam format YYYY-MM-DD')
  .nullable();

/**
 * Company configuration snapshot. Server-authoritative — the `slug` is
 * intentionally NOT included since it doubles as a tenant identifier in
 * URLs and must not be mutable via the admin UI. The client displays it
 * read-only.
 */
export const companyConfigSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  slug: z.string(),
  timezone: z.string().min(1),
  overtimeHourlyRate: moneyPositiveOrNull,
  overtimeWeekdayMultiplier: z.number().positive(),
  overtimeWeekendMultiplier: z.number().positive(),
  overtimeHolidayMultiplier: z.number().positive(),
  overtimeMaxHoursPerDay: z.number().positive(),
  overtimeSubmitWindowDays: z.number().int().positive(),
  overtimeCompleteGraceDays: z.number().int().nonnegative(),
  /**
   * Inclusive payroll cutoff (YYYY-MM-DD). null = no cutoff. Attendance
   * mutations at or before this date are refused for HR; SUPER_ADMIN
   * retains an emergency override. See ADR-0010.
   */
  payrollLockedUntil: payrollLockedUntilSchema,
});
export type CompanyConfig = z.infer<typeof companyConfigSchema>;

/**
 * All fields are optional — this is a PATCH input. Omitting a field means
 * "don't change". Passing `null` on `overtimeHourlyRate` explicitly clears
 * the base rate (forces per-user overrides).
 */
export const companyConfigUpdateInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Nama perusahaan wajib diisi')
      .max(120, 'Nama perusahaan maksimum 120 karakter')
      .optional(),
    timezone: z
      .string()
      .trim()
      .min(1, 'Timezone wajib diisi')
      .max(64, 'Timezone maksimum 64 karakter')
      .optional(),
    overtimeHourlyRate: moneyPositiveOrNull.optional(),
    overtimeWeekdayMultiplier: multiplierSchema.optional(),
    overtimeWeekendMultiplier: multiplierSchema.optional(),
    overtimeHolidayMultiplier: multiplierSchema.optional(),
    overtimeMaxHoursPerDay: maxHoursSchema.optional(),
    overtimeSubmitWindowDays: submitWindowSchema.optional(),
    overtimeCompleteGraceDays: graceDaysSchema.optional(),
    payrollLockedUntil: payrollLockedUntilSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Setidaknya satu field harus diisi',
  });
export type CompanyConfigUpdateInput = z.infer<typeof companyConfigUpdateInputSchema>;
