import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";
import { router as authRouter } from "./routes/auth.js";
import { router as peersRouter } from "./routes/peers.js";
import { router as requestsRouter } from "./routes/requests.js";
import { router as serversRouter } from "./routes/servers.js";
import { startLimitEnforcer } from "./limitEnforcer.js";
import { startBackupJob } from "./backup.js";
import { startMonthlyReset } from "./monthlyReset.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.set("trust proxy", 1);
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (process.env.NODE_ENV !== "production" && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
      callback(new Error("Заблокировано CORS-политикой"));
    },
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api/peers", peersRouter);
app.use("/api/servers", serversRouter);
app.use("/api", requestsRouter);

const FRONTEND_DIST = path.resolve(__dirname, "../frontend/dist");
app.use(express.static(FRONTEND_DIST));
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(FRONTEND_DIST, "index.html"));
});

const port = process.env.PORT || 3001;
app.listen(port, "0.0.0.0", () => {
  console.log(`[server] Skdsh Panel listening on :${port}`);
  const adminExists = db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!adminExists) {
    console.warn(
      "[server] Админ не создан! Выполните: node src/create-admin.js"
    );
  }
  startLimitEnforcer();
  startBackupJob();
  startMonthlyReset();
});
