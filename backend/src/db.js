import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dbFile = process.env.DB_FILE || './data/ladies-first.sqlite';
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

export const db = new Database(dbFile);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

const now = () => new Date().toISOString();

function columns(table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(x => x.name));
}

function addColumn(table, name, definition) {
  if (!columns(table).has(name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      contact TEXT UNIQUE,
      phone TEXT,
      email TEXT,
      gender TEXT DEFAULT 'unspecified',
      age INTEGER,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'customer',
      is_admin INTEGER NOT NULL DEFAULT 0,
      is_owner INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      points INTEGER NOT NULL DEFAULT 0,
      whatsapp_opt_in INTEGER NOT NULL DEFAULT 0,
      cart_fingerprint TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT,
      description TEXT,
      brand TEXT,
      category TEXT,
      price REAL NOT NULL DEFAULT 0,
      old_price REAL,
      cost REAL NOT NULL DEFAULT 0,
      cost_price REAL NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0,
      images_json TEXT NOT NULL DEFAULT '[]',
      variants_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_variants (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '',
      size TEXT NOT NULL DEFAULT '',
      sku TEXT NOT NULL DEFAULT '',
      stock INTEGER NOT NULL DEFAULT 0,
      images_json TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(product_id,color,size),
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL,
      variant_id TEXT,
      color TEXT,
      size TEXT,
      before_stock INTEGER NOT NULL DEFAULT 0,
      after_stock INTEGER NOT NULL DEFAULT 0,
      delta INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL,
      source TEXT,
      reference_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY(variant_id) REFERENCES product_variants(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS coupons (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'percent',
      value REAL NOT NULL DEFAULT 0,
      min_total REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      starts_at TEXT,
      ends_at TEXT,
      expires_at TEXT,
      usage_limit INTEGER,
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      payment_method TEXT NOT NULL DEFAULT 'cod',
      items_json TEXT NOT NULL DEFAULT '[]',
      shipping_json TEXT NOT NULL DEFAULT '{}',
      payment_json TEXT NOT NULL DEFAULT '{}',
      totals_json TEXT NOT NULL DEFAULT '{}',
      subtotal REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      loyalty_discount REAL NOT NULL DEFAULT 0,
      points_redeemed INTEGER NOT NULL DEFAULT 0,
      shipping REAL NOT NULL DEFAULT 0,
      packaging REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      cost_total REAL NOT NULL DEFAULT 0,
      coupon_id TEXT,
      coupon_code TEXT,
      points_used INTEGER NOT NULL DEFAULT 0,
      points_awarded INTEGER NOT NULL DEFAULT 0,
      customer_name TEXT,
      customer_contact TEXT,
      customer_address TEXT,
      customer_gender TEXT,
      customer_age INTEGER,
      inventory_state TEXT NOT NULL DEFAULT 'reserved',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      variant_id TEXT,
      variant_name TEXT,
      color TEXT,
      size TEXT,
      name_snapshot TEXT NOT NULL,
      price_snapshot REAL NOT NULL DEFAULT 0,
      cost_snapshot REAL NOT NULL DEFAULT 0,
      quantity INTEGER NOT NULL DEFAULT 1,
      discount_snapshot REAL NOT NULL DEFAULT 0,
      created_at TEXT,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS order_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS store_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT,
      value TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      is_owner INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS admin_permissions (
      user_id TEXT PRIMARY KEY,
      permissions_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS admin_notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT,
      title TEXT,
      message TEXT,
      data_json TEXT NOT NULL DEFAULT '{}',
      read_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS waitlist (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      variant_id TEXT,
      user_id TEXT,
      contact TEXT,
      email TEXT,
      phone TEXT,
      color TEXT NOT NULL DEFAULT '',
      size TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'waiting',
      created_at TEXT NOT NULL,
      updated_at TEXT,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(variant_id) REFERENCES product_variants(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS cart_snapshots (
      user_id TEXT PRIMARY KEY,
      items_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS whatsapp_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      product_id TEXT,
      fingerprint TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      UNIQUE(user_id,kind,product_id,fingerprint),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS loyalty_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      order_id TEXT,
      points INTEGER NOT NULL,
      kind TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS product_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      slug TEXT UNIQUE,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_brands (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      slug TEXT UNIQUE,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_colors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      hex TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_sizes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_reviews (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      user_id TEXT,
      order_id TEXT,
      rating INTEGER NOT NULL,
      body TEXT,
      images_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      points_awarded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS return_requests (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      user_id TEXT,
      type TEXT NOT NULL DEFAULT 'return',
      status TEXT NOT NULL DEFAULT 'pending',
      reason TEXT,
      customer_note TEXT,
      admin_note TEXT,
      photos_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS return_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_request_id TEXT NOT NULL,
      order_item_id INTEGER,
      product_id TEXT NOT NULL,
      variant_id TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      condition TEXT,
      reason TEXT,
      FOREIGN KEY(return_request_id) REFERENCES return_requests(id) ON DELETE CASCADE,
      FOREIGN KEY(order_item_id) REFERENCES order_items(id) ON DELETE SET NULL,
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS return_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_request_id TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(return_request_id) REFERENCES return_requests(id) ON DELETE CASCADE
    );
  `);
}

function migrateColumns() {
  const t = now();

  // USERS
  addColumn('users','contact','TEXT');
  addColumn('users','phone','TEXT');
  addColumn('users','email','TEXT');
  addColumn('users','gender',"TEXT DEFAULT 'unspecified'");
  addColumn('users','age','INTEGER');
  addColumn('users','password_hash','TEXT');
  addColumn('users','role',"TEXT NOT NULL DEFAULT 'customer'");
  addColumn('users','is_admin','INTEGER NOT NULL DEFAULT 0');
  addColumn('users','is_owner','INTEGER NOT NULL DEFAULT 0');
  addColumn('users','active','INTEGER NOT NULL DEFAULT 1');
  addColumn('users','points','INTEGER NOT NULL DEFAULT 0');
  addColumn('users','whatsapp_opt_in','INTEGER NOT NULL DEFAULT 0');
  addColumn('users','cart_fingerprint','TEXT');
  addColumn('users','created_at',`TEXT NOT NULL DEFAULT '${t}'`);
  addColumn('users','updated_at',`TEXT NOT NULL DEFAULT '${t}'`);

  // PRODUCTS
  addColumn('products','slug','TEXT');
  addColumn('products','description','TEXT');
  addColumn('products','brand','TEXT');
  addColumn('products','category','TEXT');
  addColumn('products','price','REAL NOT NULL DEFAULT 0');
  addColumn('products','old_price','REAL');
  addColumn('products','cost','REAL NOT NULL DEFAULT 0');
  addColumn('products','cost_price','REAL NOT NULL DEFAULT 0');
  addColumn('products','stock','INTEGER NOT NULL DEFAULT 0');
  addColumn('products','images_json',"TEXT NOT NULL DEFAULT '[]'");
  addColumn('products','variants_json',"TEXT NOT NULL DEFAULT '[]'");
  addColumn('products','metadata_json',"TEXT NOT NULL DEFAULT '{}'");
  addColumn('products','active','INTEGER NOT NULL DEFAULT 1');
  addColumn('products','created_at',`TEXT NOT NULL DEFAULT '${t}'`);
  addColumn('products','updated_at',`TEXT NOT NULL DEFAULT '${t}'`);

  // VARIANTS
  addColumn('product_variants','color',"TEXT NOT NULL DEFAULT ''");
  addColumn('product_variants','size',"TEXT NOT NULL DEFAULT ''");
  addColumn('product_variants','sku',"TEXT NOT NULL DEFAULT ''");
  addColumn('product_variants','stock','INTEGER NOT NULL DEFAULT 0');
  addColumn('product_variants','images_json',"TEXT NOT NULL DEFAULT '[]'");
  addColumn('product_variants','active','INTEGER NOT NULL DEFAULT 1');
  addColumn('product_variants','created_at',`TEXT NOT NULL DEFAULT '${t}'`);
  addColumn('product_variants','updated_at',`TEXT NOT NULL DEFAULT '${t}'`);

  // INVENTORY
  addColumn('inventory_movements','variant_id','TEXT');
  addColumn('inventory_movements','color','TEXT');
    addColumn('inventory_movements','size','TEXT');
  addColumn('inventory_movements','before_stock','INTEGER NOT NULL DEFAULT 0');
  addColumn('inventory_movements','after_stock','INTEGER NOT NULL DEFAULT 0');
  addColumn('inventory_movements','delta','INTEGER NOT NULL DEFAULT 0');
  addColumn('inventory_movements','reason',"TEXT NOT NULL DEFAULT 'adjustment'");
  addColumn('inventory_movements','source','TEXT');
  addColumn('inventory_movements','reference_id','TEXT');
  addColumn('inventory_movements','created_at',`TEXT NOT NULL DEFAULT '${t}'`);

  // COUPONS
  addColumn('coupons','min_total','REAL NOT NULL DEFAULT 0');
  addColumn('coupons','starts_at','TEXT');
  addColumn('coupons','ends_at','TEXT');
  addColumn('coupons','expires_at','TEXT');
  addColumn('coupons','usage_limit','INTEGER');
  addColumn('coupons','usage_count','INTEGER NOT NULL DEFAULT 0');
  addColumn('coupons','updated_at',`TEXT NOT NULL DEFAULT '${t}'`);

  // ORDERS
  const orderDefs = {
    user_id:'TEXT','status':"TEXT NOT NULL DEFAULT 'new'",'payment_method':"TEXT NOT NULL DEFAULT 'cod'",
    items_json:"TEXT NOT NULL DEFAULT '[]'", shipping_json:"TEXT NOT NULL DEFAULT '{}'", payment_json:"TEXT NOT NULL DEFAULT '{}'", totals_json:"TEXT NOT NULL DEFAULT '{}'",
    subtotal:'REAL NOT NULL DEFAULT 0', discount:'REAL NOT NULL DEFAULT 0', loyalty_discount:'REAL NOT NULL DEFAULT 0', points_redeemed:'INTEGER NOT NULL DEFAULT 0',
    shipping:'REAL NOT NULL DEFAULT 0', packaging:'REAL NOT NULL DEFAULT 0', total:'REAL NOT NULL DEFAULT 0', cost_total:'REAL NOT NULL DEFAULT 0',
    coupon_id:'TEXT', coupon_code:'TEXT', points_used:'INTEGER NOT NULL DEFAULT 0', points_awarded:'INTEGER NOT NULL DEFAULT 0',
    customer_name:'TEXT', customer_contact:'TEXT', customer_address:'TEXT', customer_gender:'TEXT', customer_age:'INTEGER',
    inventory_state:"TEXT NOT NULL DEFAULT 'reserved'", created_at:`TEXT NOT NULL DEFAULT '${t}'`, updated_at:`TEXT NOT NULL DEFAULT '${t}'`
  };
  for (const [k,v] of Object.entries(orderDefs)) addColumn('orders',k,v);

  // ORDER ITEMS
  addColumn('order_items','variant_id','TEXT');
  addColumn('order_items','variant_name','TEXT');
  addColumn('order_items','color','TEXT');
  addColumn('order_items','size','TEXT');
  addColumn('order_items','name_snapshot',"TEXT NOT NULL DEFAULT ''");
  addColumn('order_items','price_snapshot','REAL NOT NULL DEFAULT 0');
  addColumn('order_items','cost_snapshot','REAL NOT NULL DEFAULT 0');
  addColumn('order_items','quantity','INTEGER NOT NULL DEFAULT 1');
  addColumn('order_items','discount_snapshot','REAL NOT NULL DEFAULT 0');
  addColumn('order_items','created_at','TEXT');

  // SETTINGS
  addColumn('store_settings','value_json','TEXT');
  addColumn('store_settings','value','TEXT');
  addColumn('store_settings','updated_at',`TEXT NOT NULL DEFAULT '${t}'`);

  // ADMINS
  addColumn('admin_users','role',"TEXT NOT NULL DEFAULT 'admin'");
  addColumn('admin_users','is_owner','INTEGER NOT NULL DEFAULT 0');
  addColumn('admin_users','active','INTEGER NOT NULL DEFAULT 1');
  addColumn('admin_users','created_at',`TEXT NOT NULL DEFAULT '${t}'`);
  addColumn('admin_users','updated_at',`TEXT NOT NULL DEFAULT '${t}'`);

  // WAITLIST
  addColumn('waitlist','variant_id','TEXT');
  addColumn('waitlist','user_id','TEXT');
  addColumn('waitlist','email','TEXT');
  addColumn('waitlist','phone','TEXT');
  addColumn('waitlist','color',"TEXT NOT NULL DEFAULT ''");
  addColumn('waitlist','size',"TEXT NOT NULL DEFAULT ''");
  addColumn('waitlist','status',"TEXT NOT NULL DEFAULT 'waiting'");
  addColumn('waitlist','updated_at',`TEXT NOT NULL DEFAULT '${t}'`);

  // JSON/default fields for other feature tables when upgrading old DBs.
  addColumn('admin_permissions','permissions_json',"TEXT NOT NULL DEFAULT '{}' ");
  addColumn('admin_permissions','updated_at',`TEXT NOT NULL DEFAULT '${t}'`);
  addColumn('admin_notifications','data_json',"TEXT NOT NULL DEFAULT '{}' ");
  addColumn('admin_notifications','read_at','TEXT');
  addColumn('admin_notifications','created_at',`TEXT NOT NULL DEFAULT '${t}'`);
}

function normalizeData() {
  const t = now();

  // Keep old/new cost columns synchronized. Server uses products.cost.
  db.exec(`UPDATE products SET cost = COALESCE(cost, cost_price, 0) WHERE cost IS NULL OR cost=0`);
  db.exec(`UPDATE products SET cost_price = COALESCE(cost, 0) WHERE cost_price IS NULL OR cost_price=0`);

  // Server uses ends_at. Keep legacy expires_at available too.
  db.exec(`UPDATE coupons SET ends_at = expires_at WHERE (ends_at IS NULL OR ends_at='') AND expires_at IS NOT NULL`);
  db.exec(`UPDATE coupons SET expires_at = ends_at WHERE (expires_at IS NULL OR expires_at='') AND ends_at IS NOT NULL`);

  // Settings: value_json is canonical for the current server.
  db.exec(`UPDATE store_settings SET value_json=value WHERE (value_json IS NULL OR value_json='') AND value IS NOT NULL`);
  db.exec(`UPDATE store_settings SET value=value_json WHERE (value IS NULL OR value='') AND value_json IS NOT NULL`);

  // Customer compatibility: never leave role='user', because the schema/server use customer.
  try { db.exec(`UPDATE users SET role='customer' WHERE role IS NULL OR role='' OR role='user'`); } catch {}
  try { db.exec(`UPDATE users SET is_admin=1 WHERE role='admin'`); } catch {}
  try { db.exec(`UPDATE users SET updated_at='${t}' WHERE updated_at IS NULL OR updated_at=''`); } catch {}

  // Derive a contact when an old account only has email/phone.
  try {
    db.exec(`UPDATE users SET contact=COALESCE(NULLIF(phone,''),NULLIF(email,''),id) WHERE contact IS NULL OR contact=''`);
  } catch {}
}

function indexes() {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_products_active_created ON products(active,created_at);
    CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
    CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);
    CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id);
    CREATE INDEX IF NOT EXISTS idx_product_variants_stock ON product_variants(product_id,stock);
    CREATE INDEX IF NOT EXISTS idx_inventory_product_created ON inventory_movements(product_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_inventory_variant_created ON inventory_movements(variant_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status,created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_users_role_created ON users(role,created_at);
    CREATE INDEX IF NOT EXISTS idx_waitlist_product_variant ON waitlist(product_id,variant_id,color,size,status);
    CREATE INDEX IF NOT EXISTS idx_reviews_product_status ON product_reviews(product_id,status);
    CREATE INDEX IF NOT EXISTS idx_returns_order ON return_requests(order_id);
  `);
}

export function migrate() {
  const tx = db.transaction(() => {
    createTables();
    migrateColumns();
    normalizeData();
    indexes();
  });
  tx();
}

migrate();

export function getDatabase() { return db; }
export function closeDatabase() { db.close(); }
export function transaction(fn) { return db.transaction(fn)(); }

export const databaseReady = true;
