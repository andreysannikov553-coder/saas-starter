import { prisma } from "@/lib/db";
import { scanTrendingHealthTopics } from "./trend-scanner";

/**
 * Curated starter queue for the health/sport channel — a fallback/baseline
 * alongside seedTrendingTopicQueue below (the real "Virality Skill" signal,
 * added 2026-09-25). Each title is a distinct, evidence-checkable angle
 * Europe PMC can actually return sources for — kept general enough that
 * research doesn't come back empty, specific enough that the claim/hook
 * stages have something concrete to grab onto.
 */
export const HEALTH_SPORT_TOPIC_QUEUE: string[] = [
  "sleep duration and cardiovascular mortality",
  "resistance training and all-cause mortality risk",
  "sitting time and metabolic health independent of exercise",
  "high intensity interval training versus steady state cardio for fat loss",
  "protein intake and muscle preservation during aging",
  "vitamin D supplementation and immune function",
  "intermittent fasting and metabolic markers",
  "walking pace and life expectancy",
  "cold water immersion and recovery after exercise",
  "caffeine timing and athletic performance",
  "stretching before exercise and injury prevention",
  "grip strength as a predictor of mortality",
  "sugar sweetened beverages and cardiometabolic risk",
  "resistance training and bone density in older adults",
  "sleep deprivation and next day exercise performance",
  "omega-3 fatty acids and cardiovascular outcomes",
  "sauna use and cardiovascular mortality",
  "processed meat consumption and colorectal cancer risk",
  "VO2 max and long term mortality risk",
  "creatine supplementation and cognitive function",
  "alcohol consumption and cardiovascular risk thresholds",
  "standing desks and metabolic health outcomes",
  "sleep consistency versus sleep duration for health outcomes",
  "high protein diets and kidney function in healthy adults",
  "zone 2 cardio training and mitochondrial function",
  "magnesium supplementation and sleep quality",
  "time restricted eating and weight loss outcomes",
  "blue light exposure before bed and sleep quality",
  "plant based protein versus animal protein for muscle growth",
  "high intensity interval training and insulin sensitivity in type 2 diabetes",
  "daily step count and depression risk",
  "resistance training frequency per week and strength gains",
  "fiber intake and gut microbiome diversity",
  "nap duration and cognitive performance",
  "ultra processed food consumption and all-cause mortality",
  "cold exposure and brown fat activation",
  "probiotics and irritable bowel syndrome symptoms",
  "screen time before bed and melatonin suppression",
  "whey protein timing and muscle protein synthesis",
  "yoga practice and chronic lower back pain",
  "outdoor exercise versus indoor exercise for mood",
  "dietary salt intake and blood pressure in salt sensitive adults",
  "eccentric training and tendon injury prevention",
  "meditation practice and cortisol levels",
  "resistance training and insulin resistance in overweight adults",
  "green tea consumption and cardiovascular risk markers",
];

export interface SeedResult {
  orgId: string;
  created: number;
  skipped: number;
}

async function resolveOrg(orgIdArg?: string) {
  return orgIdArg
    ? prisma.organization.findUniqueOrThrow({ where: { id: orgIdArg } })
    : ((await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } })) ??
        (await prisma.organization.create({ data: { name: "Default" } })));
}

/** Inserts candidate titles not already present for the org (case-insensitive), tagged with `pillar`. */
async function insertNewTopics(
  orgId: string,
  candidates: string[],
  pillar: string
): Promise<{ created: number; skipped: number }> {
  const existing = await prisma.topic.findMany({ where: { orgId }, select: { title: true } });
  const existingTitles = new Set(existing.map((t) => t.title.trim().toLowerCase()));

  const toCreate = candidates.filter((title) => !existingTitles.has(title.trim().toLowerCase()));

  if (toCreate.length > 0) {
    await prisma.topic.createMany({
      data: toCreate.map((title) => ({ orgId, title, pillar })),
    });
  }

  return { created: toCreate.length, skipped: candidates.length - toCreate.length };
}

/**
 * Inserts any queue titles not already present as a Topic for the org
 * (case-insensitive match), so this is safe to re-run — it only tops up the
 * queue rather than duplicating it. Reuses the same "first org, or create
 * Default" convention as scripts/run-topic.ts and scripts/add-telegram-account.ts.
 */
export async function seedHealthSportTopicQueue(orgIdArg?: string): Promise<SeedResult> {
  const org = await resolveOrg(orgIdArg);
  const { created, skipped } = await insertNewTopics(
    org.id,
    HEALTH_SPORT_TOPIC_QUEUE,
    "health-sport"
  );
  return { orgId: org.id, created, skipped };
}

export interface SeedTrendingResult extends SeedResult {
  headlinesScanned: number;
}

/**
 * The "Virality Skill" — scans current health/fitness news (trend-scanner.ts)
 * and tops up the queue with what it finds, tagged pillar: "trending" so
 * it's distinguishable from the evergreen curated list above. Safe to re-run
 * on a schedule: dedupes against every existing topic for the org, same as
 * seedHealthSportTopicQueue.
 */
export async function seedTrendingTopicQueue(orgIdArg?: string): Promise<SeedTrendingResult> {
  const org = await resolveOrg(orgIdArg);

  const existing = await prisma.topic.findMany({
    where: { orgId: org.id },
    select: { title: true },
  });
  const existingTitles = existing.map((t) => t.title);

  const scan = await scanTrendingHealthTopics(existingTitles);
  const { created, skipped } = await insertNewTopics(org.id, scan.topics, "trending");

  return { orgId: org.id, created, skipped, headlinesScanned: scan.headlinesScanned };
}
