# Hasinah Dispatch

تطبيق داخلي لتنظيم طلبات التوصيل والإرجاع والاستبدال ومشاوير السائقين في جدة.

## التشغيل المحلي

```powershell
node server.js
```

ثم افتح:

```text
http://localhost:4173
```

الحساب الأول:

```text
yahya / 123123
```

## الشاشات

- `إضافة طلب`: شاشة مستقلة لإدخال طلب جديد.
- `لوحة الطلبات`: شاشة مستقلة للبحث والفلاتر والإحصائيات.
- `السائق`: طلبات السائق والمبلغ المستحق.
- `الحسابات`: إنشاء مديرين وسائقين.
- `المراجعة`: قبول أو رفض طلبات التأجيل والاعتراضات.

## GitHub

الملفات المحلية الحساسة وبيانات التشغيل محفوظة خارج Git عبر `.gitignore`.

قبل الرفع:

```powershell
git init
git add .
git commit -m "Initial Hasinah dispatch app"
```

## Supabase

The app can now use Supabase as the shared live database for all computers.

Run this SQL file in Supabase SQL Editor:

```text
supabase/schema.sql
```

Then add these Render environment variables:

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

If these variables are missing, the app falls back to `data/dispatch-state.json` for local testing only.
# Zid

The app is ready to receive and sync Jeddah orders from Zid.

Required Render environment variables:

```text
ZID_AUTHORIZATION=Bearer your-zid-authorization
ZID_MANAGER_TOKEN=your-zid-manager-token
ZID_WEBHOOK_USERNAME=hasinah
ZID_WEBHOOK_PASSWORD=change-this-long-secret
ZID_CITY_MATCH=jeddah,جدة,jidda,jedda
ZID_READY_STATUSES=ready
ZID_IN_DELIVERY_STATUS=indelivery
```

Webhook target URL:

```text
https://YOUR-RENDER-LINK.onrender.com/api/zid/webhook
```

Subscribe Zid webhooks to:

```text
order.create
order.status.update
```

The sync button in the orders dashboard also pulls recent ready Jeddah orders manually. When an admin assigns a Zid order to a driver, the app pushes the Zid order status to `indelivery`.

## Shipping Policies

Admins can mark an order as ready for pickup from the orders dashboard. This generates a printable shipping policy with:

- Customer and order details.
- A WhatsApp QR code for the customer phone number.
- A unique 10-digit shipping policy number.
- A Code 39 barcode for searching or tracking by policy number.

Policy numbers are never reused, including after deleting and regenerating a policy. A policy can be deleted and regenerated only before the driver marks the order delivered.
