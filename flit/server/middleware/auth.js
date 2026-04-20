import jwt from 'jsonwebtoken';

const DEV_FALLBACK_JWT_SECRET = 'flit-dev-jwt-secret-change-me';

function getJwtSecret() {
  const configured = String(process.env.JWT_SECRET ?? '').trim();
  if (configured) {
    return configured;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }

  return DEV_FALLBACK_JWT_SECRET;
}

function getJwtExpiry() {
  const configured = String(process.env.JWT_EXPIRES_IN ?? '').trim();
  return configured || '7d';
}

function extractBearerToken(req) {
  const header = String(req.get('Authorization') ?? req.get('authorization') ?? '').trim();
  if (!header) return null;

  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const token = String(match[1] ?? '').trim();
  return token || null;
}

function toAuthUser(payload) {
  const id = String(payload?.sub ?? '').trim();
  if (!id) {
    return null;
  }

  const email = String(payload?.email ?? '').trim().toLowerCase();

  return {
    id,
    email: email || null,
  };
}

export function signAuthToken(user) {
  const subject = String(user?.id ?? '').trim();
  if (!subject) {
    throw new Error('Cannot sign token without user id');
  }

  const email = String(user?.email ?? '').trim().toLowerCase();

  return jwt.sign(
    {
      sub: subject,
      email: email || undefined,
    },
    getJwtSecret(),
    {
      expiresIn: getJwtExpiry(),
    }
  );
}

export function optionalAuthUser(req, _res, next) {
  const token = extractBearerToken(req);
  if (!token) {
    req.authUser = null;
    req.authError = null;
    return next();
  }

  try {
    const payload = jwt.verify(token, getJwtSecret());
    const authUser = toAuthUser(payload);

    if (!authUser) {
      req.authUser = null;
      req.authError = 'invalid_token_payload';
      return next();
    }

    req.authUser = authUser;
    req.authError = null;
    req.userId = authUser.id;
    return next();
  } catch (err) {
    req.authUser = null;
    req.authError = err?.name === 'TokenExpiredError' ? 'token_expired' : 'invalid_token';
    return next();
  }
}

export function requireAuthUser(req, res, next) {
  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing Bearer token' });
  }

  try {
    const payload = jwt.verify(token, getJwtSecret());
    const authUser = toAuthUser(payload);

    if (!authUser) {
      return res.status(401).json({ error: 'Invalid token payload' });
    }

    req.authUser = authUser;
    req.authError = null;
    req.userId = authUser.id;
    return next();
  } catch (err) {
    const error = err?.name === 'TokenExpiredError' ? 'token_expired' : 'invalid_token';
    return res.status(401).json({ error });
  }
}
