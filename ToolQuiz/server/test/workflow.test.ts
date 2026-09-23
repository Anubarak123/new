import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import ExcelJS from "exceljs";
import path from "node:path";
import { rm } from "node:fs/promises";

test("complete role portal workflow, secrecy, snapshots, export, expiry, and concurrent submission", async () => {
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const originalUrl = process.env.DATABASE_URL!;
  const admin = new PrismaClient({ datasourceUrl: originalUrl });
  const testUrl = new URL(originalUrl);
  testUrl.searchParams.set("schema", schema);
  process.env.DATABASE_URL = testUrl.toString();
  process.env.UPLOAD_DIR = path.resolve(".local", schema, "uploads");
  process.env.NODE_ENV = "test";
  let server: ReturnType<typeof import("node:http").createServer> | undefined;
  let db: PrismaClient | undefined;
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    execFileSync(
      process.execPath,
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      { env: process.env, stdio: "pipe" },
    );
    const appModule = await import("../src/app.js");
    db = (await import("../src/db.js")).db;
    const { sample, semesterAt, expireAttempts } =
      await import("../src/attempts.js");
    for (const [month, term] of [
      [0, "SPRING"],
      [4, "SPRING"],
      [5, "SUMMER"],
      [7, "SUMMER"],
      [8, "FALL"],
      [11, "FALL"],
    ] as const)
      assert.deepEqual(semesterAt(new Date(Date.UTC(2026, month, 10))), {
        semester: term,
        year: 2026,
      });
    assert.equal(new Set(sample([1, 2, 3, 4, 5], 5)).size, 5);
    await db.professor.create({
      data: {
        username: "professor",
        name: "Professor",
        passwordHash: await bcrypt.hash("professor123", 4),
      },
    });
    server = appModule.app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
    let auth = "";
    async function req(
      url: string,
      method = "GET",
      body?: unknown,
      token?: string,
      withAuth = true,
    ) {
      const form = body instanceof FormData;
      const r = await fetch(base + url, {
        method,
        headers: {
          ...(!form ? { "Content-Type": "application/json" } : {}),
          ...(withAuth && auth ? { Authorization: `Bearer ${auth}` } : {}),
          ...(token ? { "X-Attempt-Token": token } : {}),
        },
        body:
          body === undefined ? undefined : form ? body : JSON.stringify(body),
      });
      const data = r.status === 204 ? null : await r.json();
      return { status: r.status, data };
    }
    for (const url of [
      "/professor/tools",
      "/professor/categories",
      "/professor/settings",
      "/professor/results",
      "/professor/results/export",
    ])
      assert.equal((await req(url)).status, 401);
    assert.equal(
      (
        await req("/auth/login", "POST", {
          username: "professor",
          password: "wrong",
        })
      ).status,
      401,
    );
    auth = (
      await req("/auth/login", "POST", {
        username: "professor",
        password: "professor123",
      })
    ).data.token;
    assert.equal(
      (await req("/student/start", "POST", { studentName: "Student" })).status,
      400,
    );
    assert.equal(
      (await req("/professor/categories", "POST", { name: "   " })).status,
      400,
    );
    const c1 = (
      await req("/professor/categories", "POST", { name: "Communication" })
    ).data;
    const c2 = (await req("/professor/categories", "POST", { name: "Storage" }))
      .data;
    assert.equal(
      (await req("/professor/categories", "POST", { name: " communication " }))
        .status,
      409,
    );
    assert.equal(
      (
        await req(`/professor/categories/${c1.id}`, "PUT", {
          name: "Communication Tools",
        })
      ).status,
      200,
    );
    const logo = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#226b50" },
    })
      .png()
      .toBuffer();
    const created: any[] = [];
    for (let i = 0; i < 6; i++) {
      const f = new FormData();
      f.set("name", `Tool ${i}`);
      f.set("categoryId", i % 2 ? c2.id : c1.id);
      if (i === 0)
        f.set(
          "logo",
          new Blob([new Uint8Array(logo)], { type: "image/png" }),
          "../../unsafe.png",
        );
      const r = await req("/professor/tools", "POST", f);
      assert.equal(r.status, 200);
      created.push(r.data);
    }
    assert.match(created[0].logoPath, /^\/uploads\/tools\/[a-f0-9-]+\.webp$/);
    assert.equal(
      (await fetch(base.replace("/api", "") + created[0].logoPath)).status,
      200,
    );
    const edit = new FormData();
    edit.set("name", "Renamed Tool");
    edit.set("categoryId", c1.id);
    assert.equal(
      (await req(`/professor/tools/${created[0].id}`, "PUT", edit)).status,
      200,
    );
    const bad = new FormData();
    bad.set("name", "Bad");
    bad.set("categoryId", c1.id);
    bad.set("logo", new Blob(["not a png"], { type: "image/png" }), "fake.png");
    assert.equal((await req("/professor/tools", "POST", bad)).status, 400);
    const oversized = new FormData();
    oversized.set("name", "Big");
    oversized.set("categoryId", c1.id);
    oversized.set(
      "logo",
      new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: "image/png" }),
      "large.png",
    );
    assert.equal(
      (await req("/professor/tools", "POST", oversized)).status,
      400,
    );
    assert.equal(
      (await req(`/professor/categories/${c1.id}`, "DELETE")).status,
      409,
    );
    assert.equal(
      (
        await req("/professor/settings", "PUT", {
          toolsPerQuiz: 20,
          timeLimitSeconds: 180,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await req("/professor/settings", "PUT", {
          toolsPerQuiz: 5,
          timeLimitSeconds: 0,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await req("/professor/settings", "PUT", {
          toolsPerQuiz: 5,
          timeLimitSeconds: 180,
        })
      ).status,
      200,
    );
    assert.equal((await req("/student")).data.toolsPerQuiz, 5);
    assert.equal(
      (await req("/student/start", "POST", { studentName: "  " })).status,
      400,
    );
    const start = (
      await req("/student/start", "POST", { studentName: "  John Smith  " })
    ).data;
    const get = () =>
      req(`/attempts/${start.id}`, "GET", undefined, start.token, false);
    const active = (await get()).data;
    assert.equal(active.studentName, "John Smith");
    assert.equal(active.tools.length, 5);
    assert.equal(new Set(active.tools.map((t: any) => t.id)).size, 5);
    assert.equal(
      (await req(`/attempts/${start.id}`, "GET", undefined, undefined, false))
        .status,
      401,
    );
    assert.equal(JSON.stringify(active).includes("correctCategory"), false);
    assert.equal(JSON.stringify(active).includes("isCorrect"), false);
    assert.equal(JSON.stringify(active).includes("tokenHash"), false);
    assert.equal((await get()).data.expiresAt, active.expiresAt);
    const snapshots = await db.attemptTool.findMany({
      where: { attemptId: start.id },
      orderBy: { displayOrder: "asc" },
    });
    const selections = snapshots
      .slice(0, 4)
      .map((t) => ({ toolId: t.id, selectedCategoryId: t.correctCategoryId }));
    assert.equal(
      (
        await req(
          `/attempts/${start.id}/answers`,
          "PUT",
          { toolId: snapshots[0].id, selectedCategoryId: "unknown" },
          start.token,
        )
      ).status,
      400,
    );
    for (const answer of selections)
      assert.equal(
        (await req(`/attempts/${start.id}/answers`, "PUT", answer, start.token))
          .status,
        200,
      );
    assert.equal(
      (await get()).data.tools.filter((t: any) => t.selectedCategoryId).length,
      4,
    );
    // Edit the library while a quiz is active; saved names and correct answers must not change.
    await req(`/professor/categories/${c1.id}`, "PUT", {
      name: "Changed after start",
    });
    const result = (
      await req(
        `/attempts/${start.id}/submit`,
        "POST",
        { answers: selections, score: 999 },
        start.token,
      )
    ).data;
    assert.equal(result.score, 4);
    assert.equal(result.totalTools, 5);
    assert.equal(result.percentage, 80);
    assert.equal(
      result.tools.filter((t: any) => t.isCorrect === false).length,
      1,
    );
    assert.equal(
      result.tools.find((t: any) => !t.selectedCategoryId).selectedCategoryName,
      null,
    );
    assert.ok(
      result.tools.some(
        (t: any) => t.correctCategoryName === "Communication Tools",
      ),
    );
    const repeated = await Promise.all([
      req(`/attempts/${start.id}/submit`, "POST", { answers: [] }, start.token),
      req(`/attempts/${start.id}/submit`, "POST", { answers: [] }, start.token),
    ]);
    assert.ok(
      repeated.every(
        (r) => r.data.score === 4 && r.data.submittedAt === result.submittedAt,
      ),
    );
    assert.equal(
      (
        await req(
          `/attempts/${start.id}/answers`,
          "PUT",
          selections[0],
          start.token,
        )
      ).status,
      409,
    );
    const term = `${result.semester}-${result.year}`;
    const query = `search=jOhN&semester=${term}&sort=high`;
    const filtered = (await req(`/professor/results?${query}`)).data;
    assert.equal(filtered.rows.length, 1);
    assert.equal(filtered.semesters.length, 1);
    for (const sort of ["newest", "oldest", "high", "low", "az", "za"])
      assert.equal(
        (await req(`/professor/results?search=JOHN&sort=${sort}`)).data.rows[0]
          .id,
        start.id,
      );
    assert.equal(
      (await req("/professor/results?search=nobody")).data.rows.length,
      0,
    );
    const exported = await fetch(`${base}/professor/results/export?${query}`, {
      headers: { Authorization: `Bearer ${auth}` },
    });
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get("content-type")!, /spreadsheetml/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await exported.arrayBuffer()) as any);
    assert.equal(workbook.worksheets[0].rowCount, 2);
    assert.equal(workbook.worksheets[0].getCell("A2").value, "John Smith");
    assert.equal(workbook.worksheets[0].getCell("D2").value, 4);
    // Deadline enforcement, including a request that attempts to change an expired answer.
    const expired = (
      await req("/student/start", "POST", { studentName: "Timeout Student" })
    ).data;
    const expRows = await db.attemptTool.findMany({
      where: { attemptId: expired.id },
    });
    await req(
      `/attempts/${expired.id}/answers`,
      "PUT",
      {
        toolId: expRows[0].id,
        selectedCategoryId: expRows[0].correctCategoryId,
      },
      expired.token,
    );
    await db.attempt.update({
      where: { id: expired.id },
      data: {
        startedAt: new Date(Date.now() - 181000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    assert.equal(
      (
        await req(
          `/attempts/${expired.id}/answers`,
          "PUT",
          {
            toolId: expRows[1].id,
            selectedCategoryId: expRows[1].correctCategoryId,
          },
          expired.token,
        )
      ).status,
      409,
    );
    const timed = (
      await req(`/attempts/${expired.id}`, "GET", undefined, expired.token)
    ).data;
    assert.equal(timed.status, "EXPIRED");
    assert.equal(timed.score, 1);
    assert.equal(timed.timeSpentSeconds, 180);
    const unattended = (
      await req("/student/start", "POST", { studentName: "Closed Browser" })
    ).data;
    await db.attempt.update({
      where: { id: unattended.id },
      data: {
        startedAt: new Date(Date.now() - 181000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await expireAttempts();
    assert.equal(
      (await db.attempt.findUniqueOrThrow({ where: { id: unattended.id } }))
        .status,
      "EXPIRED",
    );
    // Genuine short timer: no altered timestamps, automatic backend finalization.
    await req("/professor/settings", "PUT", {
      toolsPerQuiz: 5,
      timeLimitSeconds: 1,
    });
    const short = (
      await req("/student/start", "POST", { studentName: "Short timer" })
    ).data;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await expireAttempts();
    assert.equal(
      (await req(`/attempts/${short.id}`, "GET", undefined, short.token)).data
        .status,
      "EXPIRED",
    );
    // Deleting all live records must leave result snapshots and their logos readable.
    const remove = new FormData();
    remove.set("name", "Without logo");
    remove.set("categoryId", c1.id);
    remove.set("removeLogo", "true");
    assert.equal(
      (await req(`/professor/tools/${created[0].id}`, "PUT", remove)).data
        .logoPath,
      null,
    );
    for (const t of created)
      assert.equal(
        (await req(`/professor/tools/${t.id}`, "DELETE")).status,
        204,
      );
    assert.equal(
      (await req(`/professor/categories/${c1.id}`, "DELETE")).status,
      204,
    );
    assert.equal(
      (await req(`/professor/categories/${c2.id}`, "DELETE")).status,
      204,
    );
    const historical = (await req(`/professor/results/${start.id}`)).data;
    assert.deepEqual(historical.tools, result.tools);
    assert.equal(historical.score, 4);
    assert.equal(
      (await fetch(base.replace("/api", "") + created[0].logoPath)).status,
      200,
    );
    assert.equal((await req("/student")).data.available, false);
    assert.equal((await req("/assignments")).status, 404);
  } finally {
    if (server)
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (db) await db.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
    await rm(path.resolve(".local", schema), { recursive: true, force: true });
    process.env.DATABASE_URL = originalUrl;
  }
});
