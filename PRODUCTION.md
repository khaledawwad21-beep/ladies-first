# Ladies First — Production Checklist

## Required environment
- `NODE_ENV=production`
- Strong `JWT_SECRET` (32+ random characters)
- `CORS_ORIGIN` set to the real origin when cross-origin access is required
- `DB_FILE` on persistent storage

## Deployment
- Recommended: Docker Compose with a persistent volume for `backend/data`.
- Put the app behind HTTPS/reverse proxy.
- Keep `backend/data` out of public static files except `/uploads`.
- Schedule database backups.
- Monitor disk usage for uploads and backups.

## Admin operations
- Product images are uploaded through the API and stored as files, not Data URLs.
- Low-stock and pending-order notifications are available in the admin UI.
- Database backup can be downloaded from the admin panel.
- Granular admin permissions are stored through the permissions API; enforce the chosen permission set before delegating admin access to staff.

## Payments
Do not mark an order as paid from the browser. Configure a real payment provider and verify its webhook/signature server-side before changing payment state.

## Before launch
- Configure the real domain and HTTPS.
- Configure a real payment provider if online card payments are required.
- Test registration/login, profile edits, gender changes, stock races, cancellations, coupon limits and image uploads.
- Test backups and restore procedures.
- Test on current Android/iOS browsers and desktop browsers.

## إدارة حسابات الإداريين

أول حساب يتم إنشاؤه عبر `/api/admin/bootstrap` يصبح `Owner` بصلاحية كاملة. من لوحة التحكم يظهر قسم **حسابات الإداريين** للمالك فقط. يمكن للمالك إنشاء إداريين، تحديد الصلاحيات، تغيير كلمة المرور، وتعطيل الحساب. الصلاحيات تُفرض على الـAPI نفسه وليست مجرد إخفاء أزرار. الإداري العادي لا يستطيع إنشاء مالك آخر أو تعديل حساب المالك.

الصلاحيات المتاحة: لوحة المعلومات، المنتجات والمخزون، الطلبات، المستخدمون، أكواد الخصم، إعدادات المتجر، رفع الصور، قائمة الانتظار، التقارير، والنسخ الاحتياطي.


## First run
Open `/admin`. If no administrator exists, the system shows the one-time Owner setup screen. Create your Owner account there. After the first Owner is created, the setup endpoint is permanently unavailable unless the database is intentionally reset.

## WhatsApp automation & loyalty
- WhatsApp reminders are server-side and only sent to customers who explicitly opt in.
- Configure `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ABANDONED_TEMPLATE`, and `WHATSAPP_LOW_STOCK_TEMPLATE` in the backend environment.
- Meta/WhatsApp requires approved message templates for proactive messages outside the customer-service window.
- Admin > الأتمتة والنقاط controls: enable/disable, abandoned-cart delay, low-stock threshold, cooldown, points mode, points per order or per purchase amount, point value, and award timing.
- Loyalty points are awarded server-side to prevent client-side tampering. Default award timing is delivery.

## Render test deployment

The repository includes `render.yaml` and `RENDER-DEPLOY.md` for a one-service Render test deployment. The current SQLite database is intentionally treated as temporary on Render Free; use PostgreSQL/object storage before production.
