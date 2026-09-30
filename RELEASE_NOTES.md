# Ladies First — Professional Release

## Implemented
- Centralized API/SQLite data for users, products, inventory, orders, coupons and store settings.
- Server-side atomic inventory reservation and release on cancellation.
- Customer profile sync, including gender/age, so greeting can follow current server data.
- Top 5 and Best Sellers as compact horizontal carousels.
- Best Sellers calculated from non-cancelled orders, with a 7-day window and all-time fallback.
- Server-side product search/filter/pagination endpoint.
- Real image uploads from the admin panel to `backend/data/uploads` (max 5 MB per image), with legacy Data URLs migrated on product save.
- Storefront/admin CSS extracted into `index.css` and `admin.css` to remove accumulated inline style blocks.
- Admin low-stock and pending-order notifications.
- SQLite backup download from the admin panel.
- Admin permission storage API for future granular roles.
- Same-origin production routing: `/` storefront and `/admin` admin panel.
- Production security checks, Helmet, rate limits, JWT and bcrypt password hashing.
- PWA manifest, robots and theme metadata.

## Provider-dependent
- Online card payments require selecting/configuring a real payment provider. The API exposes a guarded adapter endpoint and deliberately does not fake payment confirmation.

## Deployment
1. Copy `backend/.env.example` to `backend/.env`.
2. Set a strong `JWT_SECRET` (32+ characters), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `SETUP_KEY` if bootstrap is used.
3. Build/run with Docker Compose or install backend dependencies and run `npm start`.
4. Use HTTPS and a real domain in production.
5. Take regular backups from `/api/admin/backup`.
