import cron from "node-cron";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || path.resolve("data");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const DB_PATH = path.join(DATA_DIR, "panel.db");
const KEEP_DAYS = 14;

function runBackup() {
  if (!fs.existsSync(DB_PATH)) return;
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp = new Date().toISOString().slice(0, 10);
  const dest = path.join(BACKUP_DIR, `panel-${stamp}.db`);
  fs.copyFileSync(DB_PATH, dest);
  console.log(`[backup] saved ${dest}`);

  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  for (const file of fs.readdirSync(BACKUP_DIR)) {
    const full = path.join(BACKUP_DIR, file);
    const stat = fs.statSync(full);
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(full);
      console.log(`[backup] removed old backup ${file}`);
    }
  }
}

export function startBackupJob() {
  cron.schedule("0 4 * * *", runBackup);
  console.log("[backup] scheduled daily at 04:00, keeping last", KEEP_DAYS, "days");

  runBackup();
}
