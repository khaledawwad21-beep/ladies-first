import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';

/* =========================
   Password
========================= */

export function hashPassword(password) {
  return bcrypt.hashSync(String(password), 12);
}

export function verifyPassword(password, hash) {
  if (!hash) return false;

  try {
    return bcrypt.compareSync(String(password), String(hash));
  } catch {
    return false;
  }
}

/* =========================
   JWT
========================= */

export function signToken(payload, expiresIn = '7d') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/* =========================
   ID
========================= */

export function createId() {
  return crypto.randomUUID();
}

/* =========================
   Authentication
========================= */

export function auth(required = true) {
  return (req, res, next) => {
    try {
      const header = req.headers.authorization || '';

      const token = header.startsWith('Bearer ')
        ? header.slice(7)
        : '';

      if (!token) {
        if (!required) return next();

        return res.status(401).json({
          error: 'UNAUTHORIZED'
        });
      }

      const decoded = verifyToken(token);

      req.auth = decoded;
      req.user = decoded;

      next();

    } catch {
      if (!required) return next();

      return res.status(401).json({
        error: 'INVALID_TOKEN'
      });
    }
  };
}

export function authRequired(req, res, next) {
  return auth(true)(req, res, next);
}

/* =========================
   Admin
========================= */

export function adminOnly(req, res, next) {
  const user = req.auth || req.user;

  if (
    !user?.is_admin &&
    user?.role !== 'admin'
  ) {
    return res.status(403).json({
      error: 'ADMIN_REQUIRED'
    });
  }

  if (Number(user?.active) === 0) {
    return res.status(403).json({
      error: 'ADMIN_DISABLED'
    });
  }

  next();
}

/* =========================
   Owner
========================= */

export function ownerOnly(req, res, next) {
  const user = req.auth || req.user;

  if (
    !user?.is_admin &&
    user?.role !== 'admin'
  ) {
    return res.status(403).json({
      error: 'OWNER_REQUIRED'
    });
  }

  if (Number(user?.is_owner) !== 1) {
    return res.status(403).json({
      error: 'OWNER_REQUIRED'
    });
  }

  next();
}

/* =========================
   Permissions
========================= */

export function hasPermission(user, permission) {
  if (
    !user?.is_admin &&
    user?.role !== 'admin'
  ) {
    return false;
  }

  if (Number(user?.is_owner) === 1) {
    return true;
  }

  const permissions = user?.permissions || {};

  return (
    permissions['*'] === true ||
    permissions[permission] === true
  );
}

export function requirePermission(permission) {
  return (req, res, next) => {
    const user = req.auth || req.user;

    if (!hasPermission(user, permission)) {
      return res.status(403).json({
        error: 'PERMISSION_DENIED',
        permission
      });
    }

    next();
  };
}

/* =========================
   Compatibility
========================= */

export const id = createId;
