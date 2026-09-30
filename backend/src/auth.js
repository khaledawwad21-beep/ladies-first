import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';

export async function hashPassword(password) {
  return bcrypt.hash(String(password), 12);
}

export async function verifyPassword(password, hash) {
  if (!hash) return false;
  return bcrypt.compare(String(password), String(hash));
}

export function signToken(payload, expiresIn = '7d') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export function createId() {
  return crypto.randomUUID();
}

export function authRequired(req, res, next) {
  try {
    const header = req.headers.authorization || '';

    const token = header.startsWith('Bearer ')
      ? header.slice(7)
      : '';

    if (!token) {
      return res.status(401).json({
        error: 'UNAUTHORIZED'
      });
    }

    req.auth = verifyToken(token);
    next();

  } catch {
    return res.status(401).json({
      error: 'INVALID_TOKEN'
    });
  }
}

export function adminOnly(req, res, next) {
  if (!req.auth?.is_admin) {
    return res.status(403).json({
      error: 'ADMIN_REQUIRED'
    });
  }

  if (req.auth.active === 0) {
    return res.status(403).json({
      error: 'ADMIN_DISABLED'
    });
  }

  next();
}

export function ownerOnly(req, res, next) {
  if (
    !req.auth?.is_admin ||
    Number(req.auth.is_owner) !== 1
  ) {
    return res.status(403).json({
      error: 'OWNER_REQUIRED'
    });
  }

  next();
}

export function hasPermission(auth, permission) {
  if (!auth?.is_admin) return false;

  if (Number(auth.is_owner) === 1) {
    return true;
  }

  const permissions = auth.permissions || {};

  return (
    permissions['*'] === true ||
    permissions[permission] === true
  );
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!hasPermission(req.auth, permission)) {
      return res.status(403).json({
        error: 'PERMISSION_DENIED',
        permission
      });
    }

    next();
  };
}

// Compatibility aliases used by server.js
export const auth = authRequired;
export const id = createId;
