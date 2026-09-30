import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import crypto from 'node:crypto';
import multer from 'multer';

import { db, migrate } from './db.js';
import {
  auth,
  adminOnly,
  ownerOnly,
  hasPermission,
  hashPassword,
  verifyPassword,
  signToken,
  id
} from './auth.js';

migrate();

const app = express();

const __dirname =
  path.dirname(fileURLToPath(import.meta.url));

const siteRoot =
  path.resolve(__dirname,'..','..');

app.set('trust proxy',1);

app.use(
  helmet({
    contentSecurityPolicy:false
  })
);

const allowedOrigins =
  (process.env.CORS_ORIGIN||'')
    .split(',')
    .map(x=>x.trim())
    .filter(Boolean);

app.use(
  cors({
    origin:(origin,cb)=>{
      if(
        !origin ||
        !allowedOrigins.length ||
        allowedOrigins.includes(origin)
      ){
        return cb(null,true);
      }

      cb(new Error('CORS_ORIGIN_DENIED'));
    }
  })
);

app.use(
  express.json({
    limit:'8mb'
  })
);

const uploadsDir =
  path.join(
    siteRoot,
    'backend',
    'data',
    'uploads'
  );

fs.mkdirSync(
  uploadsDir,
  {
    recursive:true
  }
);

const upload =
  multer({
    dest:uploadsDir,
    limits:{
      fileSize:10*1024*1024
    },
    fileFilter:(req,file,cb)=>{
      cb(
        null,
        /^image\/(jpeg|png|webp|gif|avif)$/
          .test(file.mimetype)
      );
    }
  });

app.use(
  '/uploads',
  express.static(
    uploadsDir,
    {
      maxAge:'30d',
      immutable:true
    }
  )
);

app.use(
  express.static(
    siteRoot,
    {
      extensions:['html'],
      index:'index.html',
      maxAge:
        process.env.NODE_ENV==='production'
          ?'1d'
          :0
    }
  )
);


// ============================================================
// BASIC HELPERS
// ============================================================

const now=()=>new Date().toISOString();

function safeJson(value,fallback){
  try{
    if(
      value===null ||
      value===undefined ||
      value===''
    ){
      return fallback;
    }

    return JSON.parse(value);
  }catch{
    return fallback;
  }
}


// ============================================================
// RATE LIMIT
// ============================================================

const rateBuckets=new Map();

function rateLimit({
  windowMs=60000,
  max=120
}={}){
  return (req,res,next)=>{
    const key=
      `${req.ip}:${req.path}`;

    const t=Date.now();

    let bucket=
      rateBuckets.get(key);

    if(
      !bucket ||
      t-bucket.start>windowMs
    ){
      bucket={
        start:t,
        count:0
      };
    }

    bucket.count++;

    rateBuckets.set(
      key,
      bucket
    );

    if(bucket.count>max){
      return res.status(429).json({
        error:'RATE_LIMITED'
      });
    }

    next();
  };
}

app.use(
  '/api/auth/',
  rateLimit({
    windowMs:60000,
    max:30
  })
);

app.use(
  '/api/orders',
  rateLimit({
    windowMs:60000,
    max:30
  })
);


// ============================================================
// PRODUCT VARIANT INPUT
// ============================================================

const productVariantInput =
  z.object({
    id:z.string().optional(),

    color:
      z.string()
        .optional()
        .default(''),

    size:
      z.string()
        .optional()
        .default(''),

    sku:
      z.string()
        .optional()
        .default(''),

    stock:
      z.number()
        .int()
        .nonnegative()
        .optional()
        .default(0),

    images:
      z.array(z.string())
        .optional()
        .default([]),

    active:
      z.boolean()
        .optional()
        .default(true)
  });


// ============================================================
// PRODUCT INPUT
// ============================================================

const productInput =
  z.object({
    id:
      z.string()
        .optional(),

    name:
      z.string()
        .min(1),

    description:
      z.string()
        .optional()
        .default(''),

    brand:
      z.string()
        .optional()
        .default(''),

    category:
      z.string()
        .optional()
        .default(''),

    price:
      z.number()
        .nonnegative(),

    old_price:
      z.number()
        .nonnegative()
        .nullable()
        .optional(),

    cost_price:
      z.number()
        .nonnegative()
        .optional()
        .default(0),

    stock:
      z.number()
        .int()
        .nonnegative()
        .optional()
        .default(0),

    images:
      z.array(z.string())
        .optional()
        .default([]),

    variants:
      z.array(
        z.object({
          name:z.string(),
          stock:
            z.number()
              .int()
              .nonnegative()
        })
      )
      .optional()
      .default([]),

    variantItems:
      z.array(productVariantInput)
        .optional()
        .default([]),

    active:
      z.boolean()
        .optional()
        .default(true),

    metadata:
      z.record(z.any())
        .optional()
        .default({})
  });


// ============================================================
// ORDER INPUT
// ============================================================

const orderInput =
  z.object({
    userId:
      z.string()
        .nullable()
        .optional(),

    customer:
      z.object({
        name:
          z.string()
            .min(1),

        contact:
          z.string()
            .min(3),

        address:
          z.string()
            .optional()
            .default(''),

        gender:
          z.string()
            .optional(),

        age:
          z.number()
            .int()
            .nullable()
            .optional()
      }),

    paymentMethod:
      z.string()
        .default('cod'),

    shipping:
      z.number()
        .nonnegative()
        .default(0),

    packaging:
      z.number()
        .nonnegative()
        .default(0),

    couponCode:
      z.string()
        .nullable()
        .optional(),

    pointsToRedeem:
      z.number()
        .int()
        .nonnegative()
        .optional()
        .default(0),

    items:
      z.array(
        z.object({
          productId:
            z.string(),

          variantId:
            z.string()
              .nullable()
              .optional(),

          variantName:
            z.string()
              .nullable()
              .optional(),

          color:
            z.string()
              .nullable()
              .optional(),

          size:
            z.string()
              .nullable()
              .optional(),

          quantity:
            z.number()
              .int()
              .positive()
        })
      )
      .min(1)
  });


// ============================================================
// PRODUCT HELPERS
// ============================================================

function getProductVariants(
  productId
){
  return db.prepare(`
    SELECT *
    FROM product_variants
    WHERE product_id=?
      AND active=1
    ORDER BY color,size
  `).all(productId);
}


function rowProduct(row){

  const metadata =
    safeJson(
      row.metadata_json,
      {}
    );

  const images =
    safeJson(
      row.images_json,
      []
    );

  const variantsLegacy =
    safeJson(
      row.variants_json,
      []
    );

  const variantItems =
    getProductVariants(row.id);

  return {
    ...row,

    ...metadata,

    images,

    variants:
      variantsLegacy,

    variantItems,

    active:
      !!row.active,

    images_json:
      undefined,

    variants_json:
      undefined,

    metadata_json:
      undefined
  };
}


function findVariant({
  productId,
  variantId,
  color,
  size
}){
  if(variantId){
    const byId=db.prepare(`
      SELECT *
      FROM product_variants
      WHERE id=?
        AND product_id=?
    `).get(
      variantId,
      productId
    );

    if(byId)return byId;
  }

  if(
    color!==undefined ||
    size!==undefined
  ){
    return db.prepare(`
      SELECT *
      FROM product_variants
      WHERE product_id=?
        AND color=?
        AND size=?
        AND active=1
      LIMIT 1
    `).get(
      productId,
      String(color||''),
      String(size||'')
    );
  }

  return null;
}


// ============================================================
// INVENTORY HELPERS
// ============================================================

function recordInventoryMovement({
  productId,
  variantId=null,
  color=null,
  size=null,
  beforeStock,
  afterStock,
  reason,
  source=null,
  referenceId=null
}){
  const before=
    Number(beforeStock||0);

  const after=
    Number(afterStock||0);

  const delta=
    after-before;

  db.prepare(`
    INSERT INTO inventory_movements(
      product_id,
      variant_id,
      color,
      size,
      before_stock,
      after_stock,
      delta,
      reason,
      source,
      reference_id,
      created_at
    )
    VALUES(?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    productId,
    variantId,
    color,
    size,
    before,
    after,
    delta,
    String(reason||'adjustment'),
    source,
    referenceId,
    now()
  );
}


function productTotalVariantStock(
  productId
){
  const row=db.prepare(`
    SELECT
      COALESCE(SUM(stock),0) AS total
    FROM product_variants
    WHERE product_id=?
      AND active=1
  `).get(productId);

  return Number(row?.total||0);
}


function syncProductStock(
  productId
){
  const total=
    productTotalVariantStock(
      productId
    );

  db.prepare(`
    UPDATE products
    SET
      stock=?,
      updated_at=?
    WHERE id=?
  `).run(
    total,
    now(),
    productId
  );

  return total;
}


function adjustVariantStock({
  variantId,
  delta,
  reason='adjustment',
  source=null,
  referenceId=null
}){
  const variant=db.prepare(`
    SELECT *
    FROM product_variants
    WHERE id=?
  `).get(variantId);

  if(!variant){
    throw new Error(
      'VARIANT_NOT_FOUND'
    );
  }

  const before=
    Number(variant.stock||0);

  const after=
    before+Number(delta||0);

  if(after<0){
    throw new Error(
      'INSUFFICIENT_STOCK'
    );
  }

  db.prepare(`
    UPDATE product_variants
    SET
      stock=?,
      updated_at=?
    WHERE id=?
  `).run(
    after,
    now(),
    variantId
  );

  recordInventoryMovement({
    productId:variant.product_id,
    variantId,
    color:variant.color,
    size:variant.size,
    beforeStock:before,
    afterStock:after,
    reason,
    source,
    referenceId
  });

  syncProductStock(
    variant.product_id
  );

  return {
    ...variant,
    before_stock:before,
    after_stock:after
  };
}


// ============================================================
// SETTINGS HELPER
// ============================================================

function getSetting(
  key,
  fallback
){
  const row=db.prepare(`
    SELECT value_json
    FROM store_settings
    WHERE key=?
  `).get(key);

  if(!row){
    return fallback;
  }

  try{
    return JSON.parse(
      row.value_json
    );
  }catch{
    return fallback;
  }
}


// ============================================================
// CART FINGERPRINT
// ============================================================

function cartFingerprint(
  items
){
  return JSON.stringify(
    (items||[])
      .map(x=>({
        productId:
          String(
            x.productId||''
          ),

        variantId:
          x.variantId||
          null,

        variantName:
          x.variantName||
          null,

        color:
          x.color||
          null,

        size:
          x.size||
          null,

        quantity:
          Number(
            x.quantity||0
          )
      }))
      .sort(
        (a,b)=>
          a.productId.localeCompare(
            b.productId
          ) ||
          String(a.variantId||'')
            .localeCompare(
              String(b.variantId||'')
            )
      )
  );
}


// ============================================================
// HEALTH
// ============================================================

app.get(
  '/api/health',
  (req,res)=>{
    res.json({
      ok:true,
      time:now()
    });
  }
);
// ============================================================
// PART 2 — SETTINGS / AUTH / USERS / CART / LOYALTY
// PUBLIC PRODUCTS / PRODUCT DETAIL / IMAGE UPLOAD / WAITLIST
// ============================================================

// ------------------------------------------------------------
// SETTINGS
// ------------------------------------------------------------

app.get('/api/settings',(req,res)=>{
  try{
    const rows=db.prepare(`
      SELECT key,value_json
      FROM store_settings
    `).all();

    const settings={};

    for(const row of rows){
      settings[row.key]=safeJson(
        row.value_json,
        null
      );
    }

    res.json(settings);
  }catch(e){
    res.status(500).json({
      error:'SETTINGS_FAILED'
    });
  }
});


app.get(
  '/api/admin/settings',
  auth(),
  adminOnly,
  (req,res)=>{
    try{
      const rows=db.prepare(`
        SELECT key,value_json
        FROM store_settings
        ORDER BY key
      `).all();

      const settings={};

      for(const row of rows){
        settings[row.key]=safeJson(
          row.value_json,
          null
        );
      }

      res.json(settings);
    }catch(e){
      res.status(500).json({
        error:'ADMIN_SETTINGS_FAILED'
      });
    }
  }
);


app.patch(
  '/api/admin/settings',
  auth(),
  adminOnly,
  (req,res)=>{
    try{
      const entries=
        Object.entries(
          req.body||{}
        );

      const statement=db.prepare(`
        INSERT INTO store_settings(
          key,
          value_json,
          updated_at
        )
        VALUES(?,?,?)
        ON CONFLICT(key)
        DO UPDATE SET
          value_json=excluded.value_json,
          updated_at=excluded.updated_at
      `);

      const transaction=db.transaction(()=>{
        for(
          const [key,value]
          of entries
        ){
          statement.run(
            String(key),
            JSON.stringify(value),
            now()
          );
        }
      });

      transaction();

      res.json({
        ok:true
      });
    }catch(e){
      res.status(500).json({
        error:'SETTINGS_UPDATE_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// REGISTER
// ------------------------------------------------------------

app.post(
  '/api/auth/register',
  async(req,res)=>{
    try{
      const name=
        String(
          req.body.name||''
        ).trim();

      const email=
        String(
          req.body.email||''
        ).trim()
        .toLowerCase();

      const password=
        String(
          req.body.password||''
        );

      const phone=
        String(
          req.body.phone||''
        ).trim();

      if(
        !name ||
        !email ||
        !password
      ){
        return res.status(400).json({
          error:'REGISTER_FIELDS_REQUIRED'
        });
      }

      const exists=db.prepare(`
        SELECT id
        FROM users
        WHERE LOWER(email)=?
        LIMIT 1
      `).get(email);

      if(exists){
        return res.status(409).json({
          error:'EMAIL_EXISTS'
        });
      }

      const userId=id();
      const passwordHash=
        await hashPassword(password);

      db.prepare(`
        INSERT INTO users(
          id,
          name,
          email,
          password_hash,
          phone,
          gender,
          age,
          points,
          is_admin,
          role,
          created_at
        )
        VALUES(?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        userId,
        name,
        email,
        passwordHash,
        phone,
        req.body.gender||
          null,
        req.body.age===undefined?
          null:
          Number(req.body.age),
        0,
        0,
        'user',
        now()
      );

      const token=
        signToken({
          id:userId,
          userId,
          role:'user'
        });

      res.status(201).json({
        ok:true,
        token,
        user:{
          id:userId,
          name,
          email,
          phone,
          gender:req.body.gender||null,
          age:req.body.age??null,
          points:0,
          role:'user'
        }
      });
    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'REGISTER_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// OWNER SETUP
// ------------------------------------------------------------

app.get(
  '/api/setup/status',
  (req,res)=>{
    try{
      const row=db.prepare(`
        SELECT COUNT(*) AS c
        FROM admin_users
      `).get();

      res.json({
        setupRequired:
          Number(row?.c||0)===0
      });
    }catch(e){
      res.status(500).json({
        error:'SETUP_STATUS_FAILED'
      });
    }
  }
);


app.post(
  '/api/setup/owner',
  async(req,res)=>{
    try{
      const count=db.prepare(`
        SELECT COUNT(*) AS c
        FROM admin_users
      `).get();

      if(Number(count?.c||0)>0){
        return res.status(409).json({
          error:'OWNER_ALREADY_EXISTS'
        });
      }

      const email=
        String(
          req.body.email||''
        ).trim()
        .toLowerCase();

      const password=
        String(
          req.body.password||''
        );

      const name=
        String(
          req.body.name||
          'Owner'
        ).trim();

      if(!email || !password){
        return res.status(400).json({
          error:'OWNER_FIELDS_REQUIRED'
        });
      }

      const adminId=id();

      const passwordHash=
        await hashPassword(password);

      db.prepare(`
        INSERT INTO admin_users(
          id,
          name,
          email,
          password_hash,
          role,
          active,
          created_at
        )
        VALUES(?,?,?,?,?,?,?)
      `).run(
        adminId,
        name,
        email,
        passwordHash,
        'owner',
        1,
        now()
      );

      const token=
        signToken({
          id:adminId,
          adminId,
          role:'owner'
        });

      res.status(201).json({
        ok:true,
        token
      });
    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'OWNER_SETUP_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// ADMIN LOGIN
// ------------------------------------------------------------

app.post(
  '/api/admin/login',
  async(req,res)=>{
    try{
      const email=
        String(
          req.body.email||''
        ).trim()
        .toLowerCase();

      const password=
        String(
          req.body.password||''
        );

      const admin=db.prepare(`
        SELECT *
        FROM admin_users
        WHERE LOWER(email)=?
          AND active=1
        LIMIT 1
      `).get(email);

      if(!admin){
        return res.status(401).json({
          error:'INVALID_CREDENTIALS'
        });
      }

      const valid=
        await verifyPassword(
          password,
          admin.password_hash
        );

      if(!valid){
        return res.status(401).json({
          error:'INVALID_CREDENTIALS'
        });
      }

      const token=
        signToken({
          id:admin.id,
          adminId:admin.id,
          role:admin.role||'admin'
        });

      res.json({
        ok:true,
        token,
        admin:{
          id:admin.id,
          name:admin.name,
          email:admin.email,
          role:admin.role
        }
      });
    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'ADMIN_LOGIN_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// CUSTOMER LOGIN
// ------------------------------------------------------------

app.post(
  '/api/auth/login',
  async(req,res)=>{
    try{
      const email=
        String(
          req.body.email||''
        ).trim()
        .toLowerCase();

      const password=
        String(
          req.body.password||''
        );

      const user=db.prepare(`
        SELECT *
        FROM users
        WHERE LOWER(email)=?
        LIMIT 1
      `).get(email);

      if(!user){
        return res.status(401).json({
          error:'INVALID_CREDENTIALS'
        });
      }

      const valid=
        await verifyPassword(
          password,
          user.password_hash
        );

      if(!valid){
        return res.status(401).json({
          error:'INVALID_CREDENTIALS'
        });
      }

      const token=
        signToken({
          id:user.id,
          userId:user.id,
          role:user.role||'user'
        });

      res.json({
        ok:true,
        token,
        user:{
          id:user.id,
          name:user.name,
          email:user.email,
          phone:user.phone,
          gender:user.gender,
          age:user.age,
          points:user.points||0,
          role:user.role||'user'
        }
      });
    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'LOGIN_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// CURRENT USER
// ------------------------------------------------------------

app.get(
  '/api/me',
  auth(false),
  (req,res)=>{
    try{
      if(!req.user){
        return res.json({
          user:null
        });
      }

      const user=db.prepare(`
        SELECT
          id,
          name,
          email,
          phone,
          gender,
          age,
          points,
          is_admin,
          role,
          created_at
        FROM users
        WHERE id=?
      `).get(req.user.id);

      if(!user){
        return res.json({
          user:null
        });
      }

      res.json({
        user
      });
    }catch(e){
      res.status(500).json({
        error:'ME_FAILED'
      });
    }
  }
);


app.patch(
  '/api/me',
  auth(),
  (req,res)=>{
    try{
      const user=db.prepare(`
        SELECT *
        FROM users
        WHERE id=?
      `).get(req.user.id);

      if(!user){
        return res.status(404).json({
          error:'USER_NOT_FOUND'
        });
      }

      const name=
        req.body.name!==undefined?
        String(req.body.name||'').trim():
        user.name;

      const phone=
        req.body.phone!==undefined?
        String(req.body.phone||'').trim():
        user.phone;

      const gender=
        req.body.gender!==undefined?
        String(req.body.gender||'').trim():
        user.gender;

      const age=
        req.body.age!==undefined?
        (
          req.body.age===null ||
          req.body.age===''?
          null:
          Number(req.body.age)
        ):
        user.age;

      db.prepare(`
        UPDATE users
        SET
          name=?,
          phone=?,
          gender=?,
          age=?
        WHERE id=?
      `).run(
        name,
        phone,
        gender,
        age,
        req.user.id
      );

      res.json({
        ok:true
      });
    }catch(e){
      res.status(500).json({
        error:'ME_UPDATE_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// CART HEARTBEAT
// ------------------------------------------------------------

app.post(
  '/api/cart/heartbeat',
  auth(false),
  (req,res)=>{
    try{
      const items=
        Array.isArray(req.body.items)?
        req.body.items:
        [];

      const fingerprint=
        cartFingerprint(items);

      if(req.user){
        try{
          db.prepare(`
            UPDATE users
            SET cart_fingerprint=?
            WHERE id=?
          `).run(
            fingerprint,
            req.user.id
          );
        }catch{}
      }

      res.json({
        ok:true,
        fingerprint
      });
    }catch(e){
      res.status(500).json({
        error:'CART_HEARTBEAT_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// LOYALTY
// ------------------------------------------------------------

app.get(
  '/api/loyalty',
  auth(),
  (req,res)=>{
    try{
      const user=db.prepare(`
        SELECT
          points,
          name
        FROM users
        WHERE id=?
      `).get(req.user.id);

      const points=
        Number(user?.points||0);

      const pointValue=
        Number(
          getSetting(
            'point_value',
            1
          )
        )||1;

      res.json({
        points,
        point_value:pointValue,
        value:points*pointValue
      });
    }catch(e){
      res.status(500).json({
        error:'LOYALTY_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// CUSTOMER ORDERS
// ------------------------------------------------------------

app.get(
  '/api/my/orders',
  auth(),
  (req,res)=>{
    try{
      const rows=db.prepare(`
        SELECT *
        FROM orders
        WHERE user_id=?
        ORDER BY created_at DESC
      `).all(req.user.id);

      res.json(
        rows.map(row=>({
          ...row,
          items:safeJson(
            row.items_json,
            []
          ),
          shipping:safeJson(
            row.shipping_json,
            {}
          ),
          payment:safeJson(
            row.payment_json,
            {}
          ),
          totals:safeJson(
            row.totals_json,
            {}
          )
        }))
      );
    }catch(e){
      res.status(500).json({
        error:'MY_ORDERS_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// PUBLIC PRODUCTS
// ------------------------------------------------------------

app.get(
  '/api/products',
  (req,res)=>{
    try{
      const rows=db.prepare(`
        SELECT *
        FROM products
        WHERE COALESCE(active,1)=1
        ORDER BY created_at DESC
      `).all();

      res.json(
        rows.map(rowProduct)
      );
    }catch(e){
      res.status(500).json({
        error:'PRODUCTS_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// PRODUCT DETAIL
// ------------------------------------------------------------

app.get(
  '/api/products/:id',
  (req,res)=>{
    try{
      const row=db.prepare(`
        SELECT *
        FROM products
        WHERE id=?
          AND COALESCE(active,1)=1
        LIMIT 1
      `).get(req.params.id);

      if(!row){
        return res.status(404).json({
          error:'PRODUCT_NOT_FOUND'
        });
      }

      res.json(
        rowProduct(row)
      );
    }catch(e){
      res.status(500).json({
        error:'PRODUCT_DETAIL_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// IMAGE UPLOAD
// ------------------------------------------------------------

app.post(
  '/api/admin/uploads/image',
  auth(),
  adminOnly,
  upload.single('image'),
  (req,res)=>{
    try{
      if(!req.file){
        return res.status(400).json({
          error:'INVALID_IMAGE'
        });
      }

      const ext={
        'image/jpeg':'jpg',
        'image/png':'png',
        'image/webp':'webp',
        'image/gif':'gif',
        'image/avif':'avif'
      }[
        req.file.mimetype
      ]||'bin';

      const final=
        `${req.file.filename}.${ext}`;

      fs.renameSync(
        req.file.path,
        path.join(
          uploadsDir,
         final
        )
      );

      res.status(201).json({
        url:`/uploads/${final}`
      });
    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'IMAGE_UPLOAD_FAILED'
        });
    }
  }
);
// ============================================================
// PART 3A — WAITLIST / FEATURED / ADMIN PRODUCTS
// PRODUCT VARIANTS / INVENTORY
// ============================================================

// ------------------------------------------------------------
// WAITLIST
// ------------------------------------------------------------

app.post(
  '/api/waitlist',
  auth(false),
  (req,res)=>{
    try{
      const productId=
        String(req.body.productId||'').trim();

      const color=
        String(req.body.color||'').trim();

      const size=
        String(req.body.size||'').trim();

      const email=
        String(req.body.email||'').trim().toLowerCase();

      const phone=
        String(req.body.phone||'').trim();

      if(!productId){
        return res.status(400).json({
          error:'PRODUCT_REQUIRED'
        });
      }

      const product=db.prepare(`
        SELECT id,name
        FROM products
        WHERE id=?
        LIMIT 1
      `).get(productId);

      if(!product){
        return res.status(404).json({
          error:'PRODUCT_NOT_FOUND'
        });
      }

      const existing=db.prepare(`
        SELECT id
        FROM waitlist
        WHERE product_id=?
          AND COALESCE(color,'')=?
          AND COALESCE(size,'')=?
          AND (
            (?<>'' AND LOWER(email)=?)
            OR
            (?<>'' AND phone=?)
            OR
            (?<>'' AND user_id=?)
          )
        LIMIT 1
      `).get(
        productId,
        color,
        size,
        email,
        email,
        phone,
        phone,
        req.user?.id||''
      );

      if(existing){
        return res.json({
          ok:true,
          already:true
        });
      }

      const waitId=id();

      db.prepare(`
        INSERT INTO waitlist(
          id,
          product_id,
          user_id,
          email,
          phone,
          color,
          size,
          status,
          created_at
        )
        VALUES(?,?,?,?,?,?,?,?,?)
      `).run(
        waitId,
        productId,
        req.user?.id||null,
        email,
        phone,
        color,
        size,
        'waiting',
        now()
      );

      res.status(201).json({
        ok:true,
        id:waitId
      });
    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'WAITLIST_FAILED'
      });
    }
  }
);


app.get(
  '/api/admin/waitlist',
  auth(),
  adminOnly,
  (req,res)=>{
    try{
      const rows=db.prepare(`
        SELECT
          w.*,
          p.name AS product_name
        FROM waitlist w
        LEFT JOIN products p
          ON p.id=w.product_id
        ORDER BY w.created_at DESC
      `).all();

      res.json(rows);
    }catch(e){
      res.status(500).json({
        error:'ADMIN_WAITLIST_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// FEATURED / BEST SELLERS
// ------------------------------------------------------------

app.get(
  '/api/featured',
  (req,res)=>{
    try{
      const limit=
        Math.min(
          Math.max(
            Number(req.query.limit||5),
            1
          ),
          50
        );

      const rows=db.prepare(`
        SELECT
          oi.product_id,
          SUM(
            CASE
              WHEN o.status NOT IN(
                'cancelled',
                'canceled',
                'rejected'
              )
              THEN COALESCE(oi.quantity,0)
              ELSE 0
            END
          ) AS sold_qty
        FROM order_items oi
        JOIN orders o
          ON o.id=oi.order_id
        GROUP BY oi.product_id
        ORDER BY sold_qty DESC
        LIMIT ?
      `).all(limit);

      const ids=
        rows
          .map(x=>x.product_id)
          .filter(Boolean);

      if(!ids.length){
        return res.json([]);
      }

      const placeholders=
        ids.map(()=>'?').join(',');

      const productsRows=db.prepare(`
        SELECT *
        FROM products
        WHERE id IN(${placeholders})
          AND COALESCE(active,1)=1
      `).all(...ids);

      const map=
        new Map(
          productsRows.map(
            p=>[p.id,rowProduct(p)]
          )
        );

      res.json(
        ids
          .map(x=>map.get(x))
          .filter(Boolean)
      );
    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'FEATURED_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// ADMIN PRODUCTS
// ------------------------------------------------------------

app.get(
  '/api/admin/products',
  auth(),
  adminOnly,
  (req,res)=>{
    try{
      const rows=db.prepare(`
        SELECT *
        FROM products
        ORDER BY created_at DESC
      `).all();

      res.json(
        rows.map(rowProduct)
      );
    }catch(e){
      res.status(500).json({
        error:'ADMIN_PRODUCTS_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// CREATE PRODUCT
// ------------------------------------------------------------

app.post(
  '/api/admin/products',
  auth(),
  adminOnly,
  (req,res)=>{
    try{
      const input=
        productInput.parse(
          req.body||{}
        );

      const productId=
        input.id||
        id();

      const createdAt=now();

      const transaction=
        db.transaction(()=>{
          db.prepare(`
            INSERT INTO products(
              id,
              name,
              slug,
              description,
              category,
              brand,
              price,
              old_price,
              cost,
              stock,
              images_json,
              variants_json,
              metadata_json,
              active,
              created_at,
              updated_at
            )
            VALUES(
              ?,?,?,?,?,?,?,?,?,?,
              ?,?,?,?,?,?
            )
          `).run(
            productId,
            input.name,
            input.slug||
              slugify(input.name),
            input.description||'',
            input.category||'',
            input.brand||'',
            Number(input.price||0),
            Number(input.oldPrice||0),
            Number(input.cost||0),
            Number(input.stock||0),
            JSON.stringify(
              input.images||[]
            ),
            JSON.stringify(
              input.variants||[]
            ),
            JSON.stringify(
              input.metadata||{}
            ),
            input.active===false?0:1,
            createdAt,
            createdAt
          );

          const variants=
            Array.isArray(input.variantItems)?
            input.variantItems:
            [];

          for(
            const variant
            of variants
          ){
            const variantId=
              variant.id||
              id();

            db.prepare(`
              INSERT INTO product_variants(
                id,
                product_id,
                color,
                size,
                sku,
                stock,
                images_json,
                active,
                created_at,
                updated_at
              )
              VALUES(?,?,?,?,?,?,?,?,?,?)
            `).run(
              variantId,
              productId,
              variant.color||'',
              variant.size||'',
              variant.sku||'',
              Number(variant.stock||0),
              JSON.stringify(
                variant.images||[]
              ),
              variant.active===false?0:1,
              createdAt,
              createdAt
            );

            if(Number(variant.stock||0)!==0){
              recordInventoryMovement({
                productId,
                variantId,
                color:variant.color||'',
                size:variant.size||'',
                beforeStock:0,
                afterStock:Number(
                  variant.stock||0
                ),
                delta:Number(
                  variant.stock||0
                ),
                reason:'initial_stock',
                source:'product_create'
              });
            }
          }

          syncProductStock(productId);
        });

      transaction();

      const created=db.prepare(`
        SELECT *
        FROM products
        WHERE id=?
      `).get(productId);

      res.status(201).json(
        rowProduct(created)
      );
    }catch(e){
      console.error(e);

      res.status(400).json({
        error:'PRODUCT_CREATE_FAILED',
        detail:e.message
      });
    }
  }
);


// ------------------------------------------------------------
// UPDATE PRODUCT
// ------------------------------------------------------------

app.patch(
  '/api/admin/products/:id',
  auth(),
  adminOnly,
  (req,res)=>{
    try{
      const productId=
        req.params.id;

      const existing=db.prepare(`
        SELECT *
        FROM products
        WHERE id=?
        LIMIT 1
      `).get(productId);

      if(!existing){
        return res.status(404).json({
          error:'PRODUCT_NOT_FOUND'
        });
      }

      const input=
        productInput.parse(
          {
            ...rowProduct(existing),
            ...(req.body||{})
          }
        );

      const transaction=
        db.transaction(()=>{
          db.prepare(`
            UPDATE products
            SET
              name=?,
              slug=?,
              description=?,
              category=?,
              brand=?,
              price=?,
              old_price=?,
              cost=?,
              images_json=?,
              variants_json=?,
              metadata_json=?,
              active=?,
              updated_at=?
            WHERE id=?
          `).run(
            input.name,
            input.slug||
              slugify(input.name),
            input.description||'',
            input.category||'',
            input.brand||'',
            Number(input.price||0),
            Number(input.oldPrice||0),
            Number(input.cost||0),
            JSON.stringify(
              input.images||[]
            ),
            JSON.stringify(
              input.variants||[]
            ),
            JSON.stringify(
              input.metadata||{}
            ),
            input.active===false?0:1,
            now(),
            productId
          );

          if(
            Array.isArray(
              input.variantItems
            )
          ){
            const currentVariants=
              db.prepare(`
                SELECT *
                FROM product_variants
                WHERE product_id=?
              `).all(productId);

            const currentMap=
              new Map(
                currentVariants.map(
                  v=>[v.id,v]
                )
              );

            const incomingIds=
              new Set();

            for(
              const variant
              of input.variantItems
            ){
              const variantId=
                variant.id||
                id();

              incomingIds.add(
                variantId
              );

              const old=
                currentMap.get(
                  variantId
                );

              if(old){
                const oldStock=
                  Number(old.stock||0);

                const newStock=
                  Number(variant.stock||0);

                db.prepare(`
                  UPDATE product_variants
                  SET
                    color=?,
                    size=?,
                    sku=?,
                    stock=?,
                    images_json=?,
                    active=?,
                    updated_at=?
                  WHERE id=?
                `).run(
                  variant.color||'',
                  variant.size||'',
                  variant.sku||'',
                  newStock,
                  JSON.stringify(
                    variant.images||[]
                  ),
                  variant.active===false?0:1,
                  now(),
                  variantId
                );

                if(
                  oldStock!==newStock
                ){
                  recordInventoryMovement({
                    productId,
                    variantId,
                    color:
                      variant.color||'',
                    size:
                      variant.size||'',
                    beforeStock:
                      oldStock,
                    afterStock:
                      newStock,
                    delta:
                      newStock-oldStock,
                    reason:'manual_adjustment',
                    source:'product_update'
                  });
                }
              }else{
                const newStock=
                  Number(variant.stock||0);

                db.prepare(`
                  INSERT INTO product_variants(
                    id,
                    product_id,
                    color,
                    size,
                    sku,
                    stock,
                    images_json,
                    active,
                    created_at,
                    updated_at
                  )
                  VALUES(?,?,?,?,?,?,?,?,?,?)
                `).run(
                  variantId,
                  productId,
                  variant.color||'',
                  variant.size||'',
                  variant.sku||'',
                  newStock,
                  JSON.stringify(
                    variant.images||[]
                  ),
                  variant.active===false?0:1,
                  now(),
                  now()
                );

                if(newStock!==0){
                  recordInventoryMovement({
                    productId,
                    variantId,
                    color:
                      variant.color||'',
                    size:
                      variant.size||'',
                    beforeStock:0,
                    afterStock:newStock,
                    delta:newStock,
                    reason:'initial_stock',
                    source:'product_update'
                  });
                }
              }
            }

            for(
              const old
              of currentVariants
            ){
              if(
                !incomingIds.has(old.id)
              ){
                db.prepare(`
                  DELETE FROM product_variants
                  WHERE id=?
                `).run(old.id);
              }
            }
          }

          syncProductStock(productId);
        });

      transaction();

      const updated=db.prepare(`
        SELECT *
        FROM products
        WHERE id=?
      `).get(productId);

      res.json(
        rowProduct(updated)
      );
    }catch(e){
      console.error(e);

      res.status(400).json({
        error:'PRODUCT_UPDATE_FAILED',
        detail:e.message
      });
    }
  }
);


// ------------------------------------------------------------
// DELETE PRODUCT
// ------------------------------------------------------------

app.delete(
  '/api/admin/products/:id',
  auth(),
  adminOnly,
  (req,res)=>{
    try{
      const productId=
        req.params.id;

      const existing=db.prepare(`
        SELECT id
        FROM products
        WHERE id=?
        LIMIT 1
      `).get(productId);

      if(!existing){
        return res.status(404).json({
          error:'PRODUCT_NOT_FOUND'
        });
      }

      db.prepare(`
        DELETE FROM products
        WHERE id=?
      `).run(productId);

      res.json({
        ok:true
      });
    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'PRODUCT_DELETE_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// PRODUCT VARIANTS
// ------------------------------------------------------------

app.get(
  '/api/admin/products/:id/variants',
  auth(),
  adminOnly,
  (req,res)=>{
    try{
      const rows=db.prepare(`
        SELECT *
        FROM product_variants
        WHERE product_id=?
        ORDER BY
          color ASC,
          size ASC,
          created_at ASC
      `).all(req.params.id);

      res.json(
        rows.map(v=>({
          ...v,
          images:safeJson(
            v.images_json,
            []
          ),
          stock:Number(v.stock||0),
          active:Boolean(v.active)
        }))
      );
    }catch(e){
      res.status(500).json({
        error:'VARIANTS_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// INVENTORY ADJUSTMENT
// ------------------------------------------------------------

app.post(
  '/api/admin/inventory/adjust',
  auth(),
  adminOnly,
  (req,res)=>{
    try{
      const productId=
        String(
          req.body.productId||''
        ).trim();

      const variantId=
        String(
          req.body.variantId||''
        ).trim();

      const delta=
        Number(
          req.body.delta||0
        );

      const reason=
        String(
          req.body.reason||
          'manual_adjustment'
        ).trim();

      if(!productId){
        return res.status(400).json({
          error:'PRODUCT_REQUIRED'
        });
      }

      if(!Number.isFinite(delta)){
        return res.status(400).json({
          error:'INVALID_DELTA'
        });
      }

      const product=db.prepare(`
        SELECT *
        FROM products
        WHERE id=?
        LIMIT 1
      `).get(productId);

      if(!product){
        return res.status(404).json({
          error:'PRODUCT_NOT_FOUND'
        });
      }

      if(variantId){
        const variant=db.prepare(`
          SELECT *
          FROM product_variants
          WHERE id=?
            AND product_id=?
          LIMIT 1
        `).get(
          variantId,
          productId
        );

        if(!variant){
          return res.status(404).json({
            error:'VARIANT_NOT_FOUND'
          });
        }

        const before=
          Number(variant.stock||0);

        const after=
          before+delta;

        if(after<0){
          return res.status(400).json({
            error:'INSUFFICIENT_STOCK'
          });
        }

        const transaction=
          db.transaction(()=>{
            db.prepare(`
              UPDATE product_variants
              SET
                stock=?,
                updated_at=?
              WHERE id=?
            `).run(
              after,
              now(),
              variantId
            );

            recordInventoryMovement({
              productId,
              variantId,
              color:variant.color||'',
              size:variant.size||'',
              beforeStock:before,
              afterStock:after,
              delta,
              reason,
              source:'admin_inventory'
            });

            syncProductStock(
              productId
            );
          });

        transaction();

        return res.json({
          ok:true,
          stock:after
        });
      }

      const before=
        Number(product.stock||0);

      const after=
        before+delta;

      if(after<0){
        return res.status(400).json({
          error:'INSUFFICIENT_STOCK'
        });
      }

      const transaction=
        db.transaction(()=>{
          db.prepare(`
            UPDATE products
            SET
              stock=?,
              updated_at=?
            WHERE id=?
          `).run(
            after,
            now(),
            productId
          );

          recordInventoryMovement({
            productId,
            variantId:null,
            color:'',
            size:'',
            beforeStock:before,
            afterStock:after,
            delta,
            reason,
            source:'admin_inventory'
          });
        });

      transaction();

      res.json({
        ok:true,
        stock:after
      });
    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'INVENTORY_ADJUST_FAILED'
      });
    }
  }
);
// ============================================================
// PART 3B — INVENTORY / ORDERS / STOCK RESERVATION
// ORDER STATUS / DELIVERY / POINTS
// ============================================================

// ------------------------------------------------------------
// INVENTORY MOVEMENTS
// ------------------------------------------------------------

app.get(
  '/api/admin/inventory/movements',
  auth(),
  adminOnly,
  (req,res)=>{
    try{
      const limit=Math.min(
        Math.max(
          Number(req.query.limit||200),
          1
        ),
        1000
      );

      const rows=db.prepare(`
        SELECT
          m.*,
          p.name AS product_name
        FROM inventory_movements m
        LEFT JOIN products p
          ON p.id=m.product_id
        ORDER BY m.created_at DESC
        LIMIT ?
      `).all(limit);

      res.json(rows);
    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'INVENTORY_MOVEMENTS_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// INVENTORY SUMMARY
// ------------------------------------------------------------

app.get(
  '/api/admin/inventory/summary',
  auth(),
  adminOnly,
  (req,res)=>{
    try{
      const products=db.prepare(`
        SELECT
          id,
          name,
          stock,
          cost,
          active
        FROM products
        ORDER BY name ASC
      `).all();

      const variants=db.prepare(`
        SELECT
          v.*,
          p.name AS product_name
        FROM product_variants v
        LEFT JOIN products p
          ON p.id=v.product_id
        ORDER BY
          p.name ASC,
          v.color ASC,
          v.size ASC
      `).all();

      const totalProductStock=
        products.reduce(
          (sum,p)=>
            sum+Number(p.stock||0),
          0
        );

      const totalVariantStock=
        variants.reduce(
          (sum,v)=>
            sum+Number(v.stock||0),
          0
        );

      const inventoryValue=
        products.reduce(
          (sum,p)=>
            sum+
            Number(p.stock||0)*
            Number(p.cost||0),
          0
        );

      res.json({
        products,
        variants,
        totals:{
          product_stock:
            totalProductStock,
          variant_stock:
            totalVariantStock,
          inventory_value:
            inventoryValue
        }
      });
    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'INVENTORY_SUMMARY_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// CREATE ORDER
// ------------------------------------------------------------

app.post(
  '/api/orders',
  auth(false),
  (req,res)=>{
    try{
      const body=req.body||{};

      const items=
        Array.isArray(body.items)?
        body.items:
        [];

      if(!items.length){
        return res.status(400).json({
          error:'ORDER_ITEMS_REQUIRED'
        });
      }

      const userId=
        req.user?.id||
        null;

      const orderId=id();

      let subtotal=0;
      let totalCost=0;

      const normalizedItems=[];

      const transaction=
        db.transaction(()=>{

          for(const raw of items){

            const productId=
              String(
                raw.productId||
                raw.product_id||
                ''
              ).trim();

            const variantId=
              String(
                raw.variantId||
                raw.variant_id||
                ''
              ).trim();

            const quantity=
              Math.max(
                1,
                Number(
                  raw.quantity||1
                )
              );

            if(!productId){
              throw new Error(
                'PRODUCT_REQUIRED'
              );
            }

            const product=db.prepare(`
              SELECT *
              FROM products
              WHERE id=?
              LIMIT 1
            `).get(productId);

            if(!product){
              throw new Error(
                'PRODUCT_NOT_FOUND'
              );
            }

            let variant=null;
            let availableStock=
              Number(product.stock||0);

            let color=
              String(raw.color||'').trim();

            let size=
              String(raw.size||'').trim();

            let variantName='';

            if(variantId){
              variant=db.prepare(`
                SELECT *
                FROM product_variants
                WHERE id=?
                  AND product_id=?
                  AND active=1
                LIMIT 1
              `).get(
                variantId,
                productId
              );

              if(!variant){
                throw new Error(
                  'VARIANT_NOT_FOUND'
                );
              }

              availableStock=
                Number(
                  variant.stock||0
                );

              color=
                color||
                variant.color||
                '';

              size=
                size||
                variant.size||
                '';

              variantName=
                [
                  variant.color,
                  variant.size
                ]
                .filter(Boolean)
                .join(' / ');
            }

            if(
              availableStock<
              quantity
            ){
              throw new Error(
                'INSUFFICIENT_STOCK'
              );
            }

            const unitPrice=
              Number(
                raw.price!==undefined?
                raw.price:
                product.price||0
              );

            const unitCost=
              Number(
                product.cost||0
              );

            const lineTotal=
              unitPrice*
              quantity;

            const lineCost=
              unitCost*
              quantity;

            subtotal+=lineTotal;
            totalCost+=lineCost;

            normalizedItems.push({
              productId,
              product_id:productId,
              variantId:
                variantId||null,
              variant_id:
                variantId||null,
              name:product.name,
              variantName,
              color,
              size,
              quantity,
              price:unitPrice,
              unit_price:unitPrice,
              cost:unitCost,
              lineTotal,
              line_total:lineTotal,
              lineCost,
              line_cost:lineCost,
              image:
                raw.image||
                safeJson(
                  product.images_json,
                  []
                )[0]||
                ''
            });

            if(variantId){

              const before=
                Number(
                  variant.stock||0
                );

              const after=
                before-quantity;

              db.prepare(`
                UPDATE product_variants
                SET
                  stock=?,
                  updated_at=?
                WHERE id=?
              `).run(
                after,
                now(),
                variantId
              );

              recordInventoryMovement({
                productId,
                variantId,
                color,
                size,
                beforeStock:before,
                afterStock:after,
                delta:-quantity,
                reason:'sale_reserved',
                source:'order',
                referenceId:orderId
              });

              syncProductStock(
                productId
              );

            }else{

              const before=
                Number(
                  product.stock||0
                );

              const after=
                before-quantity;

              db.prepare(`
                UPDATE products
                SET
                  stock=?,
                  updated_at=?
                WHERE id=?
              `).run(
                after,
                now(),
                productId
              );

              recordInventoryMovement({
                productId,
                variantId:null,
                color,
                size,
                beforeStock:before,
                afterStock:after,
                delta:-quantity,
                reason:'sale_reserved',
                source:'order',
                referenceId:orderId
              });
            }
          }

          const couponCode=
            String(
              body.coupon||
              body.couponCode||
              ''
            ).trim();

          let couponDiscount=0;
          let couponId=null;

          if(couponCode){

            const coupon=db.prepare(`
              SELECT *
              FROM coupons
              WHERE LOWER(code)=LOWER(?)
                AND active=1
              LIMIT 1
            `).get(
              couponCode
            );

            if(coupon){

              const nowDate=
                new Date();

              const validFrom=
                coupon.starts_at?
                new Date(
                  coupon.starts_at
                ):
                null;

              const validUntil=
                coupon.ends_at?
                new Date(
                  coupon.ends_at
                ):
                null;

              const validDate=
                (!validFrom ||
                  nowDate>=validFrom) &&
                (!validUntil ||
                  nowDate<=validUntil);

              if(validDate){

                couponId=
                  coupon.id;

                if(
                  coupon.type==='percent'
                ){
                  couponDiscount=
                    subtotal*
                    (
                      Number(
                        coupon.value||0
                      )/100
                    );
                }else{
                  couponDiscount=
                    Number(
                      coupon.value||0
                    );
                }

                couponDiscount=
                  Math.max(
                    0,
                    Math.min(
                      subtotal,
                      couponDiscount
                    )
                  );
              }
            }
          }

          const pointsUsed=
            Math.max(
              0,
              Number(
                body.pointsUsed||0
              )
            );

          let pointsDiscount=0;

          if(
            userId &&
            pointsUsed>0
          ){

            const user=db.prepare(`
              SELECT points
              FROM users
              WHERE id=?
              LIMIT 1
            `).get(userId);

            const availablePoints=
              Number(
                user?.points||0
              );

            const usablePoints=
              Math.min(
                availablePoints,
                pointsUsed
              );

            const pointValue=
              Number(
                getSetting(
                  'point_value',
                  1
                )
              )||1;

            pointsDiscount=
              usablePoints*
              pointValue;
          }

          const shipping=
            Math.max(
              0,
              Number(
                body.shipping||
                body.shippingFee||
                0
              )
                  );

    const packaging=
      Math.max(
        0,
        Number(
          body.packaging||
          body.packagingFee||
          0
        )
      );

    const discountTotal=
      Math.min(
        subtotal,
        couponDiscount+
        pointsDiscount
      );

    const total=
      Math.max(
        0,
        subtotal-
        discountTotal+
        shipping+
        packaging
      );

    const status=
      String(
        body.status||
        'pending'
      );

    const inventoryState=
      'reserved';

    const shippingData=
      body.shippingData||
      body.shipping||
      {};

    const paymentData=
      body.payment||
      {};

    const totals={
      subtotal,
      coupon_discount:
        couponDiscount,
      points_discount:
        pointsDiscount,
      discount:
        discountTotal,
      shipping,
      packaging,
      total,
      cogs:totalCost,
      gross_profit:
        subtotal-
        discountTotal-
        totalCost
    };

    db.prepare(`
      INSERT INTO orders(
        id,
        user_id,
        status,
        items_json,
        shipping_json,
        payment_json,
        totals_json,
        subtotal,
        discount,
        shipping,
        packaging,
        total,
        cost_total,
        coupon_id,
        coupon_code,
        points_used,
        points_awarded,
        inventory_state,
        created_at,
        updated_at
      )
      VALUES(
        ?,?,?,?,?,?,?,?,?,?,
        ?,?,?,?,?,?,?,?,?,?
      )
    `).run(
      orderId,
      userId,
      status,
      JSON.stringify(
        normalizedItems
      ),
      JSON.stringify(
        shippingData
      ),
      JSON.stringify(
        paymentData
      ),
      JSON.stringify(
        totals
      ),
      subtotal,
      discountTotal,
      shipping,
      packaging,
      total,
      totalCost,
      couponId,
      couponCode||null,
      pointsUsed,
      0,
      inventoryState,
      now(),
      now()
    );

    if(
      userId &&
      pointsUsed>0
    ){

      const user=db.prepare(`
        SELECT points
        FROM users
        WHERE id=?
        LIMIT 1
      `).get(userId);

      const usablePoints=
        Math.min(
          Number(user?.points||0),
          pointsUsed
        );

      db.prepare(`
        UPDATE users
        SET points=MAX(
          0,
          COALESCE(points,0)-?
        )
        WHERE id=?
      `).run(
        usablePoints,
        userId
      );
    }
  });

  transaction();

  const created=db.prepare(`
    SELECT *
    FROM orders
    WHERE id=?
  `).get(orderId);

  res.status(201).json({
    ...created,
    items:safeJson(
      created.items_json,
      []
    ),
    shipping:safeJson(
      created.shipping_json,
      {}
    ),
    payment:safeJson(
      created.payment_json,
      {}
    ),
    totals:safeJson(
      created.totals_json,
      {}
    )
  });

}catch(e){
  console.error(e);

  res.status(400).json({
    error:
      e.message||
      'ORDER_CREATE_FAILED'
  });
}
});
// ============================================================
// PART 4A — ADMIN ORDERS / DASHBOARD / ACCOUNTING
// ============================================================

// ------------------------------------------------------------
// ADMIN ORDERS LIST
// ------------------------------------------------------------

app.get(
  '/api/admin/orders',
  auth(),
  adminOnly,
  (req,res)=>{
    try{
      const status=
        String(
          req.query.status||''
        ).trim();

      let rows;

      if(status){
        rows=db.prepare(`
          SELECT *
          FROM orders
          WHERE status=?
          ORDER BY created_at DESC
        `).all(status);
      }else{
        rows=db.prepare(`
          SELECT *
          FROM orders
          ORDER BY created_at DESC
        `).all();
      }

      res.json(
        rows.map(row=>({
          ...row,
          items:safeJson(
            row.items_json,
            []
          ),
          shipping:safeJson(
            row.shipping_json,
            {}
          ),
          payment:safeJson(
            row.payment_json,
            {}
          ),
          totals:safeJson(
            row.totals_json,
            {}
          )
        }))
      );

    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'ADMIN_ORDERS_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// ADMIN ORDER DETAIL
// ------------------------------------------------------------

app.get(
  '/api/admin/orders/:id',
  auth(),
  adminOnly,
  (req,res)=>{
    try{

      const order=db.prepare(`
        SELECT *
        FROM orders
        WHERE id=?
        LIMIT 1
      `).get(
        req.params.id
      );

      if(!order){
        return res.status(404).json({
          error:'ORDER_NOT_FOUND'
        });
      }

      const events=db.prepare(`
        SELECT *
        FROM order_events
        WHERE order_id=?
        ORDER BY created_at ASC
      `).all(
        order.id
      );

      res.json({
        ...order,
        items:safeJson(
          order.items_json,
          []
        ),
        shipping:safeJson(
          order.shipping_json,
          {}
        ),
        payment:safeJson(
          order.payment_json,
          {}
        ),
        totals:safeJson(
          order.totals_json,
          {}
        ),
        events
      });

    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'ORDER_DETAIL_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// ORDER EVENTS
// ------------------------------------------------------------

app.get(
  '/api/admin/orders/:id/events',
  auth(),
  adminOnly,
  (req,res)=>{
    try{

      const rows=db.prepare(`
        SELECT *
        FROM order_events
        WHERE order_id=?
        ORDER BY created_at DESC
      `).all(
        req.params.id
      );

      res.json(rows);

    }catch(e){
      res.status(500).json({
        error:'ORDER_EVENTS_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// DASHBOARD
// ------------------------------------------------------------

app.get(
  '/api/admin/dashboard',
  auth(),
  adminOnly,
  (req,res)=>{
    try{

      const today=
        new Date()
          .toISOString()
          .slice(0,10);

      const sales=db.prepare(`
        SELECT
          COALESCE(
            SUM(
              CASE
                WHEN status NOT IN(
                  'cancelled',
                  'canceled',
                  'rejected'
                )
                THEN total
                ELSE 0
              END
            ),
            0
          ) AS sales,

          COUNT(
            CASE
              WHEN status NOT IN(
                'cancelled',
                'canceled',
                'rejected'
              )
              THEN 1
            END
          ) AS orders

        FROM orders

        WHERE
          substr(
            created_at,
            1,
            10
          )=?
      `).get(today);


      const cogs=db.prepare(`
        SELECT
          COALESCE(
            SUM(
              CASE
                WHEN o.status NOT IN(
                  'cancelled',
                  'canceled',
                  'rejected'
                )
                THEN
                  COALESCE(
                    oi.cost_snapshot,
                    0
                  )*
                  COALESCE(
                    oi.quantity,
                    0
                  )
                ELSE 0
              END
            ),
            0
          ) AS cogs

        FROM order_items oi

        JOIN orders o
          ON o.id=oi.order_id

        WHERE
          substr(
            o.created_at,
            1,
            10
          )=?
      `).get(today);


      const discounts=db.prepare(`
        SELECT
          COALESCE(
            SUM(
              CASE
                WHEN status NOT IN(
                  'cancelled',
                  'canceled',
                  'rejected'
                )
                THEN discount
                ELSE 0
              END
            ),
            0
          ) AS discounts

        FROM orders

        WHERE
          substr(
            created_at,
            1,
            10
          )=?
      `).get(today);


      const returns=db.prepare(`
        SELECT
          COUNT(*) AS count
        FROM orders
        WHERE
          status IN(
            'returned',
            'return_approved',
            'exchange'
          )
          AND
          substr(
            created_at,
            1,
            10
          )=?
      `).get(today);


      const lowStock=db.prepare(`
        SELECT
          id,
          name,
          stock,
          cost,
          active
        FROM products
        WHERE
          COALESCE(active,1)=1
          AND
          COALESCE(stock,0)<=?
        ORDER BY stock ASC
        LIMIT 50
      `).all(
        Number(
          getSetting(
            'low_stock_threshold',
            5
          )
        )||5
      );


      const totalSales=
        Number(
          sales?.sales||0
        );

      const totalOrders=
        Number(
          sales?.orders||0
        );

      const totalCogs=
        Number(
          cogs?.cogs||0
        );

      const totalDiscounts=
        Number(
          discounts?.discounts||0
        );


      res.json({

        date:today,

        sales:
          totalSales,

        orders:
          totalOrders,

        averageOrder:
          totalOrders?
          totalSales/
          totalOrders:
          0,

        discounts:
          totalDiscounts,

        cogs:
          totalCogs,

        grossProfit:
          totalSales-
          totalCogs,

        returns:
          Number(
            returns?.count||0
          ),

        lowStock

      });

    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'DASHBOARD_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// ACCOUNTING REPORT
// ------------------------------------------------------------

app.get(
  '/api/admin/accounting',
  auth(),
  adminOnly,
  (req,res)=>{
    try{

      const from=
        String(
          req.query.from||''
        ).trim();

      const to=
        String(
          req.query.to||''
        ).trim();

      const today=
        new Date()
          .toISOString()
          .slice(0,10);

      const start=
        from||
        today;

      const end=
        to||
        today;


      const salesRow=db.prepare(`
        SELECT
          COALESCE(
            SUM(
              CASE
                WHEN status NOT IN(
                  'cancelled',
                  'canceled',
                  'rejected'
                )
                THEN subtotal
                ELSE 0
              END
            ),
            0
          ) AS gross_sales,

          COALESCE(
            SUM(
              CASE
                WHEN status NOT IN(
                  'cancelled',
                  'canceled',
                  'rejected'
                )
                THEN discount
                ELSE 0
              END
            ),
            0
          ) AS discounts,

          COALESCE(
            SUM(
              CASE
                WHEN status NOT IN(
                  'cancelled',
                  'canceled',
                  'rejected'
                )
                THEN shipping
                ELSE 0
              END
            ),
            0
          ) AS shipping,

          COALESCE(
            SUM(
              CASE
                WHEN status NOT IN(
                  'cancelled',
                  'canceled',
                  'rejected'
                )
                THEN packaging
                ELSE 0
              END
            ),
            0
          ) AS packaging,

          COALESCE(
            SUM(
              CASE
                WHEN status NOT IN(
                  'cancelled',
                  'canceled',
                  'rejected'
                )
                THEN total
                ELSE 0
              END
            ),
            0
          ) AS net_collected,

          COUNT(
            CASE
              WHEN status NOT IN(
                'cancelled',
                'canceled',
                'rejected'
              )
              THEN 1
            END
          ) AS order_count

        FROM orders

        WHERE
          substr(
            created_at,
            1,
            10
          ) BETWEEN ? AND ?
      `).get(
        start,
        end
      );


      const cogsRow=db.prepare(`
        SELECT
          COALESCE(
            SUM(
              CASE
                WHEN o.status NOT IN(
                  'cancelled',
                  'canceled',
                  'rejected'
                )
                THEN
                  COALESCE(
                    oi.cost_snapshot,
                    0
                  )*
                  COALESCE(
                    oi.quantity,
                    0
                  )
                ELSE 0
              END
            ),
            0
          ) AS cogs

        FROM order_items oi

        JOIN orders o
          ON o.id=oi.order_id

        WHERE
          substr(
            o.created_at,
            1,
            10
          ) BETWEEN ? AND ?
      `).get(
        start,
        end
      );


      const grossSales=
        Number(
          salesRow?.gross_sales||0
        );

      const discounts=
        Number(
          salesRow?.discounts||0
        );

      const shipping=
        Number(
          salesRow?.shipping||0
        );

      const packaging=
        Number(
          salesRow?.packaging||0
        );

      const netCollected=
        Number(
          salesRow?.net_collected||0
        );

      const cogs=
        Number(
          cogsRow?.cogs||0
        );


      const returnsRow=db.prepare(`
        SELECT
          COUNT(*) AS count
        FROM orders
        WHERE
          status IN(
            'returned',
            'return_approved',
            'exchange'
          )
          AND
          substr(
            created_at,
            1,
            10
          ) BETWEEN ? AND ?
      `).get(
        start,
        end
      );


      const pointsRow=db.prepare(`
        SELECT
          COALESCE(
            SUM(
              CASE
                WHEN points>0
                THEN points
                ELSE 0
              END
            ),
            0
          ) AS earned,

          COALESCE(
            SUM(
              CASE
                WHEN points<0
                THEN ABS(points)
                ELSE 0
              END
            ),
            0
          ) AS redeemed

        FROM loyalty_ledger

        WHERE
          substr(
            created_at,
            1,
            10
          ) BETWEEN ? AND ?
      `).get(
        start,
        end
      );


      const grossAfterDiscount=
        Math.max(
          0,
          grossSales-
          discounts
        );


      const grossProfit=
        grossAfterDiscount-
        cogs;


      res.json({

        period:{
          from:start,
          to:end
        },

        gross_sales:
          grossSales,

        discounts:
          discounts,

        net_sales:
          grossAfterDiscount,

        returns:
          Number(
            returnsRow?.count||0
          ),

        shipping:
          shipping,

        packaging:
          packaging,

        net_collected:
          netCollected,

        cogs:
          cogs,

        gross_profit:
          grossProfit,

        order_count:
          Number(
            salesRow?.order_count||0
          ),

        average_order:
          Number(
            salesRow?.order_count||0
          )?
          netCollected/
          Number(
            salesRow?.order_count||0
          ):
          0,

        points:{
          earned:
            Number(
              pointsRow?.earned||0
            ),
          redeemed:
            Number(
              pointsRow?.redeemed||0
            )
        }

      });

    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'ACCOUNTING_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// BEST SELLING PRODUCTS REPORT
// ------------------------------------------------------------

app.get(
  '/api/admin/reports/best-sellers',
  auth(),
  adminOnly,
  (req,res)=>{
    try{

      const from=
        String(
          req.query.from||''
        ).trim();

      const to=
        String(
          req.query.to||''
        ).trim();

      const rows=db.prepare(`
        SELECT
          oi.product_id,
          MAX(
            oi.name_snapshot
          ) AS product_name,

          SUM(
            oi.quantity
          ) AS quantity,

          SUM(
            oi.price_snapshot*
            oi.quantity
          ) AS sales,

          SUM(
            oi.cost_snapshot*
            oi.quantity
          ) AS cogs

        FROM order_items oi

        JOIN orders o
          ON o.id=oi.order_id

        WHERE
          o.status NOT IN(
            'cancelled',
            'canceled',
            'rejected'
          )

          AND
          substr(
            o.created_at,
            1,
            10
          ) BETWEEN ? AND ?

        GROUP BY
          oi.product_id

        ORDER BY
          quantity DESC

        LIMIT 100
      `).all(
        from||
          new Date()
            .toISOString()
            .slice(0,10),

        to||
          new Date()
            .toISOString()
            .slice(0,10)
      );

      res.json(
        rows.map(row=>({
          ...row,

          quantity:
            Number(
              row.quantity||0
            ),

          sales:
            Number(
              row.sales||0
            ),

          cogs:
            Number(
              row.cogs||0
            ),

          profit:
            Number(
              row.sales||0
            )-
            Number(
              row.cogs||0
            )
        }))
      );

    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'BEST_SELLERS_REPORT_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// MOST PROFITABLE PRODUCTS REPORT
// ------------------------------------------------------------

app.get(
  '/api/admin/reports/profit-products',
  auth(),
  adminOnly,
  (req,res)=>{
    try{

      const from=
        String(
          req.query.from||''
        ).trim();

      const to=
        String(
          req.query.to||''
        ).trim();

      const rows=db.prepare(`
        SELECT
          oi.product_id,

          MAX(
            oi.name_snapshot
          ) AS product_name,

          SUM(
            oi.quantity
          ) AS quantity,

          SUM(
            oi.price_snapshot*
            oi.quantity
          ) AS sales,

          SUM(
            oi.cost_snapshot*
            oi.quantity
          ) AS cogs

        FROM order_items oi

        JOIN orders o
          ON o.id=oi.order_id

        WHERE
          o.status NOT IN(
            'cancelled',
            'canceled',
            'rejected'
          )

          AND
          substr(
            o.created_at,
            1,
            10
          ) BETWEEN ? AND ?

        GROUP BY
          oi.product_id

        ORDER BY
          (
            SUM(
              oi.price_snapshot*
              oi.quantity
            )-
            SUM(
              oi.cost_snapshot*
              oi.quantity
            )
          ) DESC

        LIMIT 100
      `).all(
        from||
          new Date()
            .toISOString()
            .slice(0,10),

        to||
          new Date()
            .toISOString()
            .slice(0,10)
      );

      res.json(
        rows.map(row=>({
          ...row,

          quantity:
            Number(
              row.quantity||0
            ),

          sales:
            Number(
              row.sales||0
            ),

          cogs:
            Number(
              row.cogs||0
            ),

          profit:
            Number(
              row.sales||0
            )-
            Number(
              row.cogs||0
            )
        }))
      );

    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'PROFIT_REPORT_FAILED'
      });
    }
  }
);
// ============================================================
// PART 4B — USERS / COUPONS / NOTIFICATIONS / PERMISSIONS
// ============================================================

// ------------------------------------------------------------
// ADMIN USERS
// ------------------------------------------------------------

app.get(
  '/api/admin/users',
  auth(),
  adminOnly,
  (req,res)=>{
    try{

      const rows=db.prepare(`
        SELECT
          id,
          name,
          email,
          phone,
          gender,
          age,
          points,
          is_admin,
          role,
          created_at
        FROM users
        ORDER BY created_at DESC
      `).all();

      res.json(rows);

    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'ADMIN_USERS_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// ADMIN USER DETAIL
// ------------------------------------------------------------

app.get(
  '/api/admin/users/:id',
  auth(),
  adminOnly,
  (req,res)=>{
    try{

      const user=db.prepare(`
        SELECT
          id,
          name,
          email,
          phone,
          gender,
          age,
          points,
          is_admin,
          role,
          created_at
        FROM users
        WHERE id=?
        LIMIT 1
      `).get(
        req.params.id
      );

      if(!user){
        return res.status(404).json({
          error:'USER_NOT_FOUND'
        });
      }

      const orders=db.prepare(`
        SELECT
          id,
          status,
          total,
          created_at,
          updated_at
        FROM orders
        WHERE user_id=?
        ORDER BY created_at DESC
      `).all(
        user.id
      );

      res.json({
        ...user,
        orders
      });

    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'USER_DETAIL_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// UPDATE CUSTOMER
// ------------------------------------------------------------

app.patch(
  '/api/admin/users/:id',
  auth(),
  adminOnly,
  (req,res)=>{
    try{

      const user=db.prepare(`
        SELECT *
        FROM users
        WHERE id=?
        LIMIT 1
      `).get(
        req.params.id
      );

      if(!user){
        return res.status(404).json({
          error:'USER_NOT_FOUND'
        });
      }

      const name=
        req.body.name!==undefined?
        String(
          req.body.name||''
        ).trim():
        user.name;

      const phone=
        req.body.phone!==undefined?
        String(
          req.body.phone||''
        ).trim():
        user.phone;

      const gender=
        req.body.gender!==undefined?
        String(
          req.body.gender||''
        ).trim():
        user.gender;

      const age=
        req.body.age!==undefined?
        (
          req.body.age===null ||
          req.body.age===''?
          null:
          Number(req.body.age)
        ):
        user.age;

      const points=
        req.body.points!==undefined?
        Math.max(
          0,
          Number(req.body.points||0)
        ):
        Number(user.points||0);

      db.prepare(`
        UPDATE users
        SET
          name=?,
          phone=?,
          gender=?,
          age=?,
          points=?
        WHERE id=?
      `).run(
        name,
        phone,
        gender,
        age,
        points,
        user.id
      );

      const updated=db.prepare(`
        SELECT
          id,
          name,
          email,
          phone,
          gender,
          age,
          points,
          is_admin,
          role,
          created_at
        FROM users
        WHERE id=?
      `).get(
        user.id
      );

      res.json({
        ok:true,
        user:updated
      });

    }catch(e){
      console.error(e);

      res.status(400).json({
        error:'USER_UPDATE_FAILED',
        detail:e.message
      });
    }
  }
);


// ------------------------------------------------------------
// DELETE CUSTOMER
// ------------------------------------------------------------

app.delete(
  '/api/admin/users/:id',
  auth(),
  adminOnly,
  (req,res)=>{
    try{

      const user=db.prepare(`
        SELECT id
        FROM users
        WHERE id=?
        LIMIT 1
      `).get(
        req.params.id
      );

      if(!user){
        return res.status(404).json({
          error:'USER_NOT_FOUND'
        });
      }

      const orderCount=db.prepare(`
        SELECT COUNT(*) AS c
        FROM orders
        WHERE user_id=?
      `).get(
        user.id
      );

      if(
        Number(orderCount?.c||0)>0
      ){
        return res.status(400).json({
          error:'USER_HAS_ORDERS'
        });
      }

      db.prepare(`
        DELETE FROM users
        WHERE id=?
      `).run(
        user.id
      );

      res.json({
        ok:true
      });

    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'USER_DELETE_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// COUPONS LIST
// ------------------------------------------------------------

app.get(
  '/api/admin/coupons',
  auth(),
  adminOnly,
  (req,res)=>{
    try{

      const rows=db.prepare(`
        SELECT *
        FROM coupons
        ORDER BY created_at DESC
      `).all();

      res.json(rows);

    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'COUPONS_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// CREATE COUPON
// ------------------------------------------------------------

app.post(
  '/api/admin/coupons',
  auth(),
  adminOnly,
  (req,res)=>{
    try{

      const code=
        String(
          req.body.code||''
        ).trim().toUpperCase();

      if(!code){
        return res.status(400).json({
          error:'COUPON_CODE_REQUIRED'
        });
      }

      const type=
        String(
          req.body.type||
          'percent'
        ).trim();

      const value=
        Math.max(
          0,
          Number(
            req.body.value||0
          )
        );

      const startsAt=
        req.body.starts_at||
        req.body.startsAt||
        null;

      const endsAt=
        req.body.ends_at||
        req.body.endsAt||
        null;

      const active=
        req.body.active===false?
        0:
        1;

      const existing=db.prepare(`
        SELECT id
        FROM coupons
        WHERE LOWER(code)=LOWER(?)
        LIMIT 1
      `).get(
        code
      );

      if(existing){
        return res.status(409).json({
          error:'COUPON_EXISTS'
        });
      }

      const couponId=id();

      db.prepare(`
        INSERT INTO coupons(
          id,
          code,
          type,
          value,
          starts_at,
          ends_at,
          active,
          created_at,
          updated_at
        )
        VALUES(?,?,?,?,?,?,?,?,?)
      `).run(
        couponId,
        code,
        type,
        value,
        startsAt,
        endsAt,
        active,
        now(),
        now()
      );

      const created=db.prepare(`
        SELECT *
        FROM coupons
        WHERE id=?
      `).get(
        couponId
      );

      res.status(201).json(
        created
      );

    }catch(e){
      console.error(e);

      res.status(400).json({
        error:'COUPON_CREATE_FAILED',
        detail:e.message
      });
    }
  }
);


// ------------------------------------------------------------
// UPDATE COUPON
// ------------------------------------------------------------

app.patch(
  '/api/admin/coupons/:id',
  auth(),
  adminOnly,
  (req,res)=>{
    try{

      const coupon=db.prepare(`
        SELECT *
        FROM coupons
        WHERE id=?
        LIMIT 1
      `).get(
        req.params.id
      );

      if(!coupon){
        return res.status(404).json({
          error:'COUPON_NOT_FOUND'
        });
      }

      const code=
        req.body.code!==undefined?
        String(
          req.body.code||''
        ).trim().toUpperCase():
        coupon.code;

      const type=
        req.body.type!==undefined?
        String(
          req.body.type||'percent'
        ).trim():
        coupon.type;

      const value=
        req.body.value!==undefined?
        Math.max(
          0,
          Number(req.body.value||0)
        ):
        Number(coupon.value||0);

      const startsAt=
        req.body.starts_at!==undefined?
        req.body.starts_at:
        coupon.starts_at;

      const endsAt=
        req.body.ends_at!==undefined?
        req.body.ends_at:
        coupon.ends_at;

      const active=
        req.body.active!==undefined?
        (
          req.body.active?
          1:
          0
        ):
        Number(coupon.active||0);

      db.prepare(`
        UPDATE coupons
        SET
          code=?,
          type=?,
          value=?,
          starts_at=?,
          ends_at=?,
          active=?,
          updated_at=?
        WHERE id=?
      `).run(
        code,
        type,
        value,
        startsAt,
        endsAt,
        active,
        now(),
        coupon.id
      );

      const updated=db.prepare(`
        SELECT *
        FROM coupons
        WHERE id=?
      `).get(
        coupon.id
      );

      res.json({
        ok:true,
        coupon:updated
      });

    }catch(e){
      console.error(e);

      res.status(400).json({
        error:'COUPON_UPDATE_FAILED',
        detail:e.message
      });
    }
  }
);


// ------------------------------------------------------------
// DELETE COUPON
// ------------------------------------------------------------

app.delete(
  '/api/admin/coupons/:id',
  auth(),
  adminOnly,
  (req,res)=>{
    try{

      const coupon=db.prepare(`
        SELECT id
        FROM coupons
        WHERE id=?
        LIMIT 1
      `).get(
        req.params.id
      );

      if(!coupon){
        return res.status(404).json({
          error:'COUPON_NOT_FOUND'
        });
      }

      db.prepare(`
        DELETE FROM coupons
        WHERE id=?
      `).run(
        coupon.id
      );

      res.json({
        ok:true
      });

    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'COUPON_DELETE_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// ADMIN NOTIFICATIONS
// ------------------------------------------------------------

app.get(
  '/api/admin/notifications',
  auth(),
  adminOnly,
  (req,res)=>{
    try{

      const rows=db.prepare(`
        SELECT *
        FROM admin_notifications
        ORDER BY created_at DESC
        LIMIT 200
      `).all();

      res.json(rows);

    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'ADMIN_NOTIFICATIONS_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// MARK NOTIFICATION READ
// ------------------------------------------------------------

app.patch(
  '/api/admin/notifications/:id/read',
  auth(),
  adminOnly,
  (req,res)=>{
    try{

      db.prepare(`
        UPDATE admin_notifications
        SET
          read_at=?
        WHERE id=?
      `).run(
        now(),
        req.params.id
      );

      res.json({
        ok:true
      });

    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'NOTIFICATION_READ_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// CREATE ADMIN NOTIFICATION
// ------------------------------------------------------------

function createAdminNotification({
  type='info',
  title='',
  message='',
  data={}
}={}){

  try{

    db.prepare(`
      INSERT INTO admin_notifications(
        id,
        type,
        title,
        message,
        data_json,
        created_at
      )
      VALUES(?,?,?,?,?,?)
    `).run(
      id(),
      type,
      title,
      message,
      JSON.stringify(data||{}),
      now()
    );

  }catch(e){
    console.error(
      'ADMIN_NOTIFICATION_FAILED',
      e
    );
  }
}


// ------------------------------------------------------------
// LOW STOCK NOTIFICATION
// ------------------------------------------------------------

function checkLowStockNotification(
  productId
){

  try{

    const product=db.prepare(`
      SELECT
        id,
        name,
        stock,
        active
      FROM products
      WHERE id=?
      LIMIT 1
    `).get(
      productId
    );

    if(!product){
      return;
    }

    const threshold=
      Number(
        getSetting(
          'low_stock_threshold',
          5
        )
      )||5;

    if(
      Number(product.stock||0)>
      threshold
    ){
      return;
    }

    const recent=db.prepare(`
      SELECT id
      FROM admin_notifications
      WHERE type='low_stock'
        AND data_json LIKE ?
        AND created_at>=?
      LIMIT 1
    `).get(
      `%${product.id}%`,
      new Date(
        Date.now()-
        24*60*60*1000
      ).toISOString()
    );

    if(recent){
      return;
    }

    createAdminNotification({
      type:'low_stock',
      title:'مخزون منخفض',
      message:
        `المنتج "${product.name}" أصبح مخزونه ${Number(product.stock||0)}.`,
      data:{
        productId:product.id,
        stock:Number(product.stock||0)
      }
    });

  }catch(e){
    console.error(e);
  }
}


// ------------------------------------------------------------
// ADMIN PERMISSIONS
// ------------------------------------------------------------

app.get(
  '/api/admin/permissions',
  auth(),
  adminOnly,
  (req,res)=>{
    try{

      const adminId=
        req.user?.adminId||
        req.user?.id;

      const admin=db.prepare(`
        SELECT
          id,
          name,
          email,
          role
        FROM admin_users
        WHERE id=?
        LIMIT 1
      `).get(
        adminId
      );

      if(!admin){
        return res.status(404).json({
          error:'ADMIN_NOT_FOUND'
        });
      }

      let permissions=[];

      try{
        const row=db.prepare(`
          SELECT permissions_json
          FROM admin_users
          WHERE id=?
          LIMIT 1
        `).get(
          admin.id
        );

        permissions=
          safeJson(
            row?.permissions_json,
            []
          );

      }catch{}

      res.json({
        admin,
        permissions
      });

    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'PERMISSIONS_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// UPDATE ADMIN PERMISSIONS
// ------------------------------------------------------------

app.patch(
  '/api/admin/permissions',
  auth(),
  adminOnly,
  (req,res)=>{
    try{

      const adminId=
        String(
          req.body.adminId||
          req.body.admin_id||
          ''
        ).trim();

      if(!adminId){
        return res.status(400).json({
          error:'ADMIN_ID_REQUIRED'
        });
      }

      const permissions=
        Array.isArray(
          req.body.permissions
        )?
        req.body.permissions:
        [];

      const admin=db.prepare(`
        SELECT id
        FROM admin_users
        WHERE id=?
        LIMIT 1
      `).get(
        adminId
      );

      if(!admin){
        return res.status(404).json({
          error:'ADMIN_NOT_FOUND'
        });
      }

      db.prepare(`
        UPDATE admin_users
        SET
          permissions_json=?
        WHERE id=?
      `).run(
        JSON.stringify(
          permissions
        ),
        adminId
      );

      res.json({
        ok:true
      });

    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'PERMISSIONS_UPDATE_FAILED'
      });
    }
  }
);
// ============================================================
// PART 4C — BACKUP / ADMIN MANAGEMENT / WHATSAPP / START
// ============================================================

// ------------------------------------------------------------
// BACKUP
// ------------------------------------------------------------

app.get(
  '/api/admin/backup',
  auth(),
  adminOnly,
  (req,res)=>{
    try{

      const tables=[
        'users',
        'admin_users',
        'products',
        'product_variants',
        'orders',
        'coupons',
        'store_settings',
        'inventory_movements'
      ];

      const backup={
        version:1,
        created_at:now(),
        tables:{}
      };

      for(
        const table
        of tables
      ){

        try{

          const rows=db.prepare(
            `SELECT * FROM ${table}`
          ).all();

          backup.tables[table]=rows;

        }catch{
          backup.tables[table]=[];
        }
      }

      res.json(
        backup
      );

    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'BACKUP_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// ADMIN LIST
// ------------------------------------------------------------

app.get(
  '/api/admin/admins',
  auth(),
  adminOnly,
  (req,res)=>{
    try{

      const rows=db.prepare(`
        SELECT
          id,
          name,
          email,
          role,
          active,
          created_at
        FROM admin_users
        ORDER BY created_at ASC
      `).all();

      res.json(rows);

    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'ADMINS_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// CREATE ADMIN
// ------------------------------------------------------------

app.post(
  '/api/admin/admins',
  auth(),
  adminOnly,
  async(req,res)=>{
    try{

      const name=
        String(
          req.body.name||''
        ).trim();

      const email=
        String(
          req.body.email||''
        ).trim()
        .toLowerCase();

      const password=
        String(
          req.body.password||''
        );

      const role=
        String(
          req.body.role||
          'admin'
        ).trim();

      if(
        !name ||
        !email ||
        !password
      ){
        return res.status(400).json({
          error:'ADMIN_FIELDS_REQUIRED'
        });
      }

      const existing=db.prepare(`
        SELECT id
        FROM admin_users
        WHERE LOWER(email)=?
        LIMIT 1
      `).get(
        email
      );

      if(existing){
        return res.status(409).json({
          error:'ADMIN_EMAIL_EXISTS'
        });
      }

      const adminId=id();

      const passwordHash=
        await hashPassword(
          password
        );

      db.prepare(`
        INSERT INTO admin_users(
          id,
          name,
          email,
          password_hash,
          role,
          active,
          created_at
        )
        VALUES(?,?,?,?,?,?,?)
      `).run(
        adminId,
        name,
        email,
        passwordHash,
        role,
        1,
        now()
      );

      res.status(201).json({
        ok:true,
        admin:{
          id:adminId,
          name,
          email,
          role,
          active:1
        }
      });

    }catch(e){
      console.error(e);

      res.status(400).json({
        error:'ADMIN_CREATE_FAILED',
        detail:e.message
      });
    }
  }
);


// ------------------------------------------------------------
// UPDATE ADMIN
// ------------------------------------------------------------

app.patch(
  '/api/admin/admins/:id',
  auth(),
  adminOnly,
  async(req,res)=>{
    try{

      const admin=db.prepare(`
        SELECT *
        FROM admin_users
        WHERE id=?
        LIMIT 1
      `).get(
        req.params.id
      );

      if(!admin){
        return res.status(404).json({
          error:'ADMIN_NOT_FOUND'
        });
      }

      const name=
        req.body.name!==undefined?
        String(
          req.body.name||''
        ).trim():
        admin.name;

      const email=
        req.body.email!==undefined?
        String(
          req.body.email||''
        ).trim()
        .toLowerCase():
        admin.email;

      const role=
        req.body.role!==undefined?
        String(
          req.body.role||'admin'
        ).trim():
        admin.role;

      const active=
        req.body.active!==undefined?
        (
          req.body.active?
          1:
          0
        ):
        Number(
          admin.active||0
        );

      db.prepare(`
        UPDATE admin_users
        SET
          name=?,
          email=?,
          role=?,
          active=?
        WHERE id=?
      `).run(
        name,
        email,
        role,
        active,
        admin.id
      );

      if(
        req.body.password
      ){

        const passwordHash=
          await hashPassword(
            String(
              req.body.password
            )
          );

        db.prepare(`
          UPDATE admin_users
          SET password_hash=?
          WHERE id=?
        `).run(
          passwordHash,
          admin.id
        );
      }

      res.json({
        ok:true
      });

    }catch(e){
      console.error(e);

      res.status(400).json({
        error:'ADMIN_UPDATE_FAILED',
        detail:e.message
      });
    }
  }
);


// ------------------------------------------------------------
// DELETE ADMIN
// ------------------------------------------------------------

app.delete(
  '/api/admin/admins/:id',
  auth(),
  adminOnly,
  (req,res)=>{
    try{

      const admin=db.prepare(`
        SELECT *
        FROM admin_users
        WHERE id=?
        LIMIT 1
      `).get(
        req.params.id
      );

      if(!admin){
        return res.status(404).json({
          error:'ADMIN_NOT_FOUND'
        });
      }

      if(
        admin.role==='owner'
      ){
        return res.status(400).json({
          error:'OWNER_CANNOT_BE_DELETED'
        });
      }

      db.prepare(`
        DELETE FROM admin_users
        WHERE id=?
      `).run(
        admin.id
      );

      res.json({
        ok:true
      });

    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'ADMIN_DELETE_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// WHATSAPP SEND HELPER
// ------------------------------------------------------------

async function sendWhatsAppMessage({
  phone,
  message
}={}){

  const cleanPhone=
    String(
      phone||''
    )
    .replace(
      /[^0-9+]/g,
      ''
    );

  if(
    !cleanPhone ||
    !message
  ){
    return {
      ok:false,
      error:'WHATSAPP_FIELDS_REQUIRED'
    };
  }

  /*
    WhatsApp provider integration
    can be connected through store settings.

    Supported settings:
      whatsapp_api_url
      whatsapp_api_token
      whatsapp_sender
  */

  const apiUrl=
    String(
      getSetting(
        'whatsapp_api_url',
        ''
      )||''
    ).trim();

  const apiToken=
    String(
      getSetting(
        'whatsapp_api_token',
        ''
      )||''
    ).trim();

  if(
    !apiUrl ||
    !apiToken
  ){

    return {
      ok:false,
      error:'WHATSAPP_NOT_CONFIGURED'
    };
  }

  try{

    const response=
      await fetch(
        apiUrl,
        {
          method:'POST',

          headers:{
            'Content-Type':
              'application/json',

            'Authorization':
              `Bearer ${apiToken}`
          },

          body:
            JSON.stringify({
              phone:cleanPhone,
              message:String(
                message
              )
            })
        }
      );

    const data=
      await response
        .json()
        .catch(
          ()=>({})
        );

    if(
      !response.ok
    ){
      return {
        ok:false,
        error:'WHATSAPP_PROVIDER_FAILED',
        data
      };
    }

    return {
      ok:true,
      data
    };

  }catch(e){

    console.error(
      'WHATSAPP_SEND_FAILED',
      e
    );

    return {
      ok:false,
      error:'WHATSAPP_SEND_FAILED'
    };
  }
}


// ------------------------------------------------------------
// MANUAL WHATSAPP MESSAGE
// ------------------------------------------------------------

app.post(
  '/api/admin/whatsapp/send',
  auth(),
  adminOnly,
  async(req,res)=>{
    try{

      const result=
        await sendWhatsAppMessage({
          phone:req.body.phone,
          message:req.body.message
        });

      if(!result.ok){
        return res.status(400).json(
          result
        );
      }

      res.json(
        result
      );

    }catch(e){
      console.error(e);

      res.status(500).json({
        error:'WHATSAPP_SEND_FAILED'
      });
    }
  }
);


// ------------------------------------------------------------
// ORDER WHATSAPP AUTOMATION
// ------------------------------------------------------------

async function whatsappOrderAutomation(
  orderId,
  event
){

  try{

    const order=db.prepare(`
      SELECT *
      FROM orders
      WHERE id=?
      LIMIT 1
    `).get(
      orderId
    );

    if(!order){
      return;
    }

    if(!order.user_id){
      return;
    }

    const user=db.prepare(`
      SELECT
        id,
        name,
        phone
      FROM users
      WHERE id=?
      LIMIT 1
    `).get(
      order.user_id
    );

    if(
      !user ||
      !user.phone
    ){
      return;
    }

    const templates=
      safeJson(
        getSetting(
          'whatsapp_templates',
          {}
        ),
        {}
      );

    const template=
      templates[event];

    if(!template){
      return;
    }

    const message=
      String(template)
        .replace(
          /\{name\}/g,
          String(
            user.name||''
          )
        )
        .replace(
          /\{order_id\}/g,
          String(
            order.id||''
          )
        )
        .replace(
          /\{total\}/g,
          String(
            order.total||0
          )
        )
        .replace(
          /\{status\}/g,
          String(
            order.status||''
          )
        );

    await sendWhatsAppMessage({
      phone:user.phone,
      message
    });

  }catch(e){

    console.error(
      'WHATSAPP_AUTOMATION_FAILED',
      e
    );
  }
}


// ------------------------------------------------------------
// APP ERROR HANDLER
// ------------------------------------------------------------

app.use(
  (err,req,res,next)=>{
    console.error(
      'UNHANDLED_ERROR',
      err
    );

    if(
      res.headersSent
    ){
      return next(err);
    }

    res.status(500).json({
      error:'INTERNAL_SERVER_ERROR'
    });
  }
);


// ------------------------------------------------------------
// START SERVER
// ------------------------------------------------------------

const PORT=
  Number(
    process.env.PORT||10000
  );

app.listen(
  PORT,
  '0.0.0.0',
  ()=>{
    console.log(
      `Ladies First API listening on ${PORT}`
    );
  }
);
