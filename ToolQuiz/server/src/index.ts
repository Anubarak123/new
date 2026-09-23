import { app } from "./app.js";
import { db } from "./db.js";
import { expireAttempts } from "./attempts.js";
await db.$connect();
const server = app.listen(Number(process.env.PORT || 3001), "0.0.0.0", () =>
  console.log(`ToolQuiz listening on ${process.env.PORT || 3001}`),
);
let expiring = false;
const timer = setInterval(async () => {
  if (expiring) return;
  expiring = true;
  try {
    await expireAttempts();
  } catch (error) {
    console.error(error);
  } finally {
    expiring = false;
  }
}, 1000);
async function shutdown() {
  clearInterval(timer);
  server.close();
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
