const attempts = new Map();

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;

function keyFor(req) {
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  const username = (req.body?.username || "").toLowerCase();
  return `${ip}:${username}`;
}

export function loginRateLimit(req, res, next) {
  const key = keyFor(req);
  const entry = attempts.get(key);
  const now = Date.now();

  if (entry?.blockedUntil && entry.blockedUntil > now) {
    const minutesLeft = Math.ceil((entry.blockedUntil - now) / 60000);
    return res.status(429).json({
      error: `Слишком много попыток входа. Попробуйте снова через ${minutesLeft} мин.`,
    });
  }

  next();
}

export function recordFailedAttempt(req) {
  const key = keyFor(req);
  const now = Date.now();
  const entry = attempts.get(key) || { count: 0, firstAttempt: now };

  if (now - entry.firstAttempt > WINDOW_MS) {
    entry.count = 0;
    entry.firstAttempt = now;
  }

  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.blockedUntil = now + BLOCK_MS;
  }
  attempts.set(key, entry);
}

export function clearAttempts(req) {
  attempts.delete(keyFor(req));
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts.entries()) {
    if ((entry.blockedUntil || 0) < now && now - entry.firstAttempt > WINDOW_MS) {
      attempts.delete(key);
    }
  }
}, 30 * 60 * 1000).unref();

const registerAttempts = new Map();
const REGISTER_MAX_ATTEMPTS = 10;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;
const REGISTER_BLOCK_MS = 60 * 60 * 1000;

export function registerRateLimit(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  const entry = registerAttempts.get(ip);
  const now = Date.now();

  if (entry?.blockedUntil && entry.blockedUntil > now) {
    return res.status(429).json({ error: "Слишком много попыток регистрации, попробуйте позже" });
  }

  if (!entry || now - entry.firstAttempt > REGISTER_WINDOW_MS) {
    registerAttempts.set(ip, { count: 1, firstAttempt: now });
  } else {
    entry.count += 1;
    if (entry.count >= REGISTER_MAX_ATTEMPTS) {
      entry.blockedUntil = now + REGISTER_BLOCK_MS;
    }
    registerAttempts.set(ip, entry);
  }

  next();
}
