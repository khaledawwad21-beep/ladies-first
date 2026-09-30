# Ladies First — Render deployment

هذه النسخة مجهزة لتعمل كـ Node/Express Web Service على Render.

## 1) ارفع المشروع إلى GitHub

أنشئ Repository جديد باسم `ladies-first` ثم ارفع **محتويات هذا المجلد** إلى جذر الـRepository، بحيث يكون `render.yaml` بجانب `index.html` و`admin.html`.

لا ترفع:
- `backend/.env`
- `backend/data/`
- أي ملفات SQLite حقيقية
- كلمات مرور أو مفاتيح WhatsApp

## 2) أنشئ الخدمة في Render

في Render:
1. New → Blueprint
2. اختر GitHub Repository الخاص بالمشروع.
3. Render سيقرأ `render.yaml` تلقائيًا.
4. وافق على إنشاء Web Service باسم `ladies-first`.
5. اختر Free للتجربة.

بعد نجاح النشر سيظهر رابط مثل:
`https://ladies-first-xxxx.onrender.com`

## 3) اختبر الموقع

- المتجر: `/`
- لوحة التحكم: `/admin.html` أو `/admin`
- صحة الخادم: `/api/health`

مثال:
`https://YOUR-DOMAIN.onrender.com/api/health`

يجب أن يظهر JSON يحتوي على `ok: true`.

## 4) إنشاء مالك لوحة التحكم لأول مرة

افتح:
`https://YOUR-DOMAIN.onrender.com/admin.html`

إذا لم يوجد أي Admin في قاعدة البيانات ستظهر شاشة إعداد المالك.
استخدم كلمة مرور قوية، والنظام يطلب حاليًا 12 حرفًا على الأقل عند إنشاء المالك عبر الـAPI.

## 5) WhatsApp

لا تضع Access Token داخل HTML أو GitHub.
ضع القيم من Render → Environment:
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`

والقوالب:
- `WHATSAPP_ABANDONED_TEMPLATE`
- `WHATSAPP_LOW_STOCK_TEMPLATE`

يجب أن تكون القوالب معتمدة في Meta حتى يتم الإرسال الحقيقي.

## 6) مهم جدًا للتجربة

هذه النسخة تستخدم SQLite محليًا. Render Free يستخدم نظام ملفات مؤقتًا؛ لذلك بيانات SQLite والملفات المرفوعة قد تضيع عند إعادة التشغيل أو إعادة النشر أو إيقاف الخدمة بسبب الخمول.

هذا مقصود لمرحلة الاختبار فقط. قبل اعتماد الموقع فعليًا سننقل قاعدة البيانات إلى PostgreSQL/مخزن دائم ونفصل تخزين الصور عن نظام الملفات المحلي.
