import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import multer from "multer";
import ExcelJS from "exceljs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "./db.js";
import {
  HttpError,
  hash,
  sample,
  finish,
  lockedAttempt,
  present,
  expireAttempts,
  semesterAt,
  CategorySnapshot,
  includeAttempt,
} from "./attempts.js";
import { logoStorage, uploadRoot } from "./storage.js";
const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32)
  throw new Error("JWT_SECRET must contain at least 32 characters.");
export const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY_HOPS)
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS));
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || false }));
app.use(express.json({ limit: "100kb" }));
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(
  "/uploads/tools",
  express.static(uploadRoot, {
    immutable: true,
    maxAge: "1y",
    dotfiles: "deny",
  }),
);
const name = z.string().trim().min(1).max(150);
const id = (req: Request) => String(req.params.id);
async function professor(req: Request) {
  try {
    const payload = jwt.verify(
      (req.headers.authorization || "").replace(/^Bearer /, ""),
      secret!,
      { algorithms: ["HS256"] },
    ) as jwt.JwtPayload;
    if (
      payload.role !== "professor" ||
      typeof payload.sub !== "string" ||
      !(await db.professor.findUnique({ where: { id: payload.sub } }))
    )
      throw new Error();
  } catch {
    throw new HttpError(401, "Please log in.");
  }
}
// All library mutations/settings/start operations share one lock for a consistent quiz snapshot.
async function library<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(6332026)`;
    return fn(tx);
  });
}
app.get("/api/health", async (_req, res) => {
  await db.$queryRaw`SELECT 1`;
  res.json({ ok: true });
});
app.post(
  "/api/auth/login",
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 }),
  async (req, res) => {
    const input = z
      .object({ username: name, password: z.string().max(200) })
      .parse(req.body);
    const p = await db.professor.findUnique({
      where: { username: input.username },
    });
    if (!p || !(await bcrypt.compare(input.password, p.passwordHash)))
      throw new HttpError(401, "Username or password is incorrect.");
    res.json({
      token: jwt.sign({ role: "professor" }, secret!, {
        subject: p.id,
        expiresIn: "8h",
      }),
      name: p.name,
    });
  },
);
app.use("/api/professor", async (req, _res, next) => {
  await professor(req);
  next();
});
app.get("/api/professor/session", (_req, res) => res.json({ ok: true }));
app.get("/api/professor/categories", async (_req, res) =>
  res.json(
    await db.category.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { tools: true } } },
    }),
  ),
);
for (const method of ["post", "put"] as const)
  app[method](
    `/api/professor/categories${method === "put" ? "/:id" : ""}`,
    async (req, res) => {
      const data = z.object({ name }).parse(req.body);
      res.json(
        await library(async (tx) => {
          const duplicate = await tx.category.findFirst({
            where: {
              name: { equals: data.name, mode: "insensitive" },
              ...(method === "put" ? { id: { not: id(req) } } : {}),
            },
          });
          if (duplicate)
            throw new HttpError(
              409,
              "A category with this name already exists.",
            );
          return method === "put"
            ? tx.category.update({ where: { id: id(req) }, data })
            : tx.category.create({ data });
        }),
      );
    },
  );
app.delete("/api/professor/categories/:id", async (req, res) => {
  await library(async (tx) => {
    const count = await tx.tool.count({ where: { categoryId: id(req) } });
    if (count)
      throw new HttpError(
        409,
        `This category contains ${count} tools. Move or delete those tools before deleting the category.`,
      );
    await tx.category.delete({ where: { id: id(req) } });
  });
  res.status(204).end();
});
app.get("/api/professor/tools", async (_req, res) =>
  res.json(
    await db.tool.findMany({
      include: { category: true },
      orderBy: { name: "asc" },
    }),
  ),
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 4 },
  fileFilter: (_req, file, cb) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.mimetype))
      return cb(new HttpError(400, "Upload a PNG, JPEG, or WebP image."));
    cb(null, true);
  },
});
for (const method of ["post", "put"] as const)
  app[method](
    `/api/professor/tools${method === "put" ? "/:id" : ""}`,
    upload.single("logo"),
    async (req, res) => {
      const input = z
        .object({
          name,
          categoryId: z.string().min(1),
          removeLogo: z.enum(["true", "false"]).optional(),
        })
        .parse(req.body);
      res.json(
        await library(async (tx) => {
          if (
            !(await tx.category.findUnique({ where: { id: input.categoryId } }))
          )
            throw new HttpError(400, "Choose an existing category.");
          if (
            method === "put" &&
            !(await tx.tool.findUnique({ where: { id: id(req) } }))
          )
            throw new HttpError(404, "Tool not found.");
          const logoPath = req.file
            ? await logoStorage.save(req.file)
            : input.removeLogo === "true"
              ? null
              : undefined;
          const data = {
            name: input.name,
            categoryId: input.categoryId,
            logoPath,
          };
          return method === "put"
            ? tx.tool.update({ where: { id: id(req) }, data })
            : tx.tool.create({ data });
        }),
      );
    },
  );
app.delete("/api/professor/tools/:id", async (req, res) => {
  await library((tx) => tx.tool.delete({ where: { id: id(req) } }));
  res.status(204).end();
});
async function settings(tx: Prisma.TransactionClient = db) {
  const config = await tx.quizSettings.findUnique({ where: { id: 1 } });
  const totalTools = await tx.tool.count();
  const totalCategories = await tx.category.count();
  return {
    ...config,
    totalTools,
    totalCategories,
    available:
      !!config &&
      config.toolsPerQuiz > 0 &&
      config.timeLimitSeconds > 0 &&
      config.toolsPerQuiz <= totalTools &&
      totalCategories > 0,
  };
}
app.get("/api/professor/settings", async (_req, res) =>
  res.json(await settings()),
);
app.get("/api/student", async (_req, res) => res.json(await settings()));
app.put("/api/professor/settings", async (req, res) => {
  const data = z
    .object({
      toolsPerQuiz: z.number().int().positive().max(500),
      timeLimitSeconds: z.number().int().positive().max(86400),
    })
    .parse(req.body);
  res.json(
    await library(async (tx) => {
      const total = await tx.tool.count();
      if (data.toolsPerQuiz > total)
        throw new HttpError(
          400,
          `You selected ${data.toolsPerQuiz} tools per quiz, but only ${total} tools exist.`,
        );
      return tx.quizSettings.upsert({
        where: { id: 1 },
        create: { id: 1, ...data },
        update: data,
      });
    }),
  );
});
app.post(
  "/api/student/start",
  rateLimit({ windowMs: 60000, limit: 120 }),
  async (req, res) => {
    const { studentName } = z.object({ studentName: name }).parse(req.body);
    const token = randomBytes(32).toString("hex");
    const a = await library(async (tx) => {
      const config = await settings(tx);
      if (!config.available)
        throw new HttpError(
          400,
          "The quiz is unavailable. The Professor must configure a positive time limit and enough tools.",
        );
      const tools = await tx.tool.findMany({ include: { category: true } });
      const categories = await tx.category.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
      const startedAt = new Date();
      return tx.attempt.create({
        data: {
          studentName,
          tokenHash: hash(token),
          ...semesterAt(startedAt),
          startedAt,
          expiresAt: new Date(
            startedAt.getTime() + config.timeLimitSeconds! * 1000,
          ),
          totalTools: config.toolsPerQuiz!,
          categories,
          tools: {
            create: sample(tools, config.toolsPerQuiz!).map(
              (t, displayOrder) => ({
                toolId: t.id,
                toolName: t.name,
                toolLogoPath: t.logoPath,
                correctCategoryId: t.categoryId,
                correctCategoryName: t.category.name,
                displayOrder,
              }),
            ),
          },
        },
      });
    });
    res.status(201).json({ id: a.id, token });
  },
);
const answerInput = z.object({
  toolId: z.string(),
  selectedCategoryId: z.string().nullable(),
});
async function attemptAction(
  req: Request,
  mode: "read" | "answers" | "submit",
) {
  const result = await lockedAttempt(id(req), async (tx, initial) => {
    let a = initial;
    const token = req.headers["x-attempt-token"];
    if (typeof token !== "string" || hash(token) !== a.tokenHash) {
      if (mode !== "read") throw new HttpError(403, "Attempt access denied.");
      await professor(req);
    }
    const now = new Date();
    if (a.status === "IN_PROGRESS" && now >= a.expiresAt)
      a = await finish(tx, a, now);
    if (mode === "answers" && a.status !== "IN_PROGRESS")
      return { late: true, data: present(a) };
    if (a.status === "IN_PROGRESS" && mode !== "read") {
      const answers =
        mode === "answers"
          ? [answerInput.parse(req.body)]
          : z.object({ answers: z.array(answerInput).max(500) }).parse(req.body)
              .answers;
      const categories = a.categories as CategorySnapshot[];
      if (new Set(answers.map((t) => t.toolId)).size !== answers.length)
        throw new HttpError(400, "Duplicate answer.");
      for (const answer of answers) {
        if (
          !a.tools.some((t) => t.id === answer.toolId) ||
          (answer.selectedCategoryId !== null &&
            !categories.some((c) => c.id === answer.selectedCategoryId))
        )
          throw new HttpError(
            400,
            "Invalid tool or category for this attempt.",
          );
        await tx.attemptTool.update({
          where: { id: answer.toolId },
          data: {
            selectedCategoryId: answer.selectedCategoryId,
            selectedCategoryName:
              categories.find((c) => c.id === answer.selectedCategoryId)
                ?.name || null,
          },
        });
      }
      a = await tx.attempt.findUniqueOrThrow({
        where: { id: a.id },
        include: includeAttempt,
      });
      if (mode === "submit") a = await finish(tx, a, now);
    }
    return { late: false, data: present(a) };
  });
  if (result.late)
    throw new HttpError(
      409,
      "Time has ended or this attempt is already submitted.",
    );
  return result.data;
}
app.get("/api/attempts/:id", async (req, res) =>
  res.json(await attemptAction(req, "read")),
);
app.put("/api/attempts/:id/answers", async (req, res) =>
  res.json(await attemptAction(req, "answers")),
);
app.post("/api/attempts/:id/submit", async (req, res) =>
  res.json(await attemptAction(req, "submit")),
);
function resultQuery(req: Request) {
  const input = z
    .object({
      search: z.string().max(150).optional(),
      semester: z
        .string()
        .regex(/^(SPRING|SUMMER|FALL)-\d{4}$/)
        .optional(),
      sort: z
        .enum(["newest", "oldest", "high", "low", "az", "za"])
        .default("newest"),
    })
    .parse(req.query);
  const [semester, year] = input.semester?.split("-") || [];
  const where: Prisma.AttemptWhereInput = {
    ...(input.search
      ? { studentName: { contains: input.search, mode: "insensitive" } }
      : {}),
    ...(semester ? { semester, year: Number(year) } : {}),
  };
  const sorts: Record<string, Prisma.AttemptOrderByWithRelationInput> = {
    newest: { startedAt: "desc" },
    oldest: { startedAt: "asc" },
    high: { percentage: { sort: "desc", nulls: "last" } },
    low: { percentage: { sort: "asc", nulls: "last" } },
    az: { studentName: "asc" },
    za: { studentName: "desc" },
  };
  return {
    where,
    orderBy: [sorts[input.sort], { id: "asc" as const }],
    select: {
      id: true,
      studentName: true,
      semester: true,
      year: true,
      score: true,
      totalTools: true,
      percentage: true,
      startedAt: true,
      submittedAt: true,
      timeSpentSeconds: true,
      status: true,
    },
  };
}
app.get("/api/professor/results", async (req, res) => {
  await expireAttempts();
  const rows = await db.attempt.findMany(resultQuery(req));
  const semesters = await db.attempt.findMany({
    distinct: ["semester", "year"],
    select: { semester: true, year: true },
  });
  semesters.sort(
    (a, b) =>
      b.year - a.year ||
      ["SPRING", "SUMMER", "FALL"].indexOf(b.semester) -
        ["SPRING", "SUMMER", "FALL"].indexOf(a.semester),
  );
  res.json({ rows, semesters });
});
app.get("/api/professor/results/export", async (req, res) => {
  await expireAttempts();
  const rows = await db.attempt.findMany(resultQuery(req));
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Quiz Results");
  sheet.columns = [
    "Student Name",
    "Semester",
    "Year",
    "Score",
    "Total",
    "Percentage",
    "Quiz Date",
    "Started At",
    "Submitted At",
    "Time Used",
  ].map((header) => ({ header, width: header.includes("At") ? 25 : 20 }));
  for (const r of rows)
    sheet.addRow([
      r.studentName,
      r.semester,
      r.year,
      r.score,
      r.totalTools,
      r.percentage,
      r.startedAt.toISOString().slice(0, 10),
      r.startedAt.toISOString(),
      r.submittedAt?.toISOString() || "",
      r.timeSpentSeconds === null
        ? ""
        : `${Math.floor(r.timeSpentSeconds / 60)
            .toString()
            .padStart(
              2,
              "0",
            )}:${(r.timeSpentSeconds % 60).toString().padStart(2, "0")}`,
    ]);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = "A1:J1";
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="quiz-results.xlsx"',
  );
  await workbook.xlsx.write(res);
  res.end();
});
app.get("/api/professor/results/:id", async (req, res) =>
  res.json(await attemptAction(req, "read")),
);
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "Endpoint not found." }),
);
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.resolve("client/dist")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.resolve("client/dist/index.html")),
  );
}
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError)
    return res
      .status(400)
      .json({
        error: err.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
  if (err instanceof HttpError)
    return res.status(err.status).json({ error: err.message });
  if (err instanceof multer.MulterError)
    return res
      .status(400)
      .json({
        error:
          err.code === "LIMIT_FILE_SIZE"
            ? "Logo must be 2 MB or smaller."
            : "Invalid upload. Upload one image, up to 2 MB.",
      });
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    ["P2002", "P2003", "P2025"].includes(err.code)
  )
    return res
      .status(err.code === "P2025" ? 404 : 409)
      .json({
        error:
          err.code === "P2025"
            ? "Record not found."
            : "This change conflicts with existing data. Category names must be unique.",
      });
  if (err instanceof SyntaxError)
    return res.status(400).json({ error: "Invalid JSON." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});
