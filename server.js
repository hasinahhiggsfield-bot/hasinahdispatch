const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "data", "dispatch-state.json");
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_STATE_ID = "dispatch";
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const DAY_MS = 24 * 60 * 60 * 1000;
const ZID_API_BASE = "https://api.zid.sa/v1/managers";
const ZID_DASHBOARD_ORDER_BASE = process.env.ZID_DASHBOARD_ORDER_BASE || "https://dashboard.zid.sa/en-sa/stores/1102974/orders/";
const ZID_OAUTH_BASE = (process.env.ZID_OAUTH_URL || "https://oauth.zid.sa").replace(/\/$/, "");
const ZID_CLIENT_ID = process.env.ZID_CLIENT_ID || "";
const ZID_CLIENT_SECRET = process.env.ZID_CLIENT_SECRET || "";
const ZID_REDIRECT_URI = process.env.ZID_REDIRECT_URI || "";
const ZID_CITY_MATCH = (process.env.ZID_CITY_MATCH || "jeddah,جدة,jidda,jedda,jiddah,جده").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
const ZID_READY_STATUSES = (process.env.ZID_READY_STATUSES || "ready,preparing,under_review,under review,review,جاري التجهيز,قيد المراجعة,تحت المراجعة,جاهز").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
const ZID_SHIPPING_METHOD_MATCH = (process.env.ZID_SHIPPING_METHOD_MATCH || "مندوب جدة,مندوب جده,jeddah delegate,jeddah courier").split(",").map((item) => item.trim()).filter(Boolean);
const ZID_EXCLUDED_STATUSES = (process.env.ZID_EXCLUDED_STATUSES || "returned,returning,return requested,return_in_progress,reverse,reverse pickup,refund,refunded,exchange,exchanged,استرجاع,ارجاع,إرجاع,مرتجع,مسترجع,جاري الاسترجاع,جارى الاسترجاع,قيد الاسترجاع,تحت الاسترجاع,تم الاسترجاع,طلب استرجاع,استبدال,مستبدل").split(",").map((item) => item.trim()).filter(Boolean);
const ZID_SYNC_INCLUDE_DAYS = Number(process.env.ZID_SYNC_INCLUDE_DAYS || 2);
const ZID_IN_DELIVERY_STATUS = process.env.ZID_IN_DELIVERY_STATUS || "indelivery";
const ZID_DELIVERED_STATUS = process.env.ZID_DELIVERED_STATUS || "delivered";
const ZID_PENDING_RETURN_STATUS = process.env.ZID_PENDING_RETURN_STATUS || "pending_return";
const ZID_RETURNED_STATUS = process.env.ZID_RETURNED_STATUS || "returned";
const ZID_READY_STATUS_ALIASES = [
  "ready",
  "preparing",
  "under_review",
  "under review",
  "review",
  "in_review",
  "in review",
  "جاري التجهيز",
  "قيد المراجعة",
  "تحت المراجعة",
  "جاهز",
  "قيد التجهيز"
].map((item) => normalizeText(item));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

function seedState() {
  return {
    users: [{ id: uid("usr"), role: "admin", name: "يحيى", username: "yahya", password: "123123", phone: "" }],
    orders: [],
    payments: [],
    routePlans: []
  };
}

async function readLocalState() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.users) && Array.isArray(parsed.orders)) {
      parsed.payments = Array.isArray(parsed.payments) ? parsed.payments : [];
      parsed.routePlans = Array.isArray(parsed.routePlans) ? parsed.routePlans : [];
      return parsed;
    }
  } catch {
    // Create a clean state on first run.
  }
  const initial = seedState();
  await writeLocalState(initial);
  return initial;
}

async function writeLocalState(state) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(state, null, 2), "utf8");
}

async function supabaseRequest(pathname, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`Supabase request failed (${response.status}): ${message || response.statusText}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function readSupabaseState() {
  const rows = await supabaseRequest(`hasinah_state?id=eq.${encodeURIComponent(SUPABASE_STATE_ID)}&select=data&limit=1`, {
    headers: { accept: "application/json" }
  });
  const state = rows?.[0]?.data;
  const local = await readLocalState();
  if (state && Array.isArray(state.users) && Array.isArray(state.orders)) {
    const localHasMoreData = (local.users?.length || 0) > state.users.length || (local.orders?.length || 0) > state.orders.length;
    if (localHasMoreData && state.users.length <= 1 && state.orders.length === 0) {
      await writeSupabaseState(local);
      return local;
    }
    return state;
  }
  await writeSupabaseState(local);
  return local;
}

async function writeSupabaseState(state) {
  await supabaseRequest("hasinah_state", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      id: SUPABASE_STATE_ID,
      data: state,
      updated_at: new Date().toISOString()
    })
  });
  await writeLocalState(state);
}

async function readState() {
  if (!USE_SUPABASE) return readLocalState();
  try {
    return await readSupabaseState();
  } catch (error) {
    console.error(error.message);
    return readLocalState();
  }
}

async function writeState(state) {
  if (!USE_SUPABASE) {
    await writeLocalState(state);
    return;
  }
  try {
    await writeSupabaseState(state);
  } catch (error) {
    console.error(error.message);
    await writeLocalState(state);
    throw error;
  }
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  if (Buffer.isBuffer(body) || typeof body === "string") {
    res.end(body);
    return;
  }
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function publicUser(user) {
  return { id: user.id, role: user.role, name: user.name, username: user.username, phone: user.phone };
}

function publicState(state) {
  state.payments = Array.isArray(state.payments) ? state.payments : [];
  state.routePlans = Array.isArray(state.routePlans) ? state.routePlans : [];
  markLateOrders(state);
  return { users: state.users.map((user) => ({ ...user })), orders: state.orders, payments: state.payments, routePlans: state.routePlans };
}

function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d]/g, "");
}

function whatsappLink(phone) {
  const normalized = normalizePhone(phone);
  const international = normalized.startsWith("966") ? normalized : `966${normalized.replace(/^0/, "")}`;
  return `https://wa.me/${international}`;
}

function svgText(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function svgAttr(value) {
  return svgText(value).replace(/"/g, "&quot;");
}

function formatDate(value) {
  return new Date(value).toLocaleDateString("ar-SA", { year: "numeric", month: "short", day: "numeric" });
}

function code39Svg(value) {
  const patterns = {
    "0": "nnnwwnwnn",
    "1": "wnnwnnnnw",
    "2": "nnwwnnnnw",
    "3": "wnwwnnnnn",
    "4": "nnnwwnnnw",
    "5": "wnnwwnnnn",
    "6": "nnwwwnnnn",
    "7": "nnnwnnwnw",
    "8": "wnnwnnwnn",
    "9": "nnwwnnwnn",
    "*": "nwnnwnwnn"
  };
  let x = 0;
  return `*${value}*`.split("").map((char) => {
    const pattern = patterns[char] || patterns["0"];
    const bars = pattern.split("").map((width, index) => {
      const isBar = index % 2 === 0;
      const w = width === "w" ? 11 : 5;
      const rect = isBar ? `<rect x="${x}" y="0" width="${w}" height="130" fill="#111"/>` : "";
      x += w;
      return rect;
    }).join("");
    x += 7;
    return bars;
  }).join("");
}

async function qrDataUri(data) {
  const response = await fetch(`https://api.qrserver.com/v1/create-qr-code/?size=260x260&format=png&data=${encodeURIComponent(data)}`);
  if (!response.ok) throw new Error("Could not generate QR code.");
  const bytes = Buffer.from(await response.arrayBuffer());
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

async function shippingPolicySvg(order) {
  const policyNumber = order.shippingPolicy.number;
  const qrUrl = await qrDataUri(whatsappLink(order.phone));
  const products = (order.products || []).map((product) => `${product.name}${product.quantity > 1 ? ` x${product.quantity}` : ""}`).join("، ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1500" viewBox="0 0 1000 1500">
    <rect width="1000" height="1500" fill="#fff"/>
    <rect x="18" y="18" width="964" height="1464" fill="none" stroke="#111" stroke-width="8"/>
    <rect x="18" y="120" width="964" height="90" fill="#1b1717"/>
    <line x1="130" y1="18" x2="130" y2="120" stroke="#111" stroke-width="6"/>
    <text x="74" y="93" text-anchor="middle" font-family="Arial" font-size="86" font-weight="900">H</text>
    <text x="565" y="88" text-anchor="middle" font-family="Arial" font-size="56" font-weight="900">HASINAH DELIVERY</text>
    <line x1="18" y1="120" x2="982" y2="120" stroke="#111" stroke-width="6"/>
    <line x1="18" y1="210" x2="982" y2="210" stroke="#111" stroke-width="6"/>
    <line x1="640" y1="210" x2="640" y2="1130" stroke="#111" stroke-width="6"/>
    <line x1="18" y1="500" x2="640" y2="500" stroke="#111" stroke-width="4"/>
    <line x1="18" y1="1130" x2="982" y2="1130" stroke="#111" stroke-width="6"/>
    <text x="600" y="270" direction="rtl" text-anchor="start" font-family="Arial" font-size="28" font-weight="900">من:</text>
    <text x="600" y="325" direction="rtl" text-anchor="start" font-family="Arial" font-size="24">المتجر: حسينة - جدة</text>
    <text x="600" y="370" direction="rtl" text-anchor="start" font-family="Arial" font-size="24">التاريخ: ${svgText(formatDate(new Date()))}</text>
    <text x="600" y="415" direction="rtl" text-anchor="start" font-family="Arial" font-size="24">رقم الطلب: ${svgText(order.number)}</text>
    <text x="600" y="560" direction="rtl" text-anchor="start" font-family="Arial" font-size="28" font-weight="900">إلى:</text>
    <text x="600" y="615" direction="rtl" text-anchor="start" font-family="Arial" font-size="24">الاسم: ${svgText(order.customer)}</text>
    <text x="600" y="660" direction="rtl" text-anchor="start" font-family="Arial" font-size="24">الجوال: ${svgText(order.phone)}</text>
    <text x="600" y="705" direction="rtl" text-anchor="start" font-family="Arial" font-size="24">الحي: ${svgText(order.area)}</text>
    <text x="600" y="750" direction="rtl" text-anchor="start" font-family="Arial" font-size="22">العنوان: ${svgText(order.locationText || order.area || "")}</text>
    <text x="600" y="795" direction="rtl" text-anchor="start" font-family="Arial" font-size="20">المنتجات: ${svgText(products || "-")}</text>
    <image href="${svgAttr(qrUrl)}" x="690" y="260" width="250" height="250"/>
    <text x="815" y="560" text-anchor="middle" font-family="Arial" font-size="34" font-weight="900" letter-spacing="4">${svgText(policyNumber)}</text>
    <g transform="translate(120 1190)">${code39Svg(policyNumber)}</g>
    <text x="500" y="1395" text-anchor="middle" font-family="Arial" font-size="34" font-weight="900" letter-spacing="8">PLEASE HANDLE WITH CARE</text>
  </svg>`;
}

async function shippingPolicyPng(order) {
  const svg = await shippingPolicySvg(order);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function usedPolicyNumbers(state) {
  const numbers = new Set();
  state.orders.forEach((order) => {
    if (order.shippingPolicy?.number) numbers.add(String(order.shippingPolicy.number));
    (order.cancelledPolicies || []).forEach((policy) => {
      if (policy?.number) numbers.add(String(policy.number));
    });
  });
  return numbers;
}

function generatePolicyNumber(state) {
  const used = usedPolicyNumbers(state);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const number = String(Math.floor(1000000000 + Math.random() * 9000000000));
    if (!used.has(number)) return number;
  }
  throw new Error("Could not generate a unique shipping policy number.");
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u064B-\u065F\u0670\u0300-\u036f]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه");
}

function normalizeStatusValue(value) {
  return normalizeText(value).replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function zidString(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") return value.name || value.label || value.ar || value.en || value.value || "";
  return "";
}

function compactReasonSample(list, limit = 8) {
  return list.slice(0, limit);
}

function zidTokenFromState(state) {
  return state?.integrations?.zid || {};
}

function formatZidAuthorization(value) {
  const token = String(value || "").trim();
  if (!token) return "";
  return /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}

function zidHeaders(state, extra = {}) {
  const zidAuth = zidTokenFromState(state);
  const token = zidAuth.access_token || zidAuth.accessToken || "";
  const authToken = zidAuth.Authorization || zidAuth.authorization || zidAuth.auth_token || zidAuth.authToken || "";
  const authorization = formatZidAuthorization(process.env.ZID_AUTHORIZATION || process.env.ZID_AUTH || authToken || token);
  const managerToken = process.env.ZID_MANAGER_TOKEN || process.env.ZID_ACCESS_TOKEN || zidAuth.manager_token || zidAuth.managerToken || token || "";
  if (!authorization || !managerToken) throw new Error("Zid credentials are missing.");
  return {
    Authorization: authorization,
    "X-Manager-Token": managerToken,
    "Accept-Language": "ar",
    ...extra
  };
}

function getZidOrder(input) {
  return input?.order || input?.data?.order || input?.data || input;
}

function zidStatusCode(order) {
  return normalizeText(
    order?.order_status?.code ||
    order?.order_status?.slug ||
    order?.display_status?.code ||
    order?.display_status?.slug ||
    order?.status?.code ||
    order?.status?.slug ||
    order?.status
  );
}

function zidStatusName(order) {
  return String(
    order?.order_status?.name ||
    order?.order_status?.label ||
    order?.display_status?.name ||
    order?.display_status?.label ||
    order?.status?.name ||
    order?.status?.label ||
    zidStatusCode(order) ||
    ""
  );
}

function zidCity(order) {
  const address = zidAddress(order);
  return normalizeText(
    zidString(address?.city) ||
    zidString(address?.meta?.city_name) ||
    zidString(address?.city_name) ||
    zidString(order?.city) ||
    zidString(order?.customer?.city) ||
    ""
  );
}

function zidShippingMethodText(order) {
  return [
    order?.shipping?.method?.name,
    order?.shipping?.method?.code,
    order?.shipping?.method?.label,
    order?.shipping?.company?.name,
    order?.shipping?.company?.code,
    order?.shipping?.option?.name,
    order?.shipping?.option?.code,
    order?.shipping_method?.name,
    order?.shipping_method?.code,
    order?.shipping_method,
    order?.delivery_option?.name,
    order?.delivery_option?.code,
    order?.delivery_method?.name,
    order?.delivery_method?.code
  ].map(zidString).filter(Boolean).join(" ");
}

function isJeddahShippingMethod(order) {
  const shipping = normalizeText(zidShippingMethodText(order));
  const matches = ZID_SHIPPING_METHOD_MATCH.map(normalizeText);
  return Boolean(shipping) && matches.some((match) => shipping.includes(match) || match.includes(shipping));
}

function zidExclusionText(order) {
  return [
    zidStatusCode(order),
    zidStatusName(order),
    order?.type,
    order?.order_type,
    order?.flow_type,
    order?.return_status,
    order?.refund_status,
    order?.exchange_status,
    order?.order_status?.type,
    order?.order_status?.group,
    order?.display_status?.type,
    order?.display_status?.group
  ].map(zidString).filter(Boolean).join(" ");
}

function isExcludedZidOrder(order) {
  const text = normalizeStatusValue(zidExclusionText(order));
  const excluded = ZID_EXCLUDED_STATUSES.map(normalizeStatusValue).filter(Boolean);
  return Boolean(text) && excluded.some((value) => text === value || text.includes(value) || value.includes(text));
}

function isJeddahOrder(order) {
  const city = zidCity(order);
  const addressObject = zidAddress(order);
  const address = normalizeText([
    addressObject?.formatted_address,
    addressObject?.district,
    addressObject?.short_address,
    addressObject?.street,
    addressObject?.meta?.city_name,
    addressObject?.meta?.district,
    order?.shipping?.method?.name,
    order?.shipping_address,
    order?.delivery_address
  ].filter(Boolean).join(" "));
  const matches = ZID_CITY_MATCH.map(normalizeText);
  return isJeddahShippingMethod(order) || matches.some((match) => city.includes(match) || address.includes(match));
}

function isReadyForDispatch(order) {
  const values = [zidStatusCode(order), zidStatusName(order)]
    .map(normalizeStatusValue)
    .filter(Boolean);
  const allowed = [...ZID_READY_STATUSES, ...ZID_READY_STATUS_ALIASES].map(normalizeStatusValue).filter(Boolean);
  return !allowed.length || allowed.some((status) => values.some((value) => value === status || value.includes(status) || status.includes(value)));
}

function zidAddress(order) {
  return order?.shipping?.address ||
    order?.address ||
    order?.shipping_address ||
    order?.delivery_address ||
    order?.customer?.address ||
    order?.customer?.addresses?.[0] ||
    {};
}

function productImage(product) {
  return product?.images?.[0]?.image?.full_size || product?.images?.[0]?.image?.thumbnail || product?.image || product?.thumbnail || product?.main_image || "";
}

function normalizeZidProducts(order) {
  const products = order?.products || order?.items || order?.order_products || [];
  return Array.isArray(products)
    ? products.map((product) => ({
        name: String(product?.name || product?.product?.name || product?.title || "منتج").trim(),
        image: productImage(product),
        quantity: Number(product?.quantity || product?.qty || 1)
      }))
    : [];
}

function zidMapLink(order) {
  const address = zidAddress(order);
  const lat = Number(address?.lat || address?.latitude || 0);
  const lng = Number(address?.lng || address?.longitude || 0);
  const text = [
    address?.short_address,
    address?.formatted_address,
    address?.district,
    address?.street,
    address?.meta?.building_number,
    address?.meta?.postcode,
    address?.meta?.additional_number,
    address?.city?.name || address?.meta?.city_name
  ].filter(Boolean).join(" ");
  if (lat && lng) return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  if (text) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;
  return "";
}

function zidCustomerName(order) {
  const name = order?.customer?.name || order?.consignee?.name || order?.recipient?.name || "";
  const first = order?.customer?.first_name || order?.customer?.firstname || "";
  const last = order?.customer?.last_name || order?.customer?.lastname || "";
  return String(name || `${first} ${last}`.trim() || "عميل زد").trim();
}

function zidOrderNumber(order) {
  return String(order?.invoice_number || order?.order_number || order?.number || order?.code || order?.id || "").trim();
}

function zidOrderCreatedAt(order) {
  const value = order?.created_at || order?.createdAt || order?.date || order?.order_date || order?.created_date;
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : "";
}

function zidSyncMinCreatedAt() {
  const days = Math.max(1, Number.isFinite(ZID_SYNC_INCLUDE_DAYS) ? ZID_SYNC_INCLUDE_DAYS : 2);
  const now = new Date();
  const riyadhNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  riyadhNow.setUTCHours(0, 0, 0, 0);
  riyadhNow.setUTCDate(riyadhNow.getUTCDate() - (days - 1));
  return new Date(riyadhNow.getTime() - 3 * 60 * 60 * 1000);
}

function isWithinZidSyncWindow(order) {
  const createdAt = zidOrderCreatedAt(order);
  if (!createdAt) return true;
  return new Date(createdAt).getTime() >= zidSyncMinCreatedAt().getTime();
}

function zidDashboardUrl(order, number) {
  return order?.order_url || order?.url || `${ZID_DASHBOARD_ORDER_BASE}${encodeURIComponent(number)}`;
}

function upsertZidOrder(state, rawOrder, source = "zid") {
  const order = getZidOrder(rawOrder);
  if (!order || !zidOrderNumber(order)) return { saved: false, reason: "missing_number" };
  if (isExcludedZidOrder(order)) return { saved: false, reason: "excluded_status" };
  if (!isWithinZidSyncWindow(order)) return { saved: false, reason: "too_old" };
  if (!isJeddahOrder(order)) return { saved: false, reason: "not_jeddah" };

  const number = zidOrderNumber(order);
  const existing = state.orders.find((item) => !isManualServiceOrder(item) && item.zid?.id && String(item.zid.id) === String(order.id))
    || state.orders.find((item) => !isManualServiceOrder(item) && item.number === number);
  const wasExisting = Boolean(existing);
  const address = zidAddress(order);
  const now = new Date().toISOString();
  const orderCreatedAt = zidOrderCreatedAt(order) || existing?.orderCreatedAt || existing?.requestDate || now;
  const area = String(
    address?.district ||
    address?.meta?.district ||
    address?.short_address ||
    address?.formatted_address ||
    address?.street ||
    "جدة"
  ).trim();
  const next = {
    id: existing?.id || uid("ord"),
    kind: "customer",
    number,
    type: "Delivery",
    flowType: "order",
    customer: zidCustomerName(order),
    phone: normalizePhone(order?.customer?.mobile || order?.customer?.phone || order?.consignee?.mobile || order?.recipient?.mobile || ""),
    area,
    driverId: existing?.driverId || "",
    customAmount: 0,
    timerHours: 24,
    requestDate: orderCreatedAt,
    orderCreatedAt,
    status: existing?.status && existing.status !== "new" ? existing.status : "new",
    zidStatusCode: zidStatusCode(order),
    zidStatusName: zidStatusName(order),
    locationText: String(address?.formatted_address || address?.short_address || "").trim(),
    mapUrl: zidMapLink(order),
    products: normalizeZidProducts(order),
    shippingPolicy: existing?.shippingPolicy || null,
    cancelledPolicies: existing?.cancelledPolicies || [],
    zid: {
      id: order.id,
      code: order.code || "",
      url: zidDashboardUrl(order, number),
      importedAt: existing?.zid?.importedAt || now,
      lastSyncedAt: now,
      source
    },
    acceptedAt: existing?.acceptedAt || "",
    pickedUpAt: existing?.pickedUpAt || "",
    deadlineAt: existing?.deadlineAt || "",
    completedAt: existing?.completedAt || "",
    delayRequests: existing?.delayRequests || [],
    appeals: existing?.appeals || [],
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    history: [...(existing?.history || []), { at: now, action: existing ? "zid_synced" : "zid_imported" }]
  };

  if (existing) Object.assign(existing, next);
  else state.orders.unshift(next);
  return { saved: true, created: !wasExisting, updated: wasExisting, reason: wasExisting ? "existing" : "created", order: next, number };
}

function cleanupExcludedZidOrders(state) {
  const before = state.orders.length;
  state.orders = state.orders.filter((order) => {
    if (isManualServiceOrder(order)) return true;
    if (!order?.zid?.id || !isExcludedImportedOrder(order)) return true;
    return ["picked_up", "delivered", "completed"].includes(order.status) || Boolean(order.shippingPolicy);
  });
  return before - state.orders.length;
}

function cleanupOldZidOrders(state) {
  const min = zidSyncMinCreatedAt().getTime();
  const before = state.orders.length;
  state.orders = state.orders.filter((order) => {
    if (isManualServiceOrder(order)) return true;
    if (!order?.zid?.id) return true;
    const createdAt = order.orderCreatedAt || order.requestDate || order.createdAt || "";
    if (!createdAt || new Date(createdAt).getTime() >= min) return true;
    return ["picked_up", "delivered", "completed"].includes(order.status) || Boolean(order.shippingPolicy);
  });
  return before - state.orders.length;
}

function isExcludedImportedOrder(order) {
  const text = normalizeStatusValue([
    order.zidStatusCode,
    order.zidStatusName
  ].filter(Boolean).join(" "));
  const excluded = ZID_EXCLUDED_STATUSES.map(normalizeStatusValue).filter(Boolean);
  return Boolean(text) && excluded.some((value) => text === value || text.includes(value) || value.includes(text));
}

function isManualServiceOrder(order) {
  return Boolean(
    order?.manualServiceOrder ||
    order?.sourceOrderId ||
    ["return", "replacement"].includes(order?.flowType) ||
    ["Return", "Replacement"].includes(order?.type)
  );
}

async function syncZidOrders(state) {
  const pageLimit = Number(process.env.ZID_SYNC_PAGES || 10);
  let imported = 0;
  let existing = 0;
  let updated = 0;
  let skipped = 0;
  let notReady = 0;
  let notJeddah = 0;
  let missingNumber = 0;
  let excluded = 0;
  let tooOld = 0;
  let checked = 0;
  const samples = {
    imported: [],
    existing: [],
    notReady: [],
    notJeddah: [],
    missingNumber: [],
    excluded: [],
    tooOld: []
  };
  const removedExcluded = cleanupExcludedZidOrders(state);
  const removedOld = cleanupOldZidOrders(state);
  const minCreatedAt = zidSyncMinCreatedAt().getTime();

  for (let page = 1; page <= pageLimit; page += 1) {
    const params = new URLSearchParams({
      payload_type: "full",
      page: String(page),
      per_page: "50"
    });
    const response = await fetch(`${ZID_API_BASE}/store/orders?${params.toString()}`, {
      headers: zidHeaders(state, { Accept: "application/json" })
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    if (!response.ok) {
      const message = payload?.message || payload?.error || payload?.raw || response.statusText;
      throw new Error(`Zid sync failed with ${response.status}: ${String(message).slice(0, 240)}`);
    }
    const orders = Array.isArray(payload.orders)
      ? payload.orders
      : Array.isArray(payload.data?.orders)
        ? payload.data.orders
        : Array.isArray(payload.data)
          ? payload.data
          : Array.isArray(payload.results)
            ? payload.results
            : [];
    const pageHasFreshOrders = orders.some((item) => {
      const createdAt = zidOrderCreatedAt(getZidOrder(item));
      return !createdAt || new Date(createdAt).getTime() >= minCreatedAt;
    });
    orders.forEach((order) => {
      checked += 1;
      const zidOrder = getZidOrder(order);
      const number = zidOrderNumber(zidOrder) || "بدون رقم";
      if (isExcludedZidOrder(zidOrder)) {
        excluded += 1;
        skipped += 1;
        samples.excluded.push({ number, status: zidStatusName(zidOrder) || zidStatusCode(zidOrder) });
        return;
      }
      if (!isWithinZidSyncWindow(zidOrder)) {
        tooOld += 1;
        skipped += 1;
        samples.tooOld.push({ number, createdAt: zidOrderCreatedAt(zidOrder) || "" });
        return;
      }
      const ready = isReadyForDispatch(zidOrder);
      const jeddahShipping = isJeddahShippingMethod(zidOrder);
      if (!ready) {
        notReady += 1;
        skipped += 1;
        samples.notReady.push({ number, status: zidStatusName(zidOrder) || zidStatusCode(zidOrder), shipping: zidShippingMethodText(zidOrder) });
        return;
      }
      const result = upsertZidOrder(state, zidOrder, "zid_sync");
      if (result.created) {
        imported += 1;
        samples.imported.push(result.number || number);
      } else if (result.updated) {
        existing += 1;
        updated += 1;
        samples.existing.push(result.number || number);
      } else {
        skipped += 1;
        if (result.reason === "not_jeddah") {
          notJeddah += 1;
          samples.notJeddah.push({ number, city: zidCity(zidOrder) || "", shipping: zidShippingMethodText(zidOrder) });
        } else if (result.reason === "missing_number") {
          missingNumber += 1;
          samples.missingNumber.push(number);
        } else if (result.reason === "excluded_status") {
          excluded += 1;
          samples.excluded.push({ number, status: zidStatusName(zidOrder) || zidStatusCode(zidOrder) });
        } else if (result.reason === "too_old") {
          tooOld += 1;
          samples.tooOld.push({ number, createdAt: zidOrderCreatedAt(zidOrder) || "" });
        }
      }
    });
    if (!pageHasFreshOrders) break;
    if (orders.length < 50) break;
  }

  return {
    imported,
    existing,
    updated,
    skipped,
    notReady,
    notJeddah,
    missingNumber,
    excluded,
    tooOld,
    removedExcluded,
    removedOld,
    minCreatedAt: zidSyncMinCreatedAt().toISOString(),
    checked,
    samples: {
      imported: compactReasonSample(samples.imported),
      existing: compactReasonSample(samples.existing),
      notReady: compactReasonSample(samples.notReady),
      notJeddah: compactReasonSample(samples.notJeddah),
      missingNumber: compactReasonSample(samples.missingNumber),
      excluded: compactReasonSample(samples.excluded),
      tooOld: compactReasonSample(samples.tooOld)
    }
  };
}

async function updateZidOrderStatus(order, statusCode = ZID_IN_DELIVERY_STATUS, state = null) {
  if (!order?.zid?.id) return { skipped: true };
  const body = {
    order_status: statusCode,
    tracking_number: order.shippingPolicy?.number || order.number || "",
    tracking_url: "",
    waybill_url: ""
  };
  if (process.env.ZID_INVENTORY_ADDRESS_ID) body.inventory_address_id = process.env.ZID_INVENTORY_ADDRESS_ID;
  const response = await fetch(`${ZID_API_BASE}/store/orders/${encodeURIComponent(order.zid.id)}/change-order-status`, {
    method: "POST",
    headers: zidHeaders(state, { Accept: "application/json", "Content-Type": "application/json" }),
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.message || payload?.error || payload?.errors?.[0]?.message || response.statusText;
    throw new Error(`Zid status update failed with ${response.status}: ${message}`);
  }
  return payload || { ok: true };
}

async function zidDebugStatus(state) {
  const zidAuth = zidTokenFromState(state);
  const keys = Object.keys(zidAuth).filter((key) => !/token|secret|authorization/i.test(key)).sort();
  const sensitiveKeys = Object.keys(zidAuth).filter((key) => /token|secret|authorization/i.test(key)).sort();
  const debug = {
    configured: {
      hasClientId: Boolean(ZID_CLIENT_ID),
      hasClientSecret: Boolean(ZID_CLIENT_SECRET),
      hasRedirectUri: Boolean(ZID_REDIRECT_URI),
      hasEnvAuthorization: Boolean(process.env.ZID_AUTHORIZATION || process.env.ZID_AUTH),
      hasEnvManagerToken: Boolean(process.env.ZID_MANAGER_TOKEN || process.env.ZID_ACCESS_TOKEN)
    },
    saved: {
      hasSavedZidAuth: Boolean(Object.keys(zidAuth).length),
      visibleKeys: keys,
      sensitiveKeys,
      hasAuthorization: Boolean(zidAuth.Authorization || zidAuth.authorization || zidAuth.auth_token || zidAuth.authToken),
      hasAccessToken: Boolean(zidAuth.access_token || zidAuth.accessToken),
      authorizedAt: zidAuth.authorizedAt || ""
    },
    lastCallback: state.integrations?.zidLastCallback || null,
    lastError: state.integrations?.zidLastError || null
  };
  try {
    const response = await fetch(`${ZID_API_BASE}/store/orders?payload_type=full&page=1&per_page=1`, {
      headers: zidHeaders(state, { Accept: "application/json" })
    });
    const body = await response.text();
    let parsed = {};
    try {
      parsed = body ? JSON.parse(body) : {};
    } catch {
      parsed = { raw: body };
    }
    const first = Array.isArray(parsed.orders) ? parsed.orders[0] : Array.isArray(parsed.data) ? parsed.data[0] : Array.isArray(parsed.data?.orders) ? parsed.data.orders[0] : null;
    debug.ordersTest = {
      ok: response.ok,
      status: response.status,
      firstOrder: first ? {
        number: zidOrderNumber(first),
        statusCode: zidStatusCode(first),
        statusName: zidStatusName(first),
        city: zidCity(first),
        shippingMethod: zidShippingMethodText(first),
        isJeddah: isJeddahOrder(first),
        isJeddahShippingMethod: isJeddahShippingMethod(first),
        isExcluded: isExcludedZidOrder(first),
        isReadyForDispatch: isReadyForDispatch(first),
        isWithinSyncWindow: isWithinZidSyncWindow(first),
        syncMinCreatedAt: zidSyncMinCreatedAt().toISOString()
      } : null,
      body: body.slice(0, 500)
    };
  } catch (error) {
    debug.ordersTest = { ok: false, message: error.message };
  }
  return debug;
}

function checkWebhookAuth(req) {
  const expectedUser = process.env.ZID_WEBHOOK_USERNAME || "";
  const expectedPassword = process.env.ZID_WEBHOOK_PASSWORD || "";
  if (!expectedUser && !expectedPassword) return true;
  const header = String(req.headers.authorization || "");
  const expected = `Basic ${Buffer.from(`${expectedUser}:${expectedPassword}`).toString("base64")}`;
  return header === expected;
}

function absoluteCallbackUrl(req) {
  if (ZID_REDIRECT_URI) return ZID_REDIRECT_URI;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const protocol = req.headers["x-forwarded-proto"] || "https";
  return `${protocol}://${host}/api/zid/oauth/callback`;
}

function zidInstallUrl(req) {
  if (!ZID_CLIENT_ID) throw new Error("Zid Client ID is missing in Render environment variables.");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: ZID_CLIENT_ID,
    redirect_uri: absoluteCallbackUrl(req)
  });
  return `${ZID_OAUTH_BASE}/oauth/authorize?${params.toString()}`;
}

async function exchangeZidCode(req, code) {
  if (!ZID_CLIENT_ID || !ZID_CLIENT_SECRET) {
    throw new Error("Zid Client ID and Client Secret are missing in Render environment variables.");
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: ZID_CLIENT_ID,
    client_secret: ZID_CLIENT_SECRET,
    redirect_uri: absoluteCallbackUrl(req)
  });
  const response = await fetch(`${ZID_OAUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const detail = payload.message || payload.error_description || payload.error || payload.raw || text || response.statusText;
    throw new Error(`Zid authorization failed (${response.status}): ${formatErrorDetail(detail)}`);
  }
  return payload;
}

function formatErrorDetail(detail) {
  if (detail == null) return "";
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

function htmlPage(title, message) {
  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${svgText(title)}</title>
    <style>
      body{margin:0;font-family:Arial,Tahoma,sans-serif;background:#101416;color:#f8fafc;display:grid;min-height:100vh;place-items:center}
      main{width:min(520px,calc(100% - 32px));background:#181f22;border:1px solid #314044;border-radius:16px;padding:28px;box-shadow:0 20px 60px #0008}
      h1{margin:0 0 12px;font-size:28px}
      p{margin:0 0 18px;color:#cbd5d8;line-height:1.8}
      a{display:inline-block;background:#b54132;color:white;text-decoration:none;border-radius:10px;padding:12px 18px;font-weight:700}
    </style>
  </head>
  <body>
    <main>
      <h1>${svgText(title)}</h1>
      <p>${svgText(message)}</p>
      <a href="/">فتح تطبيق حسينة</a>
    </main>
  </body>
</html>`;
}

function createAccount(state, body) {
  const role = String(body.role || "driver");
  const username = String(body.username || "").trim().toLowerCase();
  if (!["admin", "driver"].includes(role)) throw new Error("Choose admin or driver.");
  if (!body.name || !username || !body.password) throw new Error("Name, username, and password are required.");
  if (state.users.some((user) => user.username.toLowerCase() === username)) throw new Error("That username already exists.");
  state.users.push({
    id: uid(role === "admin" ? "adm" : "drv"),
    role,
    name: String(body.name).trim(),
    phone: String(body.phone || "").trim(),
    username,
    password: String(body.password).trim()
  });
}

function generateCustomTripNumber(state) {
  let number = "";
  do {
    number = `TRIP-${Math.floor(100000 + Math.random() * 900000)}`;
  } while (state.orders.some((order) => String(order.number) === number));
  return number;
}

function createOrder(state, body) {
  const kind = body.kind === "custom" ? "custom" : "customer";
  const now = new Date();
  const customAmount = Number(body.customAmount || 0);
  const timerHours = Number(body.timerHours || 24);
  const senderName = String(body.senderName || body.customer || "").trim();
  const recipientName = String(body.recipientName || "").trim();
  if (kind === "custom") {
    if (!senderName || !recipientName || !body.area) throw new Error("المشوار الخاص يحتاج اسم المرسل واسم المستلم والحي.");
    if (!customAmount || customAmount <= 0) throw new Error("المشوار الخاص يحتاج مبلغ محدد.");
    if (!body.customConfirmed) throw new Error("أكد تفاصيل المشوار الخاص قبل حفظه.");
  } else if (!body.number || !body.customer || !body.phone || !body.area) {
    throw new Error("رقم الطلب والاسم ورقم الواتساب والحي مطلوبة.");
  }

  state.orders.unshift({
    id: uid("ord"),
    kind,
    number: kind === "custom" ? String(body.number || generateCustomTripNumber(state)).trim() : String(body.number).trim(),
    type: kind === "custom" ? "Custom delivery" : String(body.type || "Delivery"),
    flowType: kind === "custom" ? "custom" : "order",
    customer: kind === "custom" ? recipientName : String(body.customer).trim(),
    senderName: kind === "custom" ? senderName : "",
    recipientName: kind === "custom" ? recipientName : "",
    customNote: kind === "custom" ? String(body.customNote || "").trim() : "",
    customConfirmed: kind === "custom",
    confirmedAt: kind === "custom" ? now.toISOString() : "",
    phone: normalizePhone(body.phone),
    area: String(body.area).trim(),
    locationText: String(body.locationText || "").trim(),
    mapUrl: String(body.mapUrl || "").trim(),
    products: Array.isArray(body.products) ? body.products : [],
    shippingPolicy: body.shippingPolicy || null,
    cancelledPolicies: Array.isArray(body.cancelledPolicies) ? body.cancelledPolicies : [],
    zidStatusCode: String(body.zidStatusCode || "").trim(),
    zidStatusName: String(body.zidStatusName || "").trim(),
    zid: body.zid && typeof body.zid === "object" ? body.zid : undefined,
    driverId: String(body.driverId || "").trim(),
    assignedAt: body.driverId ? now.toISOString() : "",
    customAmount: kind === "custom" ? customAmount : 0,
    timerHours: kind === "custom" ? Math.max(1, timerHours || 24) : 24,
    requestDate: body.requestDate ? new Date(body.requestDate).toISOString() : now.toISOString(),
    orderCreatedAt: now.toISOString(),
    status: kind === "custom" && body.driverId ? "pending_acceptance" : body.driverId ? "ready" : "new",
    acceptedAt: "",
    pickedUpAt: "",
    deadlineAt: "",
    delayRequests: [],
    appeals: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    history: [{ at: now.toISOString(), action: "created" }]
  });
}

function createPayment(state, body) {
  state.payments = Array.isArray(state.payments) ? state.payments : [];
  const driverId = String(body.driverId || "").trim();
  const amount = Number(body.amount || 0);
  const paidAt = body.paidAt ? new Date(body.paidAt) : new Date();
  const driver = state.users.find((user) => user.id === driverId && user.role === "driver");
  if (!driver) throw new Error("اختر السائق قبل تسجيل الدفعة.");
  if (!amount || amount <= 0) throw new Error("اكتب مبلغ دفع صحيح.");
  if (Number.isNaN(paidAt.getTime())) throw new Error("تاريخ الدفع غير صحيح.");
  if (!body.proof) throw new Error("إثبات الدفع مطلوب.");
  state.payments.unshift({
    id: uid("pay"),
    driverId,
    amount,
    paidAt: paidAt.toISOString(),
    proof: String(body.proof || ""),
    proofName: String(body.proofName || "payment-proof"),
    note: String(body.note || "").trim(),
    createdAt: new Date().toISOString()
  });
}

function saveRoutePlanState(state, driverId, body) {
  state.routePlans = Array.isArray(state.routePlans) ? state.routePlans : [];
  const cleanDriverId = String(driverId || "").trim();
  const neighborhoodKeys = Array.isArray(body.neighborhoodKeys) ? body.neighborhoodKeys.map((key) => String(key)).filter(Boolean) : [];
  if (!state.users.some((user) => user.id === cleanDriverId && user.role === "driver")) {
    throw new Error("لم يتم العثور على السائق لحفظ المسار.");
  }
  const now = new Date().toISOString();
  const existing = state.routePlans.find((plan) => plan.driverId === cleanDriverId);
  if (existing) {
    existing.neighborhoodKeys = neighborhoodKeys;
    existing.updatedAt = now;
  } else {
    state.routePlans.push({ driverId: cleanDriverId, neighborhoodKeys, updatedAt: now });
  }
}

function updateOrderState(state, id, patch) {
  const order = state.orders.find((item) => item.id === id);
  if (!order) throw new Error("لم يتم العثور على الطلب.");
  const now = new Date();
  const previousDriverId = order.driverId || "";

  if (Object.prototype.hasOwnProperty.call(patch, "driverId")) {
    order.driverId = String(patch.driverId || "");
    if (!previousDriverId && order.driverId) order.assignedAt = now.toISOString();
    if (!order.driverId) order.assignedAt = "";
    if (order.kind === "custom" && order.driverId && order.status !== "completed") order.status = "pending_acceptance";
    if (order.kind === "customer" && order.driverId && ["new", "pending_acceptance", "accepted"].includes(order.status)) order.status = "ready";
    if (!order.driverId && !["completed", "delivered"].includes(order.status)) {
      order.status = "new";
      order.acceptedAt = "";
      order.deadlineAt = "";
    }
    if (order.shippingPolicy && order.driverId) order.status = "ready";
  }

  if (patch.action === "accept") acceptOrder(order, now);
  if (patch.action === "ready") {
    order.status = "ready";
  }
  if (patch.action === "pickup") pickUpOrder(order, now);
  if (patch.action === "complete") {
    order.status = "delivered";
    order.completedAt = now.toISOString();
  }
  if (patch.action === "return_pickup" && order.flowType === "return") {
    order.status = "returning_with_driver";
    order.pickedUpAt = now.toISOString();
  }
  if (patch.action === "return_received_base" && order.flowType === "return") {
    order.status = "returned";
    order.completedAt = now.toISOString();
  }
  if (patch.action === "replacement_old_pickup" && order.flowType === "replacement") {
    order.status = "replacement_old_received";
    order.pickedUpAt = now.toISOString();
  }
  if (patch.action === "replacement_deliver" && order.flowType === "replacement") {
    if (order.status !== "replacement_old_received") throw new Error("يجب استلام الطلب القديم من العميل قبل تسليم البديل.");
    order.status = "replacement_delivered";
    order.completedAt = now.toISOString();
  }
  if (patch.action === "replacement_old_returned" && order.flowType === "replacement") {
    if (!["replacement_delivered", "replacement_old_received"].includes(order.status)) throw new Error("لا يمكن تأكيد رجوع القديم قبل استلامه من العميل.");
    order.status = "replacement_old_returned";
    order.oldReturnedAt = now.toISOString();
  }
  if (patch.action === "cancel_service" && isManualServiceOrder(order)) {
    if (!["pending_return", "pending_replacement", "ready"].includes(order.status)) throw new Error("لا يمكن إلغاء العملية بعد أن بدأ السائق بتنفيذها.");
    order.status = "cancelled";
    order.cancelledAt = now.toISOString();
  }
  if (patch.action === "cancel") order.status = "cancelled";
  if (patch.action === "delay_request") {
    order.delayRequests = Array.isArray(order.delayRequests) ? order.delayRequests : [];
    order.delayRequests.push({
      id: uid("delay"),
      reason: String(patch.reason || "Customer cannot receive now"),
      proof: String(patch.proof || ""),
      proofName: String(patch.proofName || ""),
      status: "pending",
      createdAt: now.toISOString()
    });
  }
  if (patch.action === "appeal") {
    order.appeals = Array.isArray(order.appeals) ? order.appeals : [];
    order.appeals.push({ id: uid("appeal"), reason: String(patch.reason || "Appeal requested"), status: "pending", createdAt: now.toISOString() });
  }
  if (patch.action === "create_return") duplicateServiceOrder(state, order, "return", now);
  if (patch.action === "create_replacement") duplicateServiceOrder(state, order, "replacement", now, patch.replacementOrderNumber);
  if (patch.action === "approve_request") approveRequest(order, patch.requestId, now);
  if (patch.action === "reject_request") rejectRequest(order, patch.requestId);

  if (order.kind === "custom" && ["accepted", "picked_up"].includes(order.status) && isLate(order, now)) order.status = "late";
  order.updatedAt = now.toISOString();
  order.history = Array.isArray(order.history) ? order.history : [];
  order.history.push({ at: now.toISOString(), action: patch.action || "updated" });
}

function createShippingPolicy(state, id) {
  const order = state.orders.find((item) => item.id === id);
  if (!order) throw new Error("Order not found.");
  if (["delivered", "completed"].includes(order.status)) throw new Error("Cannot generate a policy after delivery.");
  const now = new Date().toISOString();
  if (!order.shippingPolicy) {
    order.shippingPolicy = {
      number: generatePolicyNumber(state),
      createdAt: now,
      status: "active"
    };
  }
  if (!isManualServiceOrder(order)) order.status = "ready";
  order.updatedAt = now;
  order.history = Array.isArray(order.history) ? order.history : [];
  order.history.push({ at: now, action: "policy_generated", policyNumber: order.shippingPolicy.number });
  return order.shippingPolicy;
}

function deleteShippingPolicy(state, id) {
  const order = state.orders.find((item) => item.id === id);
  if (!order) throw new Error("Order not found.");
  if (["delivered", "completed"].includes(order.status)) throw new Error("Cannot delete a policy after delivery.");
  if (!order.shippingPolicy) return null;
  const now = new Date().toISOString();
  order.cancelledPolicies = Array.isArray(order.cancelledPolicies) ? order.cancelledPolicies : [];
  order.cancelledPolicies.push({ ...order.shippingPolicy, cancelledAt: now, status: "cancelled" });
  order.shippingPolicy = null;
  order.status = isManualServiceOrder(order) ? order.status : order.driverId ? "ready" : "new";
  order.updatedAt = now;
  order.history = Array.isArray(order.history) ? order.history : [];
  order.history.push({ at: now, action: "policy_deleted" });
  return true;
}

function assignNeighborhood(state, body) {
  const driverId = String(body.driverId || "").trim();
  const area = normalizeText(body.area);
  if (!driverId || !area) throw new Error("Driver and neighborhood are required.");
  if (!state.users.some((user) => user.id === driverId && user.role === "driver")) throw new Error("Driver not found.");
  const now = new Date();
  const assigned = [];
  state.orders.forEach((order) => {
    if (normalizeText(order.area) === area && !order.driverId && ["new", "pending_acceptance"].includes(order.status)) {
      order.driverId = driverId;
      order.assignedAt = now.toISOString();
      order.status = "ready";
      order.acceptedAt = "";
      order.deadlineAt = "";
      order.updatedAt = now.toISOString();
      order.history = Array.isArray(order.history) ? order.history : [];
      order.history.push({ at: now.toISOString(), action: "assigned_by_neighborhood" });
      assigned.push(order);
    }
  });
  return assigned;
}

function duplicateServiceOrder(state, source, flowType, now, replacementOrderNumber = "") {
  if (flowType === "replacement" && !String(replacementOrderNumber || "").trim()) {
    throw new Error("رقم طلب الاستبدال مطلوب.");
  }
  const replacementNumber = String(replacementOrderNumber || "").trim();
  const replacementSource = replacementNumber
    ? state.orders.find((item) => String(item.number || "") === replacementNumber && item.zid?.id)
    : null;
  state.orders.unshift({
    ...source,
    id: uid("ord"),
    flowType,
    kind: "customer",
    type: flowType === "return" ? "Return" : "Replacement",
    returnedOrderNumber: source.returnedOrderNumber || source.number,
    replacementOrderNumber: flowType === "replacement" ? replacementNumber : "",
    replacementZid: replacementSource?.zid ? { ...replacementSource.zid } : null,
    oldPolicyNumber: flowType === "replacement" ? source.shippingPolicy?.number || "" : "",
    sourceOrderId: source.id,
    manualServiceOrder: true,
    serviceCreatedAt: now.toISOString(),
    status: flowType === "return" ? "pending_return" : "pending_replacement",
    acceptedAt: "",
    pickedUpAt: "",
    deadlineAt: "",
    completedAt: "",
    shippingPolicy: flowType === "replacement" ? null : source.shippingPolicy,
    cutRemoved: false,
    delayRequests: [],
    appeals: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    history: [{ at: now.toISOString(), action: `created_${flowType}` }]
  });
}

function acceptOrder(order, now) {
  order.status = "accepted";
  order.acceptedAt = now.toISOString();
  if (order.kind === "custom") {
    const hours = Number(order.timerHours || 24);
    order.deadlineAt = new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
  } else {
    order.deadlineAt = "";
  }
}

function pickUpOrder(order, now) {
  order.status = "picked_up";
  order.pickedUpAt = now.toISOString();
  order.acceptedAt = order.acceptedAt || now.toISOString();
  if (order.kind !== "custom") order.deadlineAt = "";
  else order.deadlineAt = order.deadlineAt || new Date(now.getTime() + DAY_MS).toISOString();
  order.cutRemoved = false;
}

function reopenIfPolicyOnly(order) {
  if (order.shippingPolicy && order.status === "ready") return;
  if (["delivered", "completed", "cancelled"].includes(order.status)) return;
  if (order.driverId && ["new", "pending_acceptance"].includes(order.status)) {
    order.status = "ready";
    order.acceptedAt = "";
    order.deadlineAt = "";
  }
}

function approveRequest(order, requestId, now) {
  const request = findRequest(order, requestId);
  if (!request) return;
  request.status = "approved";
  request.reviewedAt = now.toISOString();
  order.status = order.pickedUpAt ? "picked_up" : "ready";
  if (order.kind === "custom") order.deadlineAt = new Date(now.getTime() + DAY_MS).toISOString();
  else order.deadlineAt = "";
  order.cutRemoved = true;
}

function rejectRequest(order, requestId) {
  const request = findRequest(order, requestId);
  if (request) request.status = "rejected";
}

function findRequest(order, requestId) {
  return [...(order.delayRequests || []), ...(order.appeals || [])].find((request) => request.id === requestId);
}

function isLate(order, now = new Date()) {
  return order.kind === "custom" && order.deadlineAt && now.getTime() > new Date(order.deadlineAt).getTime() && !order.cutRemoved;
}

function markLateOrders(state) {
  state.orders.forEach((order) => {
    if (order.kind !== "custom") {
      order.deadlineAt = "";
      if (order.status === "late") order.status = order.pickedUpAt ? "picked_up" : "accepted";
    }
    if (["accepted", "picked_up"].includes(order.status) && isLate(order)) order.status = "late";
  });
}

async function handleApi(req, res, url) {
  if (url.pathname.startsWith("/api/") && url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  const state = await readState();

  if (url.pathname === "/api/health") {
    const zidAuth = zidTokenFromState(state);
    send(res, 200, {
      ok: true,
      storage: USE_SUPABASE ? "supabase" : "json",
      zidAuthorized: Boolean(zidAuth.Authorization || zidAuth.authorization || zidAuth.access_token || process.env.ZID_AUTHORIZATION)
    });
    return true;
  }

  if (url.pathname === "/api/zid/debug" && req.method === "GET") {
    send(res, 200, await zidDebugStatus(state));
    return true;
  }

  if (url.pathname === "/api/state" && req.method === "GET") {
    send(res, 200, publicState(state));
    return true;
  }

  if (url.pathname === "/api/login" && req.method === "POST") {
    const body = await readBody(req);
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "").trim();
    const user = state.users.find((item) => item.username.toLowerCase() === username && item.password === password);
    if (!user) {
      send(res, 401, { ok: false, message: "Invalid username or password." });
      return true;
    }
    send(res, 200, { ok: true, user: publicUser(user) });
    return true;
  }

  if (url.pathname === "/api/reset" && req.method === "POST") {
    send(res, 403, { ok: false, message: "Reset is disabled in production to protect live accounts and orders." });
    return true;
  }

  if (url.pathname === "/api/accounts" && req.method === "POST") {
    createAccount(state, await readBody(req));
    await writeState(state);
    send(res, 201, publicState(state));
    return true;
  }

  if (url.pathname === "/api/orders" && req.method === "POST") {
    createOrder(state, await readBody(req));
    await writeState(state);
    send(res, 201, publicState(state));
    return true;
  }

  if (url.pathname === "/api/payments" && req.method === "POST") {
    createPayment(state, await readBody(req));
    await writeState(state);
    send(res, 201, publicState(state));
    return true;
  }

  const routePlanMatch = url.pathname.match(/^\/api\/route-plans\/([^/]+)$/);
  if (routePlanMatch && req.method === "PUT") {
    saveRoutePlanState(state, decodeURIComponent(routePlanMatch[1]), await readBody(req));
    await writeState(state);
    send(res, 200, publicState(state));
    return true;
  }

  if (url.pathname === "/api/orders/assign-neighborhood" && req.method === "POST") {
    const assigned = assignNeighborhood(state, await readBody(req));
    await writeState(state);
    send(res, 200, { ...publicState(state), assigned: assigned.length });
    return true;
  }

  if (url.pathname === "/api/zid/sync" && req.method === "POST") {
    const result = await syncZidOrders(state);
    await writeState(state);
    send(res, 200, { ...publicState(state), zidSync: result });
    return true;
  }

  if (url.pathname === "/api/zid/install" && req.method === "GET") {
    try {
      res.writeHead(302, { location: zidInstallUrl(req), "cache-control": "no-store" });
      res.end();
    } catch (error) {
      send(res, 500, htmlPage("تعذر بدء تفعيل زد", error.message), "text/html; charset=utf-8");
    }
    return true;
  }

  if (url.pathname === "/api/zid/oauth/callback" && req.method === "GET") {
    const code = url.searchParams.get("code") || url.searchParams.get("authorization_code");
    state.integrations = state.integrations || {};
    state.integrations.zidLastCallback = {
      at: new Date().toISOString(),
      query: Object.fromEntries(url.searchParams.entries())
    };
    if (!code) {
      await writeState(state);
      send(res, 200, htmlPage("تم الوصول لرابط زد", "الرابط يعمل الآن، لكن Zid لم يرسل كود التفعيل في هذا الطلب."), "text/html; charset=utf-8");
      return true;
    }
    try {
      const tokens = await exchangeZidCode(req, code);
      state.integrations.zid = {
        ...(state.integrations.zid || {}),
        ...tokens,
        authorizedAt: new Date().toISOString()
      };
      await writeState(state);
      send(res, 200, htmlPage("تم تفعيل ربط زد", "تم حفظ بيانات الربط بنجاح. يمكنك الآن الرجوع إلى تطبيق حسينة ومزامنة الطلبات."), "text/html; charset=utf-8");
    } catch (error) {
      state.integrations.zidLastError = { at: new Date().toISOString(), message: error.message };
      await writeState(state);
      if (state.integrations.zid?.access_token || state.integrations.zid?.authorization || state.integrations.zid?.Authorization) {
        send(res, 200, htmlPage("ربط زد محفوظ", "الربط موجود ومحفوظ. إذا ظهرت هذه الصفحة بعد إعادة التفعيل، فغالباً تم استخدام كود التفعيل مرة ثانية بعد نجاحه."), "text/html; charset=utf-8");
      } else {
        send(res, 500, htmlPage("تعذر تفعيل ربط زد", error.message), "text/html; charset=utf-8");
      }
    }
    return true;
  }

  if (url.pathname === "/api/zid/webhook" && req.method === "POST") {
    if (!checkWebhookAuth(req)) {
      send(res, 401, { ok: false, message: "Invalid Zid webhook credentials." });
      return true;
    }
    const body = await readBody(req);
    const order = getZidOrder(body);
    const result = upsertZidOrder(state, order, "zid_webhook");
    if (result.saved) await writeState(state);
    send(res, 200, { ok: true, ...result });
    return true;
  }

  const policyMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/policy$/);
  if (policyMatch && req.method === "POST") {
    createShippingPolicy(state, decodeURIComponent(policyMatch[1]));
    await writeState(state);
    send(res, 200, publicState(state));
    return true;
  }

  if (policyMatch && req.method === "DELETE") {
    deleteShippingPolicy(state, decodeURIComponent(policyMatch[1]));
    await writeState(state);
    send(res, 200, publicState(state));
    return true;
  }

  const policyPngMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/policy\.png$/);
  if (policyPngMatch && req.method === "GET") {
    const order = state.orders.find((item) => item.id === decodeURIComponent(policyPngMatch[1]));
    if (!order?.shippingPolicy) {
      send(res, 404, "Policy not found.", "text/plain; charset=utf-8");
      return true;
    }
    const png = await shippingPolicyPng(order);
    res.writeHead(200, {
      "content-type": "image/png",
      "cache-control": "no-store",
      "content-disposition": `inline; filename="hasinah-policy-${order.shippingPolicy.number}.png"`
    });
    res.end(png);
    return true;
  }

  const orderMatch = url.pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (orderMatch && req.method === "PATCH") {
    const id = decodeURIComponent(orderMatch[1]);
    const patch = await readBody(req);
    updateOrderState(state, id, patch);
    const order = state.orders.find((item) => item.id === id);
    const zidStatus = zidStatusForPatch(patch.action);
    const zidTarget = zidTargetForPatch(order, patch.action);
    if (order?.driverId && zidTarget?.zid?.id && zidStatus) {
      try {
        await updateZidOrderStatus(zidTarget, zidStatus, state);
        order.zidStatusCode = zidStatus;
        order.zidStatusName = zidStatusLabel(zidStatus);
        if (order.zid) order.zid.lastStatusPushAt = new Date().toISOString();
        if (patch.action === "replacement_deliver" && order.replacementZid) order.replacementZid.lastStatusPushAt = new Date().toISOString();
        order.zidStatusError = "";
        order.history.push({ at: new Date().toISOString(), action: `zid_status_${zidStatus}` });
      } catch (error) {
        order.zidStatusError = error.message;
      }
    }
    await writeState(state);
    send(res, 200, publicState(state));
    return true;
  }

  return false;
}

function zidStatusForPatch(action) {
  if (action === "pickup") return ZID_IN_DELIVERY_STATUS;
  if (action === "complete") return ZID_DELIVERED_STATUS;
  if (["create_return", "create_replacement"].includes(action)) return ZID_PENDING_RETURN_STATUS;
  if (["return_received_base", "replacement_old_returned"].includes(action)) return ZID_RETURNED_STATUS;
  if (action === "replacement_deliver") return ZID_DELIVERED_STATUS;
  return "";
}

function zidTargetForPatch(order, action) {
  if (action === "replacement_deliver" && order?.replacementZid?.id) return { ...order, zid: order.replacementZid };
  return order;
}

function zidStatusLabel(status) {
  if (status === ZID_DELIVERED_STATUS) return "تم التوصيل";
  if (status === ZID_IN_DELIVERY_STATUS) return "قيد التوصيل";
  if (status === ZID_PENDING_RETURN_STATUS) return "بانتظار الإرجاع";
  if (status === ZID_RETURNED_STATUS) return "تم الاسترجاع";
  return status;
}

async function serveStatic(req, res) {
  const requestPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  const safePath = requestPath === "/" ? "/index.html" : decodeURIComponent(requestPath);
  const filePath = path.normalize(path.join(ROOT, safePath));
  if (!filePath.startsWith(ROOT)) {
    send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }
  try {
    const body = await fs.readFile(filePath);
    send(res, 200, body, MIME[path.extname(filePath)] || "application/octet-stream");
  } catch {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/") && (await handleApi(req, res, url))) return;
    await serveStatic(req, res);
  } catch (error) {
    send(res, 500, { ok: false, message: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Hasinah running at http://localhost:${PORT}`);
});
