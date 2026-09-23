import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

test("migration preserves legacy submitted and active attempts while merging global categories", async () => {
  const schema = `migration_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("schema", schema);
  const admin = new PrismaClient();
  const db = new PrismaClient({ datasourceUrl: url.toString() });
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    const run = (file: string) =>
      execFileSync(
        process.execPath,
        [
          "node_modules/prisma/build/index.js",
          "db",
          "execute",
          "--file",
          file,
          "--url",
          url.toString(),
        ],
        { stdio: "pipe" },
      );
    run("prisma/migrations/20260910000000_init/migration.sql");
    await db.$executeRaw`INSERT INTO "Teacher" (id,name,email,"passwordHash") VALUES ('p','Old Professor','old@example.com','hash')`;
    await db.$executeRaw`INSERT INTO "Assignment" (id,"teacherId",title,instructions,"assignmentCode","toolsPerAttempt","timeLimitSeconds",status,"updatedAt") VALUES ('a','p','Old quiz','','OLD',1,180,'PUBLISHED',CURRENT_TIMESTAMP),('b','p','Other quiz','','OTHER',1,180,'PUBLISHED',CURRENT_TIMESTAMP)`;
    await db.$executeRaw`INSERT INTO "Category" (id,"assignmentId",name) VALUES ('c1','a','Communication'),('c2','b','communication')`;
    await db.$executeRaw`INSERT INTO "Tool" (id,"assignmentId","categoryId",name) VALUES ('t1','a','c1','Zoom'),('t2','b','c2','Teams')`;
    await db.$executeRaw`INSERT INTO "Attempt" (id,"assignmentId","studentName","tokenHash","startedAt","expiresAt","submittedAt",score,"totalTools",status) VALUES ('done','a','Past Student','token','2026-09-10 12:00:00','2026-09-10 12:03:00','2026-09-10 12:01:00',1,1,'SUBMITTED'),('active','b','Active Student','token','2026-08-31 23:59:00','2026-09-01 00:02:00',NULL,NULL,1,'IN_PROGRESS')`;
    await db.$executeRaw`INSERT INTO "AttemptTool" (id,"attemptId","toolId",position,"selectedCategoryId","isCorrect") VALUES ('at1','done','t1',0,'c1',true),('at2','active','t2',0,'c2',NULL)`;
    run("prisma/migrations/20260910010000_global_portal/migration.sql");
    assert.equal(await db.category.count(), 1);
    assert.equal(
      (await db.tool.findUniqueOrThrow({ where: { id: "t2" } })).categoryId,
      "c1",
    );
    assert.equal(
      (await db.professor.findUniqueOrThrow({ where: { id: "p" } })).username,
      "old@example.com",
    );
    const done = await db.attempt.findUniqueOrThrow({
      where: { id: "done" },
      include: { tools: true },
    });
    assert.equal(done.semester, "FALL");
    assert.equal(done.year, 2026);
    assert.equal(done.percentage, 100);
    assert.equal(done.timeSpentSeconds, 60);
    assert.equal(done.tools[0].toolName, "Zoom");
    assert.equal(done.tools[0].correctCategoryName, "Communication");
    const active = await db.attempt.findUniqueOrThrow({
      where: { id: "active" },
      include: { tools: true },
    });
    assert.equal(active.semester, "SUMMER");
    assert.equal(active.tools[0].correctCategoryId, "c2");
    assert.equal(active.tools[0].selectedCategoryId, "c2");
    assert.deepEqual(active.categories, [{ id: "c2", name: "communication" }]);
    await db.tool.deleteMany();
    await db.category.deleteMany();
    assert.deepEqual(
      (
        await db.attempt.findUniqueOrThrow({
          where: { id: "done" },
          include: { tools: true },
        })
      ).tools,
      done.tools,
    );
  } finally {
    await db.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
  }
});
