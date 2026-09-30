import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dbFile = process.env.DB_FILE || './data/ladies-first.sqlite';

fs.mkdirSync(path.dirname(dbFile), { recursive: true });

export const db = new Database(dbFile);

db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      contact TEXT NOT NULL UNIQUE,
      email TEXT,
      gender TEXT CHECK(gender IN ('male','female','other','unspecified'))
        DEFAULT 'unspecified',
      age INTEGER,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'customer'
        CHECK(role IN ('customer','admin')),
      is_owner INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      brand TEXT,
      category TEXT,
      price REAL NOT NULL DEFAULT 0,
      old_price REAL,
      cost_price REAL NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0,
      images_json TEXT NOT NULL DEFAULT '[]',
      variants_json TEXT NOT NULL DEFAULT '[]',
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

      FOREIGN KEY(product_id)
        REFERENCES products(id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      product_id TEXT NOT NULL,
      variant_id TEXT,

      color TEXT,
      size TEXT,

      before_stock INTEGER NOT NULL,
      after_stock INTEGER NOT NULL,
      delta INTEGER NOT NULL,

      reason TEXT NOT NULL,
      source TEXT,
      reference_id TEXT,

      created_at TEXT NOT NULL,

      FOREIGN KEY(product_id)
        REFERENCES products(id)
        ON DELETE CASCADE,

      FOREIGN KEY(variant_id)
        REFERENCES product_variants(id)
        ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS coupons (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL
        CHECK(type IN ('percent','fixed')),
      value REAL NOT NULL,
      min_total REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      starts_at TEXT,
      ends_at TEXT,
      usage_limit INTEGER,
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,

      user_id TEXT,

      status TEXT NOT NULL DEFAULT 'new',

      payment_method TEXT NOT NULL DEFAULT 'cod',

      subtotal REAL NOT NULL,

      discount REAL NOT NULL DEFAULT 0,

      loyalty_discount REAL NOT NULL DEFAULT 0,

      points_redeemed INTEGER NOT NULL DEFAULT 0,

      shipping REAL NOT NULL DEFAULT 0,

      packaging REAL NOT NULL DEFAULT 0,

      total REAL NOT NULL,

      customer_name TEXT NOT NULL,

      customer_contact TEXT NOT NULL,

      customer_address TEXT,

      customer_gender TEXT,

      customer_age INTEGER,

      coupon_code TEXT,

      inventory_state TEXT NOT NULL DEFAULT 'reserved',

      created_at TEXT NOT NULL,

      updated_at TEXT NOT NULL,

      FOREIGN KEY(user_id)
        REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      order_id TEXT NOT NULL,

      product_id TEXT NOT NULL,

      variant_name TEXT,

      name_snapshot TEXT NOT NULL,

      price_snapshot REAL NOT NULL,

      cost_snapshot REAL NOT NULL DEFAULT 0,

      quantity INTEGER NOT NULL,

      FOREIGN KEY(order_id)
        REFERENCES orders(id)
        ON DELETE CASCADE,

      FOREIGN KEY(product_id)
        REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS order_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      order_id TEXT NOT NULL,

      status TEXT NOT NULL,

      note TEXT,

      created_at TEXT NOT NULL,

      FOREIGN KEY(order_id)
        REFERENCES orders(id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS store_settings (
      key TEXT PRIMARY KEY,

      value_json TEXT NOT NULL,

      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_permissions (
      user_id TEXT PRIMARY KEY,

      permissions_json TEXT NOT NULL DEFAULT '{}',

      updated_at TEXT NOT NULL,

      FOREIGN KEY(user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS waitlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      product_id TEXT NOT NULL,

      contact TEXT NOT NULL,

      color TEXT NOT NULL DEFAULT '',

      size TEXT NOT NULL DEFAULT '',

      created_at TEXT NOT NULL,

      UNIQUE(product_id, contact, color, size),

      FOREIGN KEY(product_id)
        REFERENCES products(id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cart_snapshots (
      user_id TEXT PRIMARY KEY,

      items_json TEXT NOT NULL DEFAULT '[]',

      updated_at TEXT NOT NULL,

      FOREIGN KEY(user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS whatsapp_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      user_id TEXT NOT NULL,

      kind TEXT NOT NULL,

      product_id TEXT,

      fingerprint TEXT NOT NULL,

      sent_at TEXT NOT NULL,

      UNIQUE(user_id,kind,product_id,fingerprint),

      FOREIGN KEY(user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS loyalty_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      user_id TEXT NOT NULL,

      order_id TEXT,

      points INTEGER NOT NULL,

      kind TEXT NOT NULL,

      note TEXT,

      created_at TEXT NOT NULL,

      UNIQUE(user_id,order_id,kind),

      FOREIGN KEY(user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
    );
  `);

  /*
   * USERS MIGRATIONS
   */

  const userCols = db
    .prepare('PRAGMA table_info(users)')
    .all()
    .map(x => x.name);

  if (!userCols.includes('is_owner')) {
    db.exec(`
      ALTER TABLE users
      ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0
    `);
  }

  if (!userCols.includes('active')) {
    db.exec(`
      ALTER TABLE users
      ADD COLUMN active INTEGER NOT NULL DEFAULT 1
    `);
  }

  if (!userCols.includes('whatsapp_opt_in')) {
    db.exec(`
      ALTER TABLE users
      ADD COLUMN whatsapp_opt_in INTEGER NOT NULL DEFAULT 0
    `);
  }

  /*
   * PRODUCTS MIGRATIONS
   */

  const productCols = db
    .prepare('PRAGMA table_info(products)')
    .all()
    .map(x => x.name);

  if (!productCols.includes('metadata_json')) {
    db.exec(`
      ALTER TABLE products
      ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'
    `);
  }

  /*
   * WAITLIST MIGRATION
   *
   * Old version had:
   * product_id + contact
   *
   * New version supports:
   * product + color + size + contact
   */

  const waitlistCols = db
    .prepare('PRAGMA table_info(waitlist)')
    .all()
    .map(x => x.name);

  if (
    !waitlistCols.includes('color') ||
    !waitlistCols.includes('size')
  ) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS waitlist_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        product_id TEXT NOT NULL,

        contact TEXT NOT NULL,

        color TEXT NOT NULL DEFAULT '',

        size TEXT NOT NULL DEFAULT '',

        created_at TEXT NOT NULL,

        UNIQUE(product_id, contact, color, size),

        FOREIGN KEY(product_id)
          REFERENCES products(id)
          ON DELETE CASCADE
      );

      INSERT OR IGNORE INTO waitlist_new
        (id, product_id, contact, color, size, created_at)

      SELECT
        id,
        product_id,
        contact,
        '',
        '',
        created_at

      FROM waitlist;

      DROP TABLE waitlist;

      ALTER TABLE waitlist_new
      RENAME TO waitlist;
    `);
  }

  /*
   * OWNER
   */

  if (
    !db
      .prepare(
        "SELECT 1 FROM users WHERE role='admin' AND is_owner=1 LIMIT 1"
      )
      .get()
  ) {
    db.prepare(`
      UPDATE users
      SET is_owner=1
      WHERE id=(
        SELECT id
        FROM users
        WHERE role='admin'
        ORDER BY created_at ASC
        LIMIT 1
      )
    `).run();
  }

  /*
   * INDEXES
   */

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_products_active_created
    ON products(active,created_at);

    CREATE INDEX IF NOT EXISTS idx_orders_status_created
    ON orders(status,created_at);

    CREATE INDEX IF NOT EXISTS idx_order_items_product
    ON order_items(product_id);

    CREATE INDEX IF NOT EXISTS idx_users_role_created
    ON users(role,created_at);

    CREATE INDEX IF NOT EXISTS idx_product_variants_product
    ON product_variants(product_id);

    CREATE INDEX IF NOT EXISTS idx_product_variants_stock
    ON product_variants(product_id,stock);

    CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_created
    ON inventory_movements(product_id,created_at);

    CREATE INDEX IF NOT EXISTS idx_inventory_movements_variant_created
    ON inventory_movements(variant_id,created_at);

    CREATE INDEX IF NOT EXISTS idx_waitlist_product_variant
    ON waitlist(product_id,color,size);
  `);

  /*
   * ORDERS MIGRATIONS
   */

  const orderCols = db
    .prepare('PRAGMA table_info(orders)')
    .all()
    .map(x => x.name);

  if (!orderCols.includes('loyalty_discount')) {
    db.exec(`
      ALTER TABLE orders
      ADD COLUMN loyalty_discount REAL NOT NULL DEFAULT 0
    `);
  }

  if (!orderCols.includes('points_redeemed')) {
    db.exec(`
      ALTER TABLE orders
      ADD COLUMN points_redeemed INTEGER NOT NULL DEFAULT 0
    `);
  }
}
