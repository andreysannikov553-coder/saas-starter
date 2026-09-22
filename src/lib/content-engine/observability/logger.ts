/**
 * Minimal structured logging for the content pipeline — one JSON line per
 * event to stdout/stderr, no dependency. Every content-engine stage was
 * previously silent (found in the pre-production audit, PRODUCTION_READINESS.md
 * §10): a failed run left nothing behind but a thrown error and whatever made
 * it into the database before the failure. This gives every stage a
 * consistent start/success/error trail without picking a logging vendor.
 */

export type LogLevel = "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

function write(level: LogLevel, stage: string, event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    stage,
    event,
    ...fields,
  });
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info(stage: string, event: string, fields?: LogFields): void {
    write("info", stage, event, fields);
  },
  warn(stage: string, event: string, fields?: LogFields): void {
    write("warn", stage, event, fields);
  },
  error(stage: string, event: string, fields?: LogFields): void {
    write("error", stage, event, fields);
  },
};

/**
 * Wraps a stage function with a start/success/error log line — the
 * `fields` returned from `onSuccess`/`onError` become that line's extra
 * fields, so each stage controls what's worth logging (ids, counts) without
 * duplicating the try/catch in every stage module.
 */
export async function withStageLog<T>(
  stage: string,
  fields: LogFields,
  fn: () => Promise<T>,
  onSuccess?: (result: T) => LogFields
): Promise<T> {
  logger.info(stage, "start", fields);
  try {
    const result = await fn();
    logger.info(stage, "success", { ...fields, ...(onSuccess ? onSuccess(result) : {}) });
    return result;
  } catch (error) {
    logger.error(stage, "error", {
      ...fields,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
