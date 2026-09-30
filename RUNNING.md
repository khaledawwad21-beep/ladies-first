# تشغيل Ladies First كمنظومة واحدة

## الطريقة الموصى بها

لا تفتح `index.html` أو `admin.html` من مدير الملفات مباشرة.

شغّل السيرفر أولًا، ثم افتح:

- المتجر: `http://localhost:3000/`
- لوحة التحكم: `http://localhost:3000/admin`
- فحص السيرفر: `http://localhost:3000/api/health`

## أول تشغيل

إذا لم توجد أي حسابات إدارية، ستظهر في `/admin` شاشة **إعداد المالك**. أدخل اسمك وإيميلك وكلمة المرور، وسيُنشأ حساب Owner تلقائيًا.

لا توجد بيانات دخول افتراضية.

## Windows

شغّل `start.bat`.

## Linux / macOS / Termux

شغّل:

```bash
./start.sh
```

السكريبت يثبت الاعتمادات تلقائيًا عند الحاجة، وينشئ `backend/.env` مع JWT secret عشوائي إذا لم يكن موجودًا.

## Docker

```bash
docker compose up -d --build
```

ثم افتح `http://localhost:3000/admin`.

## مهم

إذا فتحت HTML مباشرة وظهر `content://media/external/...` فهذا ليس تشغيلًا كاملًا للمشروع؛ المتصفح لم يشغّل الـBackend. استخدم عنوان السيرفر أعلاه.
