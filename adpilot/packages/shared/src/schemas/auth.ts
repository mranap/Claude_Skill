import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 10;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: 'Enter a valid email address' }));

/** Password policy: length ≥ 10, at least one letter and one digit, no leading/trailing spaces. */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(200)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Use letters and at least one digit')
  .refine((v) => v.trim() === v, 'Password cannot start or end with a space');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^(\d{6}|[A-Za-z0-9]{4}-[A-Za-z0-9]{4})$/, 'Enter the 6-digit code or a recovery code');

export const mfaVerifySchema = z.object({
  ticket: z.string().min(10).max(2000),
  code: totpCodeSchema,
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const changeEmailSchema = z.object({
  newEmail: emailSchema,
  password: z.string().min(1).max(200),
});

export const confirmEmailSchema = z.object({ token: z.string().min(20).max(200) });

export const enable2faSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
export const disable2faSchema = z.object({ password: z.string().min(1).max(200), code: totpCodeSchema });

export const updateProfileSchema = z.object({
  name: z.string().trim().max(100).nullable().optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
});

export interface AuthUserDto {
  id: string;
  email: string;
  name: string | null;
  role: string;
  permissions: string[];
  timezone: string;
  twoFactorEnabled: boolean;
  mustChangePassword: boolean;
  isAdmin: boolean;
}

export type LoginResponse = { status: 'OK'; user: AuthUserDto } | { status: 'MFA_REQUIRED'; ticket: string };
