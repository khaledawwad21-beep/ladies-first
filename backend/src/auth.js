import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

const JWT_SECRET =
  process.env.JWT_SECRET || 'change-this-secret';

/* =========================================================
   PASSWORD
========================================================= */

export function hashPassword(password) {
  return bcrypt.hashSync(String(password), 12);
}

export function verifyPassword(password, hash) {
  if (!hash) return false;

  try {
    return bcrypt.compareSync(
      String(password),
      String(hash)
    );
  } catch {
    return false;
  }
}

/* =========================================================
   JWT
========================================================= */

export function signToken(payload, expiresIn = '7d') {
  return jwt.sign(
    payload,
    JWT_SECRET,
    { expiresIn }
  );
}

export function verifyToken(token) {
  return jwt.verify(
    token,
    JWT_SECRET
  );
}

/* =========================================================
   ID
========================================================= */

export function createId() {
  return crypto.randomUUID();
}

/* =========================================================
   USER HELPERS
========================================================= */

function getUser(req) {
  return req.auth || req.user || null;
}

function isOwner(user) {
  return Boolean(
    user &&
    (
      Number(user.is_owner) === 1 ||
      user.role === 'owner'
    )
  );
}

function isAdmin(user) {
  return Boolean(
    user &&
    (
      Number(user.is_admin) === 1 ||
      user.role === 'admin' ||
      user.role === 'owner' ||
      isOwner(user)
    )
  );
}

function isActive(user) {
  /*
    إذا active غير موجود بالتوكن القديم،
    نعتبره فعالًا.
  */
  if (
    user &&
    user.active !== undefined &&
    user.active !== null
  ) {
    return Number(user.active) !== 0;
  }

  return true;
}

/* =========================================================
   AUTHENTICATION
========================================================= */

export function auth(required = true) {
  return (req, res, next) => {
    try {
      const header =
        req.headers.authorization || '';

      const token =
        header.startsWith('Bearer ')
          ? header.slice(7).trim()
          : '';

      if (!token) {
        if (!required) {
          return next();
        }

        return res.status(401).json({
          error: 'UNAUTHORIZED'
        });
      }

      const decoded =
        verifyToken(token);

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

export function authRequired(
  req,
  res,
  next
) {
  return auth(true)(
    req,
    res,
    next
  );
}

/* =========================================================
   ADMIN ACCESS
========================================================= */

export function adminOnly(
  req,
  res,
  next
) {
  const user = getUser(req);

  if (!isAdmin(user)) {
    return res.status(403).json({
      error: 'ADMIN_REQUIRED'
    });
  }

  if (!isActive(user)) {
    return res.status(403).json({
      error: 'ADMIN_DISABLED'
    });
  }

  next();
}

/* =========================================================
   OWNER ACCESS
========================================================= */

export function ownerOnly(
  req,
  res,
  next
) {
  const user = getUser(req);

  if (!isAdmin(user)) {
    return res.status(403).json({
      error: 'OWNER_REQUIRED'
    });
  }

  if (!isOwner(user)) {
    return res.status(403).json({
      error: 'OWNER_REQUIRED'
    });
  }

  if (!isActive(user)) {
    return res.status(403).json({
      error: 'ADMIN_DISABLED'
    });
  }

  next();
}

/* =========================================================
   PERMISSIONS
========================================================= */

export function hasPermission(
  user,
  permission
) {
  if (!isAdmin(user)) {
    return false;
  }

  if (!isActive(user)) {
    return false;
  }

  /*
    المالك لديه جميع الصلاحيات.
  */
  if (isOwner(user)) {
    return true;
  }

  let permissions =
    user?.permissions || {};

  /*
    دعم permissions إذا وصلت كنص JSON
    من قاعدة البيانات أو JWT.
  */
  if (typeof permissions === 'string') {
    try {
      permissions =
        JSON.parse(permissions);
    } catch {
      permissions = {};
    }
  }

  if (
    !permissions ||
    typeof permissions !== 'object'
  ) {
    return false;
  }

  return (
    permissions['*'] === true ||
    permissions[permission] === true
  );
}

export function requirePermission(
  permission
) {
  return (req, res, next) => {
    const user =
      getUser(req);

    if (
      !hasPermission(
        user,
        permission
      )
    ) {
      return res.status(403).json({
        error: 'PERMISSION_DENIED',
        permission
      });
    }

    next();
  };
}

/* =========================================================
   COMPATIBILITY
========================================================= */

export const id = createId;
