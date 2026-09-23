import { createHash, randomInt } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "./db.js";
export const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function sample<T>(items: T[], count: number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}
export function semesterAt(date: Date) {
  const month = date.getUTCMonth();
  return {
    semester: month < 5 ? "SPRING" : month < 8 ? "SUMMER" : "FALL",
    year: date.getUTCFullYear(),
  };
}
export const includeAttempt = {
  tools: { orderBy: { displayOrder: "asc" as const } },
};
export type FullAttempt = Prisma.AttemptGetPayload<{
  include: typeof includeAttempt;
}>;
export type CategorySnapshot = { id: string; name: string };
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function finish(
  tx: Prisma.TransactionClient,
  a: FullAttempt,
  now: Date,
) {
  if (a.status !== "IN_PROGRESS") return a;
  const expired = now >= a.expiresAt;
  let score = 0;
  for (const answer of a.tools) {
    const isCorrect =
      answer.selectedCategoryId !== null &&
      answer.selectedCategoryId === answer.correctCategoryId;
    if (isCorrect) score++;
    await tx.attemptTool.update({
      where: { id: answer.id },
      data: { isCorrect },
    });
  }
  const submittedAt = expired ? a.expiresAt : now;
  return tx.attempt.update({
    where: { id: a.id },
    data: {
      score,
      percentage: Math.round((score / a.totalTools) * 1000) / 10,
      timeSpentSeconds: Math.max(
        0,
        Math.round((submittedAt.getTime() - a.startedAt.getTime()) / 1000),
      ),
      status: expired ? "EXPIRED" : "SUBMITTED",
      submittedAt,
    },
    include: includeAttempt,
  });
}
export async function lockedAttempt<T>(
  id: string,
  action: (tx: Prisma.TransactionClient, a: FullAttempt) => Promise<T>,
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Attempt" WHERE id = ${id} FOR UPDATE`;
    const a = await tx.attempt.findUnique({
      where: { id },
      include: includeAttempt,
    });
    if (!a) throw new HttpError(404, "Attempt not found.");
    return action(tx, a);
  });
}
export function present(a: FullAttempt) {
  const done = a.status !== "IN_PROGRESS";
  return {
    id: a.id,
    studentName: a.studentName,
    semester: a.semester,
    year: a.year,
    status: a.status,
    startedAt: a.startedAt,
    expiresAt: a.expiresAt,
    submittedAt: a.submittedAt,
    serverNow: new Date(),
    score: a.score,
    totalTools: a.totalTools,
    percentage: a.percentage,
    timeSpentSeconds: a.timeSpentSeconds,
    categories: a.categories,
    tools: a.tools.map((t) => ({
      id: t.id,
      name: t.toolName,
      logoPath: t.toolLogoPath,
      selectedCategoryId: t.selectedCategoryId,
      ...(done
        ? {
            selectedCategoryName: t.selectedCategoryName,
            correctCategoryName: t.correctCategoryName,
            isCorrect: t.isCorrect,
          }
        : {}),
    })),
  };
}
export async function expireAttempts() {
  const pending = await db.attempt.findMany({
    where: { status: "IN_PROGRESS", expiresAt: { lte: new Date() } },
    select: { id: true },
    take: 100,
  });
  for (const a of pending)
    await lockedAttempt(a.id, async (tx, current) => {
      if (current.status === "IN_PROGRESS" && current.expiresAt <= new Date())
        await finish(tx, current, new Date());
    });
}
