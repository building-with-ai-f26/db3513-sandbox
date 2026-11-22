const BUSY_MESSAGE = 'The app is busy right now. Try again later.';
const TOO_MANY_MESSAGE = "You've made a lot of requests. Try again later.";
// Past this many visitors, expired entries are swept so the map can't grow without limit.
const MAX_TRACKED_VISITORS = 10000;

// One counter for the whole app, which caps the load no matter who is sending.
function limitRequests(maxRequests, windowMs) {
  let windowStart = 0;
  let count = 0;

  return (req, res, next) => {
    const now = Date.now();
    if (now - windowStart >= windowMs) {
      windowStart = now;
      count = 0;
    }
    count += 1;
    if (count > maxRequests) {
      res.status(429).json({ error: BUSY_MESSAGE });
      return;
    }
    next();
  };
}

// One counter per visitor (by IP address), so one person can't use up the app-wide limit for everyone.
// On Render the IP comes from X-Forwarded-For, which works because the server sets 'trust proxy'.
function limitPerVisitor(maxRequests, windowMs) {
  const visitors = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const entry = visitors.get(req.ip);
    if (!entry || now - entry.windowStart >= windowMs) {
      visitors.set(req.ip, { windowStart: now, count: 1 });
    } else {
      entry.count += 1;
      if (entry.count > maxRequests) {
        res.status(429).json({ error: TOO_MANY_MESSAGE });
        return;
      }
    }
    if (visitors.size > MAX_TRACKED_VISITORS) {
      for (const [ip, { windowStart }] of visitors) {
        if (now - windowStart >= windowMs) visitors.delete(ip);
      }
    }
    next();
  };
}

module.exports = { limitRequests, limitPerVisitor };
