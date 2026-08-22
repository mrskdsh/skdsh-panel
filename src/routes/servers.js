import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

export const router = Router();

function h(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      console.error(`[servers] ${req.method} ${req.path} failed:`, e.message);
      res.status(500).json({ error: e.message || "Внутренняя ошибка сервера" });
    }
  };
}

const REQUIRED_FIELDS = [
  "name", "endpoint", "container", "configPath", "publicKey", "presharedKey",
  "jc", "jmin", "jmax", "s1", "s2", "s3", "s4", "h1", "h2", "h3", "h4",
  "subnetPrefix",
];

router.get(
  "/",
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    const servers = db.prepare("SELECT * FROM servers ORDER BY created_at").all();
    const withCounts = servers.map((s) => ({
      ...s,
      peerCount: db.prepare("SELECT COUNT(*) as c FROM peers WHERE server_id = ?").get(s.id).c,
    }));
    res.json(withCounts);
  })
);

router.post(
  "/",
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    const body = req.body || {};
    const missing = REQUIRED_FIELDS.filter((f) => !body[f]);
    if (missing.length) {
      return res.status(400).json({ error: `Не заполнены поля: ${missing.join(", ")}` });
    }

    const id = randomUUID();
    db.prepare(
      `INSERT INTO servers
       (id, name, endpoint, container, config_path, interface, public_key, preshared_key,
        jc, jmin, jmax, s1, s2, s3, s4, h1, h2, h3, h4, subnet_prefix, address_start, client_dns,
        ssh_host, ssh_user, ssh_key_path)
       VALUES (@id, @name, @endpoint, @container, @config_path, @interface, @public_key, @preshared_key,
        @jc, @jmin, @jmax, @s1, @s2, @s3, @s4, @h1, @h2, @h3, @h4, @subnet_prefix, @address_start, @client_dns,
        @ssh_host, @ssh_user, @ssh_key_path)`
    ).run({
      id,
      name: body.name,
      endpoint: body.endpoint,
      container: body.container,
      config_path: body.configPath,
      interface: body.interface || "awg0",
      public_key: body.publicKey,
      preshared_key: body.presharedKey,
      jc: body.jc,
      jmin: body.jmin,
      jmax: body.jmax,
      s1: body.s1,
      s2: body.s2,
      s3: body.s3,
      s4: body.s4,
      h1: body.h1,
      h2: body.h2,
      h3: body.h3,
      h4: body.h4,
      subnet_prefix: body.subnetPrefix,
      address_start: Number(body.addressStart || 2),
      client_dns: body.clientDns || "1.1.1.1",
      ssh_host: body.sshHost || null,
      ssh_user: body.sshUser || "root",
      ssh_key_path: body.sshKeyPath || null,
    });

    res.status(201).json({ id });
  })
);

router.patch(
  "/:id",
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    const server = db.prepare("SELECT * FROM servers WHERE id = ?").get(req.params.id);
    if (!server) return res.status(404).json({ error: "Не найден" });

    const fieldMap = {
      name: "name", endpoint: "endpoint", container: "container",
      configPath: "config_path", interface: "interface",
      publicKey: "public_key", presharedKey: "preshared_key",
      jc: "jc", jmin: "jmin", jmax: "jmax",
      s1: "s1", s2: "s2", s3: "s3", s4: "s4",
      h1: "h1", h2: "h2", h3: "h3", h4: "h4",
      subnetPrefix: "subnet_prefix", addressStart: "address_start",
      clientDns: "client_dns",
      sshHost: "ssh_host", sshUser: "ssh_user", sshKeyPath: "ssh_key_path",
    };

    const updates = {};
    for (const [bodyKey, col] of Object.entries(fieldMap)) {
      if (req.body[bodyKey] !== undefined) updates[col] = req.body[bodyKey];
    }
    if (Object.keys(updates).length === 0) {
      return res.json(server);
    }

    const setClause = Object.keys(updates).map((k) => `${k} = @${k}`).join(", ");
    db.prepare(`UPDATE servers SET ${setClause} WHERE id = @id`).run({ ...updates, id: server.id });

    res.json(db.prepare("SELECT * FROM servers WHERE id = ?").get(server.id));
  })
);

router.delete(
  "/:id",
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    const peerCount = db
      .prepare("SELECT COUNT(*) as c FROM peers WHERE server_id = ?")
      .get(req.params.id).c;
    if (peerCount > 0) {
      return res.status(400).json({
        error: `На сервере ещё ${peerCount} доступ(ов) — сначала перенесите или удалите их`,
      });
    }
    db.prepare("DELETE FROM servers WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  })
);
