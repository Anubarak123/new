import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
const db = new PrismaClient();
try {
  const initiallyEmpty = (await db.tool.count()) === 0;
  const username = process.env.PROFESSOR_USERNAME || "professor";
  const password = process.env.PROFESSOR_PASSWORD || "professor123";
  if (
    process.env.NODE_ENV === "production" &&
    (!process.env.PROFESSOR_PASSWORD || password === "professor123")
  )
    throw new Error(
      "Set a strong PROFESSOR_PASSWORD before seeding production.",
    );
  await db.professor.upsert({
    where: { username },
    update: {},
    create: {
      username,
      name: process.env.PROFESSOR_NAME || "Professor",
      passwordHash: await bcrypt.hash(password, 12),
    },
  });
  for (const [name, tools] of Object.entries({
    Communication: ["Zoom", "Microsoft Teams", "Google Meet"],
    Storage: ["OneDrive", "Dropbox", "Google Drive"],
    "Learning Management": ["Blackboard", "Canvas", "Moodle"],
  })) {
    let category = await db.category.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
    });
    if (!category) category = await db.category.create({ data: { name } });
    for (const toolName of tools)
      if (
        !(await db.tool.findFirst({
          where: { name: toolName, categoryId: category.id },
        }))
      )
        await db.tool.create({
          data: { name: toolName, categoryId: category.id },
        });
  }
  await db.quizSettings.upsert({
    where: { id: 1 },
    update: initiallyEmpty ? { toolsPerQuiz: 6, timeLimitSeconds: 180 } : {},
    create: { id: 1, toolsPerQuiz: 6, timeLimitSeconds: 180 },
  });
  console.log(
    "Professor and sample library ready. Existing passwords and configured nonempty libraries were preserved. Default credentials are DEVELOPMENT ONLY.",
  );
} finally {
  await db.$disconnect();
}
