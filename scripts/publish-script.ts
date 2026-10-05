/**
 * Publishes a script that is already rendered (scripts/make-kinetic-video.ts
 * --upload) to the org's platform accounts, without generating a new topic
 * the way `run-topic.ts --publish-all` does.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/publish-script.ts --script=latest --platforms=INSTAGRAM
 *
 * Flags:
 *   --script=<id|latest>  The Script to publish. `latest` (the default) is the
 *                         script of the newest Video with an uploaded render.
 *   --platforms=<list>    Comma-separated subset of YOUTUBE_SHORTS, INSTAGRAM,
 *                         TIKTOK, TELEGRAM. Default: every platform with an
 *                         account on the org.
 *
 * Safe to re-run: platforms already PUBLISHED for this video short-circuit
 * (see publishing/publish-all.ts), so only failures are retried.
 */
import { prisma } from "../src/lib/db";
import {
  publishVideoToAllPlatforms,
  type VideoPlatform,
} from "../src/lib/content-engine/publishing/publish-all";

const PLATFORMS: VideoPlatform[] = ["YOUTUBE_SHORTS", "INSTAGRAM", "TIKTOK", "TELEGRAM"];

function parseFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

function parsePlatforms(raw: string | undefined): VideoPlatform[] | undefined {
  if (!raw) return undefined;
  const list = raw.split(",").map((p) => p.trim().toUpperCase());
  const unknown = list.filter((p) => !PLATFORMS.includes(p as VideoPlatform));
  if (unknown.length > 0) {
    throw new Error(`Unknown platform(s): ${unknown.join(", ")}. Use: ${PLATFORMS.join(", ")}`);
  }
  return list as VideoPlatform[];
}

async function resolveScript(flag: string): Promise<{ id: string; orgId: string }> {
  if (flag === "latest") {
    const video = await prisma.video.findFirst({
      where: { assetUrl: { not: null } },
      orderBy: { updatedAt: "desc" },
      select: { scriptId: true, orgId: true },
    });
    if (!video) {
      throw new Error(
        "No rendered video yet — run scripts/make-kinetic-video.ts with --script=latest --upload first"
      );
    }
    return { id: video.scriptId, orgId: video.orgId };
  }

  const script = await prisma.script.findUnique({
    where: { id: flag },
    select: { id: true, orgId: true },
  });
  if (!script) throw new Error(`Script ${flag} not found`);
  return script;
}

async function main() {
  const platforms = parsePlatforms(parseFlag("platforms"));
  const script = await resolveScript(parseFlag("script") ?? "latest");
  console.log(`Script ${script.id}${platforms ? ` -> ${platforms.join(", ")}` : ""}\n`);

  const outcomes = await publishVideoToAllPlatforms(script.id, script.orgId, { platforms });

  if (outcomes.length === 0) {
    console.log("No platform accounts on this org — run scripts/add-*-account.ts first.");
    process.exitCode = 1;
    return;
  }
  for (const o of outcomes) {
    const detail = o.externalId ?? o.reason ?? "";
    console.log(
      `${o.status.padEnd(9)} ${o.platform.padEnd(14)} ${o.handle} ${o.mode ?? ""} ${detail}`
    );
  }
  if (outcomes.some((o) => o.status === "FAILED")) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("\nPublish failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
