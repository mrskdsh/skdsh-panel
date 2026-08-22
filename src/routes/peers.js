import { Router } from "express";
import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { db } from "../db.js";
import * as awg from "../awg.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

export const router = Router();

function h(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      console.error(`[peers] ${req.method} ${req.path} failed:`, e.message);
      res.status(e.status || 500).json({ error: e.message || "Внутренняя ошибка сервера" });
    }
  };
}

function getServer(serverId) {
  const server = db.prepare("SELECT * FROM servers WHERE id = ?").get(serverId);
  if (!server) throw new Error("Сервер не найден");
  return server;
}

function resolveServerId(explicitId) {
  if (explicitId) return explicitId;
  const servers = db.prepare("SELECT id FROM servers").all();
  if (servers.length === 1) return servers[0].id;
  if (servers.length === 0) throw new Error("Нет ни одного добавленного сервера");
  throw new Error("Серверов несколько — укажите serverId явно");
}

async function withStats(peers) {
  const byServer = new Map();
  for (const p of peers) {
    if (!byServer.has(p.server_id)) byServer.set(p.server_id, []);
    byServer.get(p.server_id).push(p);
  }

  const statsByKey = {};
  for (const serverId of byServer.keys()) {
    try {
      const server = getServer(serverId);
      const stats = await awg.getPeerStats(server);
      for (const s of stats) statsByKey[s.publicKey] = s;
    } catch (e) {
      console.error(`[peers] failed to read stats for server ${serverId}:`, e.message);
    }
  }

  return peers.map((p) => {
    const live = statsByKey[p.public_key];
    const rx = live?.rxBytes ?? 0;
    const tx = live?.txBytes ?? 0;
    const usedBytes = Math.max(0, rx - p.base_rx) + Math.max(0, tx - p.base_tx);
    return {
      id: p.id,
      name: p.name,
      email: p.email,
      address: p.address,
      limitGB: p.limit_gb,
      blocked: Boolean(p.blocked),
      hasKeys: Boolean(p.private_key),
      ownerId: p.owner_id,
      serverId: p.server_id,
      createdAt: p.created_at,
      usedBytes,
      usedGB: +(usedBytes / 1024 / 1024 / 1024).toFixed(2),
      lastHandshake: live?.lastHandshake ?? null,
      online: live ? Date.now() / 1000 - live.lastHandshake < 180 : false,
    };
  });
}

function nextAddress(server) {
  const used = new Set(
    db
      .prepare("SELECT address FROM peers WHERE server_id = ?")
      .all(server.id)
      .map((r) => Number(r.address.split(".").pop()))
  );
  let n = server.address_start;
  while (used.has(n)) n++;
  return `${server.subnet_prefix}${n}`;
}

async function syncFromDb(serverId) {
  const server = getServer(serverId);
  const peers = db.prepare("SELECT * FROM peers WHERE server_id = ?").all(serverId);
  await awg.syncPeers(
    peers.map((p) => ({
      publicKey: p.public_key,
      presharedKey: p.preshared_key,
      address: p.address,
      blocked: Boolean(p.blocked),
    })),
    server
  );
}

function requirePeerWithKeys(peer) {
  if (!peer.private_key) {
    throw Object.assign(new Error("Для этого доступа нет сохранённого ключа"), { status: 409 });
  }
  return {
    peerArg: {
      privateKey: peer.private_key,
      presharedKey: peer.preshared_key,
      publicKey: peer.public_key,
      address: peer.address,
    },
    server: getServer(peer.server_id),
  };
}

router.get(
  "/",
  requireAuth,
  h(async (req, res) => {
    let rows;
    if (req.user.role === "admin") {
      rows = req.query.serverId
        ? db.prepare("SELECT * FROM peers WHERE server_id = ?").all(req.query.serverId)
        : db.prepare("SELECT * FROM peers").all();
    } else {
      rows = db.prepare("SELECT * FROM peers WHERE owner_id = ?").all(req.user.id);
    }
    res.json(await withStats(rows));
  })
);

router.post(
  "/",
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    const { name, email, limitGB, ownerId, serverId: bodyServerId } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Имя обязательно" });
    }

    const serverId = resolveServerId(bodyServerId);
    const server = getServer(serverId);

    const { privateKey, publicKey } = await awg.generateKeypair(server);
    const presharedKey = server.preshared_key;
    const address = nextAddress(server);
    const id = randomUUID();

    db.prepare(
      `INSERT INTO peers (id, name, email, public_key, private_key, preshared_key, address, limit_gb, owner_id, server_id)
       VALUES (@id, @name, @email, @publicKey, @privateKey, @presharedKey, @address, @limitGB, @ownerId, @serverId)`
    ).run({
      id,
      name: name.trim(),
      email: email || null,
      publicKey,
      privateKey,
      presharedKey,
      address,
      limitGB: limitGB ?? null,
      ownerId: ownerId || null,
      serverId,
    });

    await syncFromDb(serverId);
    res.status(201).json({ id, name: name.trim(), address, serverId });
  })
);

router.get(
  "/:id",
  requireAuth,
  h(async (req, res) => {
    const peer = db.prepare("SELECT * FROM peers WHERE id = ?").get(req.params.id);
    if (!peer) return res.status(404).json({ error: "Не найден" });
    if (req.user.role !== "admin" && peer.owner_id !== req.user.id) {
      return res.status(403).json({ error: "Нет доступа" });
    }
    const [result] = await withStats([peer]);
    res.json(result);
  })
);

router.get(
  "/:id/config",
  requireAuth,
  h(async (req, res) => {
    const peer = db.prepare("SELECT * FROM peers WHERE id = ?").get(req.params.id);
    if (!peer) return res.status(404).json({ error: "Не найден" });
    if (req.user.role !== "admin" && peer.owner_id !== req.user.id) {
      return res.status(403).json({ error: "Нет доступа" });
    }
    const { peerArg, server } = requirePeerWithKeys(peer);
    res.json({ config: awg.buildClientConfig(peerArg, server) });
  })
);

router.get(
  "/:id/qr",
  requireAuth,
  h(async (req, res) => {
    const peer = db.prepare("SELECT * FROM peers WHERE id = ?").get(req.params.id);
    if (!peer) return res.status(404).json({ error: "Не найден" });
    if (req.user.role !== "admin" && peer.owner_id !== req.user.id) {
      return res.status(403).json({ error: "Нет доступа" });
    }
    const { peerArg, server } = requirePeerWithKeys(peer);
    const config = awg.buildClientConfig(peerArg, server);
    const dataUrl = await QRCode.toDataURL(config, { margin: 1, width: 320 });
    res.json({ qr: dataUrl });
  })
);

router.get(
  "/:id/vpn-link",
  requireAuth,
  h(async (req, res) => {
    const peer = db.prepare("SELECT * FROM peers WHERE id = ?").get(req.params.id);
    if (!peer) return res.status(404).json({ error: "Не найден" });
    if (req.user.role !== "admin" && peer.owner_id !== req.user.id) {
      return res.status(403).json({ error: "Нет доступа" });
    }
    const { peerArg, server } = requirePeerWithKeys(peer);
    res.json({ link: awg.buildAmneziaVpnLink(peerArg, server) });
  })
);

router.get(
  "/:id/vpn-link/qr",
  requireAuth,
  h(async (req, res) => {
    const peer = db.prepare("SELECT * FROM peers WHERE id = ?").get(req.params.id);
    if (!peer) return res.status(404).json({ error: "Не найден" });
    if (req.user.role !== "admin" && peer.owner_id !== req.user.id) {
      return res.status(403).json({ error: "Нет доступа" });
    }
    const { peerArg, server } = requirePeerWithKeys(peer);
    const link = awg.buildAmneziaVpnLink(peerArg, server);
    const dataUrl = await QRCode.toDataURL(link, { margin: 1, width: 320 });
    res.json({ qr: dataUrl });
  })
);

router.patch(
  "/:id",
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    const { limitGB, blocked, name, email, ownerId } = req.body;
    const peer = db.prepare("SELECT * FROM peers WHERE id = ?").get(req.params.id);
    if (!peer) return res.status(404).json({ error: "Не найден" });

    const patch = {
      limit_gb: limitGB !== undefined ? limitGB : peer.limit_gb,
      blocked: blocked !== undefined ? (blocked ? 1 : 0) : peer.blocked,
      name: name !== undefined ? name : peer.name,
      email: email !== undefined ? email : peer.email,
      owner_id: ownerId !== undefined ? ownerId : peer.owner_id,
    };

    db.prepare(
      "UPDATE peers SET limit_gb=@limit_gb, blocked=@blocked, name=@name, email=@email, owner_id=@owner_id WHERE id=@id"
    ).run({ ...patch, id: peer.id });

    if (blocked !== undefined) await syncFromDb(peer.server_id);

    res.json(db.prepare("SELECT * FROM peers WHERE id = ?").get(req.params.id));
  })
);

router.post(
  "/:id/reset-usage",
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    const peer = db.prepare("SELECT * FROM peers WHERE id = ?").get(req.params.id);
    if (!peer) return res.status(404).json({ error: "Не найден" });

    const server = getServer(peer.server_id);
    const stats = await awg.getPeerStats(server);
    const live = stats.find((s) => s.publicKey === peer.public_key);
    db.prepare("UPDATE peers SET base_rx=?, base_tx=? WHERE id=?").run(
      live?.rxBytes ?? 0,
      live?.txBytes ?? 0,
      peer.id
    );
    res.json({ ok: true });
  })
);

router.post(
  "/resync",
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    const serverId = resolveServerId(req.body?.serverId);
    await syncFromDb(serverId);
    res.json({ ok: true });
  })
);

router.delete(
  "/:id",
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    const peer = db.prepare("SELECT * FROM peers WHERE id = ?").get(req.params.id);
    if (!peer) return res.status(404).json({ error: "Не найден" });

    db.prepare("DELETE FROM peers WHERE id = ?").run(req.params.id);
    await syncFromDb(peer.server_id);

    res.json({ ok: true });
  })
);
