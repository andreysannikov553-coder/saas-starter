import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { logger, withStageLog } from "./logger";

function captureConsole() {
  const lines: { method: "log" | "warn" | "error"; text: string }[] = [];
  const logMock = mock.method(console, "log", (text: string) => {
    lines.push({ method: "log", text });
  });
  const warnMock = mock.method(console, "warn", (text: string) => {
    lines.push({ method: "warn", text });
  });
  const errorMock = mock.method(console, "error", (text: string) => {
    lines.push({ method: "error", text });
  });
  return {
    lines,
    restore: () => {
      logMock.mock.restore();
      warnMock.mock.restore();
      errorMock.mock.restore();
    },
  };
}

test("logger.info writes a structured JSON line to console.log", () => {
  const capture = captureConsole();
  try {
    logger.info("research", "start", { topicId: "topic-1" });

    assert.equal(capture.lines.length, 1);
    assert.equal(capture.lines[0].method, "log");
    const parsed = JSON.parse(capture.lines[0].text);
    assert.equal(parsed.level, "info");
    assert.equal(parsed.stage, "research");
    assert.equal(parsed.event, "start");
    assert.equal(parsed.topicId, "topic-1");
    assert.equal(typeof parsed.ts, "string");
  } finally {
    capture.restore();
  }
});

test("logger.error writes to console.error", () => {
  const capture = captureConsole();
  try {
    logger.error("publish", "error", { message: "boom" });

    assert.equal(capture.lines.length, 1);
    assert.equal(capture.lines[0].method, "error");
  } finally {
    capture.restore();
  }
});

test("withStageLog logs start then success with the result's extra fields", async () => {
  const capture = captureConsole();
  try {
    const result = await withStageLog(
      "hooks",
      { scriptId: "script-1" },
      async () => ({ bestScore: 18 }),
      (r) => ({ bestScore: r.bestScore })
    );

    assert.deepEqual(result, { bestScore: 18 });
    assert.equal(capture.lines.length, 2);

    const start = JSON.parse(capture.lines[0].text);
    assert.equal(start.event, "start");
    assert.equal(start.scriptId, "script-1");

    const success = JSON.parse(capture.lines[1].text);
    assert.equal(success.event, "success");
    assert.equal(success.scriptId, "script-1");
    assert.equal(success.bestScore, 18);
  } finally {
    capture.restore();
  }
});

test("withStageLog logs start then error and rethrows", async () => {
  const capture = captureConsole();
  try {
    await assert.rejects(
      () =>
        withStageLog("publish", { videoId: "video-1" }, async () => {
          throw new Error("send failed");
        }),
      /send failed/
    );

    assert.equal(capture.lines.length, 2);
    const errorLine = JSON.parse(capture.lines[1].text);
    assert.equal(errorLine.event, "error");
    assert.equal(errorLine.videoId, "video-1");
    assert.equal(errorLine.message, "send failed");
  } finally {
    capture.restore();
  }
});
