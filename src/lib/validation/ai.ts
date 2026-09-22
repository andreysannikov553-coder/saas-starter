import { z } from "zod";
import { ALLOWED_MODELS } from "@/lib/ai/models";

/**
 * AI generation validation schemas
 */

/**
 * The model is caller-supplied, so it is constrained to the allow-list rather
 * than accepted as a free string.
 */
const modelField = z.enum(ALLOWED_MODELS).optional();

export const generateContentSchema = z.object({
  prompt: z.string().min(1, "Введите запрос").max(5000, "Запрос не длиннее 5000 символов"),
  model: modelField,
  maxTokens: z.number().int().min(1).max(4000).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

export const generateCodeSchema = z.object({
  task: z.string().min(1, "Опишите задачу").max(2000),
  language: z.string().min(1, "Укажите язык").max(50),
  context: z.string().max(3000).optional(),
  model: modelField,
});

export const summarizeSchema = z.object({
  content: z.string().min(1, "Добавьте текст").max(10000),
  maxLength: z.number().int().min(50).max(1000).optional(),
  model: modelField,
});

export const translateSchema = z.object({
  text: z.string().min(1, "Добавьте текст").max(5000),
  targetLanguage: z.string().min(1, "Укажите язык перевода").max(50),
  model: modelField,
});

export type GenerateContentInput = z.infer<typeof generateContentSchema>;
export type GenerateCodeInput = z.infer<typeof generateCodeSchema>;
export type SummarizeInput = z.infer<typeof summarizeSchema>;
export type TranslateInput = z.infer<typeof translateSchema>;
