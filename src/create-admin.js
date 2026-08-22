import "dotenv/config";
import readline from "node:readline/promises";
import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { hashPassword } from "./auth.js";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log("=== Создание администратора Skdsh Panel ===\n");

const username = (await rl.question("Логин: ")).trim().toLowerCase();
const password = await rl.question("Пароль: ");

rl.close();

if (!username || !password || password.length < 6) {
  console.error("Логин обязателен, пароль — не короче 6 символов.");
  process.exit(1);
}

const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
if (exists) {
  console.error(`Пользователь "${username}" уже существует.`);
  process.exit(1);
}

db.prepare(
  "INSERT INTO users (id, username, password_hash, role, display_name) VALUES (?, ?, ?, 'admin', ?)"
).run(randomUUID(), username, hashPassword(password), username);

console.log(`\n✓ Админ "${username}" создан.`);
