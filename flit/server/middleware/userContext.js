function normaliseUserId(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const safe = trimmed.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) return null;

  return safe.slice(0, 100);
}

export function requireUserContext(req, res, next) {
  const fromHeader = normaliseUserId(req.get('x-flit-user-id'));
  const fromBody = normaliseUserId(req.body?.userId);
  const fromQuery = normaliseUserId(req.query?.userId);

  let userId = fromHeader ?? fromBody ?? fromQuery;

  if (!userId && process.env.NODE_ENV !== 'production') {
    userId = normaliseUserId(process.env.DEFAULT_DEV_USER_ID) ?? 'dev-user-001';
  }

  if (!userId) {
    return res.status(401).json({
      error: 'Missing user context. Send x-flit-user-id header.',
    });
  }

  req.userId = userId;
  next();
}

export function optionalUserContext(req, _res, next) {
  const fromHeader = normaliseUserId(req.get('x-flit-user-id'));
  const fromBody = normaliseUserId(req.body?.userId);
  const fromQuery = normaliseUserId(req.query?.userId);

  req.userId = fromHeader ?? fromBody ?? fromQuery ?? null;
  next();
}