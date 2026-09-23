import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
test("fresh development seed sets six tools and is idempotent", async () => {
  const schema = `seed_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("schema", schema);
  const admin = new PrismaClient();
  const db = new PrismaClient({ datasourceUrl: url.toString() });
  const env = {
    ...process.env,
    DATABASE_URL: url.toString(),
    NODE_ENV: "test",
    PROFESSOR_USERNAME: "professor",
    PROFESSOR_PASSWORD: "professor123",
  };
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    execFileSync(
      process.execPath,
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      { env, stdio: "pipe" },
    );
    const seed = () =>
      execFileSync(process.execPath, ["--import", "tsx", "prisma/seed.ts"], {
        env,
        stdio: "pipe",
      });
    seed();
    assert.equal(await db.tool.count(), 9);
    assert.equal(await db.category.count(), 3);
    assert.equal(
      (await db.quizSettings.findUniqueOrThrow({ where: { id: 1 } }))
        .toolsPerQuiz,
      6,
    );
    assert.equal(
      (await db.quizSettings.findUniqueOrThrow({ where: { id: 1 } }))
        .timeLimitSeconds,
      180,
    );
    const professor = await db.professor.findUniqueOrThrow({
      where: { username: "professor" },
    });
    await db.quizSettings.update({
      where: { id: 1 },
      data: { toolsPerQuiz: 5 },
    });
    seed();
    assert.equal(await db.tool.count(), 9);
    assert.equal(
      (await db.quizSettings.findUniqueOrThrow({ where: { id: 1 } }))
        .toolsPerQuiz,
      5,
    );
    assert.equal(
      (
        await db.professor.findUniqueOrThrow({
          where: { username: "professor" },
        })
      ).passwordHash,
      professor.passwordHash,
    );
  } finally {
    await db.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
  }
});
