import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { hashPassword } from "./auth.js";

const PSK = process.env.SERVER_PRESHARED_KEY;

const existingPeers = [
  { address: "10.8.1.1", publicKey: "Ja4kPKPxkBxJF+O6mIj9NvqqoHMplHZ+dacbGy5ILUA=", name: "Мой компьютер (Ilya)", username: "__ADMIN__" },
  { address: "10.8.1.2", publicKey: "+zfnsE9/vaKbff/MlB0oxoyX9S+0sHgm/1LhyRbDZkA=", name: "Ilya (Phone)", username: "__ADMIN__" },
  { address: "10.8.1.3", publicKey: "2e8rzbqQHsuq+fKa9DQ50up1sm/P1ZTLB3wqTJYiDkQ=", name: "Anna", username: "anna" },
  { address: "10.8.1.4", publicKey: "e40IdAUrFaVrmj3UPbENqpHHB+Ye5sEg4RBcQe7153E=", name: "Ivan", username: "ivan" },
  { address: "10.8.1.5", publicKey: "vmhB2+HZhKRjYMZHpTEHGuNxW43p0a4t1wC48G/egWY=", name: "Nikita", username: "nikita" },
  { address: "10.8.1.6", publicKey: "G/RKfVUAVA8ZtxHHZo476K2BMspSRLN7UNgPofmNLi8=", name: "Vika", username: "vika" },
  { address: "10.8.1.7", publicKey: "e+XA1x0tzS9ev22wDE/ow6RYW/u6RbpkZ6fPXfevnlU=", name: "Anna M.", username: "anna.m" },
  { address: "10.8.1.8", publicKey: "I1r4x4yXKmFRlJFcQkJLDwdX6sxCPAObQb/wgTkwRTw=", name: "Petya", username: "petya" },
  { address: "10.8.1.9", publicKey: "Vachtzbf6VTEdBcJAV/obXu6ClFU45GI7f8CDtoiziI=", name: "Sasha", username: "sasha" },
  { address: "10.8.1.10", publicKey: "l4w2T/U/OoMFjthLMaU+0wkDDat0mCjaaKONeUfQxxk=", name: "Vika PC", username: "vika" },
];

const count = db.prepare("SELECT COUNT(*) as c FROM peers").get().c;
if (count > 0) {
  console.log(`В базе уже есть ${count} пиров — прерываю, чтобы не задвоить.`);
  process.exit(1);
}

const passwords = {
  anna: "cICqblB91Unj",
  ivan: "4mVelWQurB8R",
  nikita: "sXknwnF44Jth",
  vika: "GmOQeAgQkHeV",
  "anna.m": "OmtlDmtboE21",
  petya: "hYFV5WjDPXjR",
  sasha: "ATmrOVrCjGXM",
};

function getAdminId() {
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!admin) {
    console.error("Админ ещё не создан! Сначала выполните: node src/create-admin.js");
    process.exit(1);
  }
  return admin.id;
}

function getOrCreateUser(username, displayName) {
  if (username === "__ADMIN__") return getAdminId();
  if (!username) return null;
  let user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user) {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO users (id, username, password_hash, role, display_name) VALUES (?, ?, ?, 'client', ?)"
    ).run(id, username, hashPassword(passwords[username] || "changeme123"), displayName);
    user = { id };
    console.log(`  ✓ создан логин "${username}"`);
  }
  return user.id;
}

for (const p of existingPeers) {
  const ownerId = getOrCreateUser(p.username, p.name.replace(/\s*\(.*\)/, ""));
  db.prepare(
    `INSERT INTO peers (id, name, public_key, private_key, preshared_key, address, owner_id)
     VALUES (?, ?, ?, NULL, ?, ?, ?)`
  ).run(randomUUID(), p.name, p.publicKey, PSK, p.address, ownerId);
  console.log(`✓ ${p.name} (${p.address})`);
}

console.log("\nГотово. Логины для новых людей (пароли — как были раньше, менять не нужно):");
console.log("  Мой компьютер / Ilya (Phone) — привязаны к вашему будущему admin-аккаунту вручную");
