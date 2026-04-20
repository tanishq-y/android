import express from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { createAuthUser, getAuthUserByEmail, getAuthUserById } from '../authStore.js';
import { requireAuthUser, signAuthToken } from '../middleware/auth.js';

const router = express.Router();

const registerSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(128),
});

function toPublicUser(user) {
  return {
    id: String(user?.id ?? ''),
    email: String(user?.email ?? '').toLowerCase(),
  };
}

router.post('/register', async (req, res) => {
  try {
    const body = registerSchema.parse(req.body ?? {});

    const existing = await getAuthUserByEmail(body.email);
    if (existing) {
      return res.status(409).json({ error: 'email_already_exists' });
    }

    const passwordHash = await bcrypt.hash(body.password, 12);
    const user = await createAuthUser({
      email: body.email,
      passwordHash,
    });

    const authUser = toPublicUser(user);
    const token = signAuthToken(authUser);

    return res.status(201).json({
      token,
      user: authUser,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        error: 'invalid_request',
        issues: err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    if (err?.code === 'email_already_exists') {
      return res.status(409).json({ error: 'email_already_exists' });
    }

    return res.status(500).json({ error: err?.message ?? 'register_failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const body = loginSchema.parse(req.body ?? {});

    const user = await getAuthUserByEmail(body.email);
    if (!user?.password_hash) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    const ok = await bcrypt.compare(body.password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    const authUser = toPublicUser(user);
    const token = signAuthToken(authUser);

    return res.json({ token, user: authUser });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        error: 'invalid_request',
        issues: err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    return res.status(500).json({ error: err?.message ?? 'login_failed' });
  }
});

router.post('/refresh', requireAuthUser, async (req, res) => {
  try {
    const user = await getAuthUserById(req.authUser.id);
    if (!user) {
      return res.status(401).json({ error: 'user_not_found' });
    }

    const authUser = toPublicUser(user);
    const token = signAuthToken(authUser);
    return res.json({ token });
  } catch (err) {
    return res.status(500).json({ error: err?.message ?? 'refresh_failed' });
  }
});

export default router;
