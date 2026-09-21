import { z } from "zod";

/**
 * Authentication validation schemas
 */

const passwordField = z
  .string()
  .min(8, "Пароль должен быть не короче 8 символов")
  .max(100, "Пароль не длиннее 100 символов")
  .regex(/[A-Z]/, "Пароль должен содержать заглавную букву")
  .regex(/[a-z]/, "Пароль должен содержать строчную букву")
  .regex(/[0-9]/, "Пароль должен содержать цифру");

export const signInSchema = z.object({
  email: z.string().email("Введите корректный email"),
  password: z.string().min(1, "Введите пароль"),
});

export const signUpSchema = z.object({
  email: z.string().email("Введите корректный email"),
  password: passwordField,
  name: z.string().min(1, "Введите имя").max(100, "Имя не длиннее 100 символов"),
});

export const resetPasswordSchema = z.object({
  email: z.string().email("Введите корректный email"),
});

const matchesConfirmation = (data: { newPassword: string; confirmPassword: string }) =>
  data.newPassword === data.confirmPassword;

const mismatchIssue = { message: "Пароли не совпадают", path: ["confirmPassword"] };

/** Changing a known password from settings: the old one is proof of identity. */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Введите текущий пароль"),
    newPassword: passwordField,
    confirmPassword: z.string().min(1, "Повторите новый пароль"),
  })
  .refine(matchesConfirmation, mismatchIssue);

/** Setting a password after a reset link: the link itself is the proof. */
export const newPasswordSchema = z
  .object({
    newPassword: passwordField,
    confirmPassword: z.string().min(1, "Повторите новый пароль"),
  })
  .refine(matchesConfirmation, mismatchIssue);

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type NewPasswordInput = z.infer<typeof newPasswordSchema>;
