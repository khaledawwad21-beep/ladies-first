import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';

/* =========================
   Password helpers
========================= */

export async function hashPassword(password) {
  return bcrypt.hash(String(password), 12);
}

export async function verifyPassword(password, hash) {
  if (!hash) return false;
  return bcrypt.compare(String(password), String(hash));
}

/* =========================
   JWT helpers
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

/*
  auth()       = authentication required
  auth(false)  = authentication optional
*/

export function auth(required = true) {
  return (req, res, next) => {
    try {
      const header = req.headers.authorization || '';

      const token = header.startsWith('Bearer ')
        ? header.slice(7)
        : '';

      // No token
      if (!token) {
        if (!required) {
          return next();
        }

        return res.status(401).json({
          error: 'UNAUTHORIZED'
        });
      }

      const decoded = verifyToken(token);

      // Keep both names for compatibility
      req.auth = decoded;
      req.user = decoded;

      next();

    } catch {
      if (!required) {
        return next();
      }

      return res.status(401).json({
        error: 'INVALID_TOKEN'
      });
    }
  };
}

/* =========================
   Required auth compatibility
========================= */

export function authRequired(req, res, next) {
  return auth(true)(req, res, next);
}

/* =========================
   Admin / Owner
========================= */

export function adminOnly(req, res, next) {
  const authData = req.auth || req.user;

  if (
    !authData?.is_admin &&
    authData?.role !== 'admin'
  ) {
    return res.status(403).json({
      error: 'ADMIN_REQUIRED'
    });
  }

  if (Number(authData?.active) === 0) {
    return res.status(403).json({
      error: 'ADMIN_DISABLED'
    });
  }

  next();
}

export function ownerOnly(req, res, next) {
  const authData = req.auth || req.user;

  if (
    !authData?.is_admin &&
    authData?.role !== 'admin'
  ) {
    return res.status(403).json({
      error: 'OWNER_REQUIRED'
    });
  }

  if (Number(authData?.is_owner) !== 1) {
    return res.status(403).json({
      error: 'OWNER_REQUIRED'
    });
  }

  next();
}

/* =========================
   Permissions
========================= */

export function hasPermission(authData, permission) {
  if (
    !authData?.is_admin &&
    authData?.role !== 'admin'
  ) {
    return false;
  }

  if (Number(authData.is_owner) === 1) {
    return true;
  }

  const permissions = authData.permissions || {};

  return (
    permissions['*'] === true ||
    permissions[permission] === true
  );
}

export function requirePermission(permission) {
  return (req, res, next) => {
    const authData = req.auth || req.user;

    if (!hasPermission(authData, permission)) {
      return res.status(403).json({
        error: 'PERMISSION_DENIED',
        permission
      });
    }

    next();
  };
}

/* =========================
   Compatibility aliases
========================= */

export const id = createId;
