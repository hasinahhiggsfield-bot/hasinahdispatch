const SESSION_KEY = "hasinah-session-v5";
const LOCAL_STATE_KEY = "hasinah-preview-state-v5";
const IS_FILE_MODE = window.location.protocol === "file:";
const CUSTOMER_PAY = 30;
const LATE_PAY = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

let state = { users: [], orders: [] };
let session = loadSession();
let currentView = "submit";
let activeDriverId = "";
let refreshTimer = null;

const statusLabels = {
  new: "جديد",
  pending_acceptance: "بانتظار السائق",
  accepted: "مقبول",
  completed: "منجز",
  late: "متأخر",
  delayed: "مؤجل",
  cancelled: "ملغي"
};

const typeLabels = {
  Delivery: "توصيل",
  Replacement: "استبدال",
  Return: "إرجاع",
  "Custom delivery": "مشوار خاص"
};

statusLabels.ready = "جاهز للاستلام";
statusLabels.picked_up = "تم الاستلام";
statusLabels.delivered = "تم التوصيل";

const els = {
  loginScreen: document.querySelector("#loginScreen"),
  appShell: document.querySelector("#appShell"),
  printScreen: document.querySelector("#printScreen"),
  printPolicyImage: document.querySelector("#printPolicyImage"),
  backFromPrintBtn: document.querySelector("#backFromPrintBtn"),
  runPrintBtn: document.querySelector("#runPrintBtn"),
  downloadPolicyBtn: document.querySelector("#downloadPolicyBtn"),
  delayModal: document.querySelector("#delayModal"),
  delayForm: document.querySelector("#delayForm"),
  delayOrderId: document.querySelector("#delayOrderId"),
  delayReason: document.querySelector("#delayReason"),
  delayProof: document.querySelector("#delayProof"),
  delayProofPreview: document.querySelector("#delayProofPreview"),
  delaySubmitBtn: document.querySelector("#delaySubmitBtn"),
  cancelDelayBtn: document.querySelector("#cancelDelayBtn"),
  loginForm: document.querySelector("#loginForm"),
  loginUsername: document.querySelector("#loginUsername"),
  loginPassword: document.querySelector("#loginPassword"),
  loginError: document.querySelector("#loginError"),
  logoutBtn: document.querySelector("#logoutBtn"),
  sessionLabel: document.querySelector("#sessionLabel"),
  activeDriverSelect: document.querySelector("#activeDriverSelect"),
  driverSelect: document.querySelector("#driverSelect"),
  accountForm: document.querySelector("#accountForm"),
  orderForm: document.querySelector("#orderForm"),
  jobKind: document.querySelector("#jobKind"),
  customFields: document.querySelector("#customFields"),
  orderStats: document.querySelector("#orderStats"),
  driverStats: document.querySelector("#driverStats"),
  ordersBoard: document.querySelector("#ordersBoard"),
  driverOrders: document.querySelector("#driverOrders"),
  accountList: document.querySelector("#accountList"),
  requestList: document.querySelector("#requestList"),
  searchInput: document.querySelector("#searchInput"),
  categoryFilter: document.querySelector("#categoryFilter"),
  statusFilter: document.querySelector("#statusFilter"),
  driverFilter: document.querySelector("#driverFilter"),
  viewTitle: document.querySelector("#viewTitle"),
  driverNameHeading: document.querySelector("#driverNameHeading"),
  driverRouteSummary: document.querySelector("#driverRouteSummary"),
  driverOwed: document.querySelector("#driverOwed"),
  openCount: document.querySelector("#openCount"),
  todayDoneCount: document.querySelector("#todayDoneCount"),
  failedCount: document.querySelector("#failedCount"),
  resetDemoBtn: document.querySelector("#resetDemoBtn"),
  zidSyncBtn: document.querySelector("#zidSyncBtn"),
  assignNeighborhoodBtn: document.querySelector("#assignNeighborhoodBtn")
};

document.querySelectorAll(".nav-tab").forEach((tab) => {
  tab.addEventListener("click", () => setView(tab.dataset.view));
});

els.jobKind.addEventListener("change", () => {
  els.customFields.classList.toggle("hidden", els.jobKind.value !== "custom");
});

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.loginError.textContent = "";
  try {
    const result = await api("/api/login", {
      method: "POST",
      body: {
        username: els.loginUsername.value.trim(),
        password: els.loginPassword.value.trim()
      }
    });
    session = { user: result.user };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    els.loginForm.reset();
    await bootApp();
  } catch (error) {
    els.loginError.textContent = error.message;
  }
});

els.logoutBtn.addEventListener("click", () => {
  session = null;
  localStorage.removeItem(SESSION_KEY);
  stopRefresh();
  showLogin();
});

els.backFromPrintBtn?.addEventListener("click", () => {
  els.printScreen.classList.add("hidden");
  els.appShell.classList.remove("hidden");
});

els.runPrintBtn?.addEventListener("click", () => window.print());

els.cancelDelayBtn?.addEventListener("click", closeDelayModal);

els.delayProof?.addEventListener("change", async () => {
  const file = els.delayProof.files?.[0];
  if (!file) {
    els.delayProofPreview.classList.add("hidden");
    els.delayProofPreview.removeAttribute("src");
    return;
  }
  const dataUrl = await imageFileToCompressedDataUrl(file);
  els.delayProofPreview.src = dataUrl;
  els.delayProofPreview.classList.remove("hidden");
});

els.delayForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const orderId = els.delayOrderId.value;
  const reason = els.delayReason.value;
  const file = els.delayProof.files?.[0];
  if (!reason || !file) {
    alert("اختر السبب وارفع صورة إثبات.");
    return;
  }
  els.delaySubmitBtn.disabled = true;
  els.delaySubmitBtn.textContent = "جاري الإرسال...";
  try {
    const proof = await imageFileToCompressedDataUrl(file);
    await updateOrder(orderId, { action: "delay_request", reason, proof, proofName: file.name });
    closeDelayModal();
    alert("تم إرسال طلب التأجيل للمراجعة.");
  } catch (error) {
    alert(error.message || "تعذر إرسال طلب التأجيل.");
  } finally {
    els.delaySubmitBtn.disabled = false;
    els.delaySubmitBtn.textContent = "إرسال للمراجعة";
  }
});

els.activeDriverSelect.addEventListener("change", () => {
  activeDriverId = els.activeDriverSelect.value;
  render();
});

els.searchInput.addEventListener("input", render);
els.categoryFilter.addEventListener("change", render);
els.statusFilter.addEventListener("change", render);
els.driverFilter.addEventListener("change", render);

els.resetDemoBtn.addEventListener("click", async () => {
  if (!confirm("مسح كل البيانات والإبقاء على حساب يحيى فقط؟")) return;
  alert("تم إيقاف المسح لحماية بيانات الحسابات والطلبات.");
});

els.zidSyncBtn?.addEventListener("click", async () => {
  els.zidSyncBtn.disabled = true;
  const oldText = els.zidSyncBtn.textContent;
  els.zidSyncBtn.textContent = "جاري المزامنة...";
  try {
    const result = await api("/api/zid/sync", { method: "POST" });
    state = { users: result.users, orders: result.orders };
    render();
    alert(`تمت مزامنة زد. الطلبات المستوردة: ${result.zidSync?.imported || 0}`);
  } catch (error) {
    alert(error.message);
  } finally {
    els.zidSyncBtn.disabled = false;
    els.zidSyncBtn.textContent = oldText;
  }
});

els.assignNeighborhoodBtn?.addEventListener("click", async () => {
  const driverId = els.driverFilter.value && els.driverFilter.value !== "all" ? els.driverFilter.value : activeDriverId;
  const area = prompt("اكتب اسم الحي كما يظهر في الطلبات:");
  if (!area || !driverId) return;
  const result = await api("/api/orders/assign-neighborhood", { method: "POST", body: { area, driverId } });
  state = { users: result.users, orders: result.orders };
  render();
  alert(`تم إسناد ${result.assigned || 0} طلب للسائق.`);
});

els.orderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(els.orderForm).entries());
  await api("/api/orders", { method: "POST", body: payload });
  els.orderForm.reset();
  els.customFields.classList.add("hidden");
  await loadState();
  setView("orders");
  render();
});

els.accountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    role: document.querySelector("#accountRole").value,
    name: document.querySelector("#accountName").value.trim(),
    phone: document.querySelector("#accountPhone").value.trim(),
    username: document.querySelector("#accountUsername").value.trim(),
    password: document.querySelector("#accountPassword").value.trim()
  };
  await api("/api/accounts", { method: "POST", body: payload });
  els.accountForm.reset();
  await loadState();
  activeDriverId = drivers()[0]?.id || "";
  setView("accounts");
  render();
});

async function api(path, options = {}) {
  if (IS_FILE_MODE) return localApi(path, options);
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store"
  });
  const result = await response.json();
  if (!response.ok || result.ok === false) throw new Error(result.message || "Request failed.");
  return result.data || result;
}

function uid(prefix) {
  if (crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

function usedPolicyNumbers(targetState) {
  const numbers = new Set();
  targetState.orders.forEach((order) => {
    if (order.shippingPolicy?.number) numbers.add(String(order.shippingPolicy.number));
    (order.cancelledPolicies || []).forEach((policy) => {
      if (policy?.number) numbers.add(String(policy.number));
    });
  });
  return numbers;
}

function generatePolicyNumber(targetState) {
  const used = usedPolicyNumbers(targetState);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const number = String(Math.floor(1000000000 + Math.random() * 9000000000));
    if (!used.has(number)) return number;
  }
  throw new Error("تعذر إنشاء رقم بوليصة فريد.");
}

function seedState() {
  return {
    users: [{ id: uid("usr"), role: "admin", name: "يحيى", username: "yahya", password: "123123", phone: "" }],
    orders: []
  };
}

function readLocalState() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_STATE_KEY));
    if (Array.isArray(saved?.users) && Array.isArray(saved?.orders)) return saved;
  } catch {
    // Use a clean state.
  }
  const initial = seedState();
  writeLocalState(initial);
  return initial;
}

function writeLocalState(nextState) {
  localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(nextState));
}

async function localApi(path, options = {}) {
  const method = options.method || "GET";
  const localState = readLocalState();

  if (path === "/api/state" && method === "GET") return localState;

  if (path === "/api/login" && method === "POST") {
    const username = String(options.body?.username || "").trim().toLowerCase();
    const password = String(options.body?.password || "").trim();
    const user = localState.users.find((item) => item.username.toLowerCase() === username && item.password === password);
    if (!user) throw new Error("اسم المستخدم أو كلمة المرور غير صحيحة.");
    return { ok: true, user: publicUser(user) };
  }

  if (path === "/api/reset" && method === "POST") {
    const initial = seedState();
    writeLocalState(initial);
    return initial;
  }

  if (path === "/api/accounts" && method === "POST") {
    createAccount(localState, options.body || {});
    writeLocalState(localState);
    return localState;
  }

  if (path === "/api/orders" && method === "POST") {
    createOrder(localState, options.body || {});
    writeLocalState(localState);
    return localState;
  }

  const policyMatch = path.match(/^\/api\/orders\/(.+)\/policy$/);
  if (policyMatch && method === "POST") {
    createShippingPolicy(localState, decodeURIComponent(policyMatch[1]));
    writeLocalState(localState);
    return localState;
  }

  if (policyMatch && method === "DELETE") {
    deleteShippingPolicy(localState, decodeURIComponent(policyMatch[1]));
    writeLocalState(localState);
    return localState;
  }

  const orderMatch = path.match(/^\/api\/orders\/(.+)$/);
  if (orderMatch && method === "PATCH") {
    updateOrderState(localState, decodeURIComponent(orderMatch[1]), options.body || {});
    writeLocalState(localState);
    return localState;
  }

  throw new Error("Preview mode does not support this request.");
}

function publicUser(user) {
  return { id: user.id, role: user.role, name: user.name, username: user.username, phone: user.phone };
}

function createAccount(targetState, body) {
  const role = String(body.role || "driver");
  const username = String(body.username || "").trim().toLowerCase();
  if (!["admin", "driver"].includes(role)) throw new Error("اختر مدير أو سائق.");
  if (!body.name || !username || !body.password) throw new Error("الاسم واسم المستخدم وكلمة المرور مطلوبة.");
  if (targetState.users.some((user) => user.username.toLowerCase() === username)) throw new Error("اسم المستخدم موجود مسبقا.");
  targetState.users.push({
    id: uid(role === "admin" ? "adm" : "drv"),
    role,
    name: String(body.name).trim(),
    phone: String(body.phone || "").trim(),
    username,
    password: String(body.password).trim()
  });
}

function createOrder(targetState, body) {
  if (!body.number || !body.customer || !body.phone || !body.area) {
    throw new Error("رقم الطلب والاسم ورقم الواتساب والحي مطلوبة.");
  }
  const kind = body.kind === "custom" ? "custom" : "customer";
  const now = new Date().toISOString();
  const customAmount = Number(body.customAmount || 0);
  const timerHours = Number(body.timerHours || 24);
  if (kind === "custom" && (!customAmount || customAmount <= 0)) throw new Error("المشوار الخاص يحتاج مبلغ محدد.");

  targetState.orders.unshift({
    id: uid("ord"),
    kind,
    number: String(body.number).trim(),
    type: kind === "custom" ? "Custom delivery" : String(body.type || "Delivery"),
    flowType: kind === "custom" ? "custom" : "order",
    customer: String(body.customer).trim(),
    phone: normalizePhone(body.phone),
    area: String(body.area).trim(),
    driverId: String(body.driverId || "").trim(),
    customAmount: kind === "custom" ? customAmount : 0,
    timerHours: kind === "custom" ? Math.max(1, timerHours || 24) : 24,
    requestDate: body.requestDate ? new Date(body.requestDate).toISOString() : now,
    orderCreatedAt: now,
    status: kind === "custom" && body.driverId ? "pending_acceptance" : body.driverId ? "ready" : "new",
    acceptedAt: "",
    pickedUpAt: "",
    deadlineAt: "",
    delayRequests: [],
    appeals: [],
    createdAt: now,
    updatedAt: now,
    history: [{ at: now, action: "created" }]
  });
}

function updateOrderState(targetState, id, patch) {
  const order = targetState.orders.find((item) => item.id === id);
  if (!order) throw new Error("لم يتم العثور على الطلب.");
  const now = new Date();

  if (Object.prototype.hasOwnProperty.call(patch, "driverId")) {
    order.driverId = String(patch.driverId || "");
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
  if (patch.action === "cancel") order.status = "cancelled";
  if (patch.action === "delay_request") {
    order.delayRequests = Array.isArray(order.delayRequests) ? order.delayRequests : [];
    order.delayRequests.push({
      id: uid("delay"),
      reason: String(patch.reason || "العميل لا يستطيع الاستلام الآن"),
      proof: String(patch.proof || ""),
      proofName: String(patch.proofName || ""),
      status: "pending",
      createdAt: now.toISOString()
    });
  }
  if (patch.action === "appeal") {
    order.appeals = Array.isArray(order.appeals) ? order.appeals : [];
    order.appeals.push({ id: uid("appeal"), reason: String(patch.reason || "تم تقديم اعتراض"), status: "pending", createdAt: now.toISOString() });
  }
  if (patch.action === "create_return") duplicateServiceOrder(targetState, order, "return", now);
  if (patch.action === "create_replacement") duplicateServiceOrder(targetState, order, "replacement", now, patch.replacementOrderNumber);
  if (patch.action === "approve_request") approveRequest(order, patch.requestId, now);
  if (patch.action === "reject_request") rejectRequest(order, patch.requestId);

  if (["accepted", "picked_up"].includes(order.status) && isLate(order, now)) order.status = "late";
  order.updatedAt = now.toISOString();
  order.history = Array.isArray(order.history) ? order.history : [];
  order.history.push({ at: now.toISOString(), action: patch.action || "updated" });
}

function duplicateServiceOrder(targetState, source, flowType, now, replacementOrderNumber = "") {
  if (flowType === "replacement" && !String(replacementOrderNumber || "").trim()) {
    throw new Error("رقم طلب الاستبدال مطلوب.");
  }
  const copy = {
    ...source,
    id: uid("ord"),
    flowType,
    kind: "customer",
    type: flowType === "return" ? "Return" : "Replacement",
    returnedOrderNumber: source.returnedOrderNumber || source.number,
    replacementOrderNumber: flowType === "replacement" ? String(replacementOrderNumber).trim() : "",
    sourceOrderId: source.id,
    status: source.driverId ? "ready" : "new",
    acceptedAt: "",
    pickedUpAt: "",
    deadlineAt: "",
    completedAt: "",
    cutRemoved: false,
    delayRequests: [],
    appeals: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    history: [{ at: now.toISOString(), action: `created_${flowType}` }]
  };
  targetState.orders.unshift(copy);
}

function createShippingPolicy(targetState, id) {
  const order = targetState.orders.find((item) => item.id === id);
  if (!order) throw new Error("لم يتم العثور على الطلب.");
  if (["delivered", "completed"].includes(order.status)) throw new Error("لا يمكن إنشاء بوليصة بعد التسليم.");
  const now = new Date().toISOString();
  if (!order.shippingPolicy) {
    order.shippingPolicy = { number: generatePolicyNumber(targetState), createdAt: now, status: "active" };
  }
  order.status = "ready";
  order.updatedAt = now;
  order.history = Array.isArray(order.history) ? order.history : [];
  order.history.push({ at: now, action: "policy_generated", policyNumber: order.shippingPolicy.number });
}

function deleteShippingPolicy(targetState, id) {
  const order = targetState.orders.find((item) => item.id === id);
  if (!order) throw new Error("لم يتم العثور على الطلب.");
  if (["delivered", "completed"].includes(order.status)) throw new Error("لا يمكن حذف البوليصة بعد التسليم.");
  if (!order.shippingPolicy) return;
  const now = new Date().toISOString();
  order.cancelledPolicies = Array.isArray(order.cancelledPolicies) ? order.cancelledPolicies : [];
  order.cancelledPolicies.push({ ...order.shippingPolicy, cancelledAt: now, status: "cancelled" });
  order.shippingPolicy = null;
  order.status = order.driverId ? "ready" : "new";
  order.updatedAt = now;
  order.history = Array.isArray(order.history) ? order.history : [];
  order.history.push({ at: now, action: "policy_deleted" });
}

function acceptOrder(order, now) {
  order.status = "accepted";
  order.acceptedAt = now.toISOString();
  const hours = order.kind === "custom" ? Number(order.timerHours || 24) : 24;
  order.deadlineAt = new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function pickUpOrder(order, now) {
  order.status = "picked_up";
  order.pickedUpAt = now.toISOString();
  order.acceptedAt = order.acceptedAt || now.toISOString();
  order.deadlineAt = new Date(now.getTime() + DAY_MS).toISOString();
  order.cutRemoved = false;
}

function approveRequest(order, requestId, now) {
  const request = findRequest(order, requestId);
  if (!request) return;
  request.status = "approved";
  request.reviewedAt = now.toISOString();
  order.status = order.pickedUpAt ? "picked_up" : "ready";
  order.deadlineAt = new Date(now.getTime() + DAY_MS).toISOString();
  order.cutRemoved = true;
}

function rejectRequest(order, requestId) {
  const request = findRequest(order, requestId);
  if (request) request.status = "rejected";
}

function findRequest(order, requestId) {
  return [...(order.delayRequests || []), ...(order.appeals || [])].find((request) => request.id === requestId);
}

function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d]/g, "");
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function currentUser() {
  if (!session?.user) return null;
  return state.users.find((user) => user.id === session.user.id) || session.user;
}

function drivers() {
  return state.users.filter((user) => user.role === "driver");
}

async function loadState() {
  state = await api("/api/state");
  markLateOrders();
}

function markLateOrders() {
  const now = new Date();
  state.orders.forEach((order) => {
    if (["accepted", "picked_up"].includes(order.status) && isLate(order, now)) order.status = "late";
  });
}

function showLogin() {
  els.loginScreen.classList.remove("hidden");
  els.appShell.classList.add("hidden");
  document.body.dataset.role = "";
}

async function bootApp() {
  if (!session?.user) {
    showLogin();
    return;
  }
  await loadState();
  const user = currentUser();
  if (!user) {
    showLogin();
    return;
  }
  els.loginScreen.classList.add("hidden");
  els.appShell.classList.remove("hidden");
  els.sessionLabel.textContent = `${user.name} - ${user.role === "admin" ? "مدير" : "سائق"}`;
  document.body.dataset.role = user.role;
  activeDriverId = user.role === "driver" ? user.id : drivers()[0]?.id || "";
  setView(user.role === "driver" ? "driver" : "submit");
  startRefresh();
}

function startRefresh() {
  stopRefresh();
  refreshTimer = setInterval(async () => {
    try {
      await loadState();
      render();
    } catch {
      // Preview stays usable even without the server.
    }
  }, 7000);
}

function stopRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

function setView(view) {
  const user = currentUser();
  if (!user) return;
  if (user.role === "driver") view = "driver";
  currentView = view;
  document.querySelectorAll(".nav-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  const sectionView = view === "zidOrders" ? "orders" : view;
  document.querySelectorAll(".view").forEach((section) => section.classList.toggle("active-view", section.id === `${sectionView}View`));
  els.searchInput.parentElement.classList.toggle("hidden", ["submit", "addDriver", "accounts", "requests"].includes(view));
  els.viewTitle.textContent = { submit: "إضافة طلب", orders: "لوحة الطلبات", driver: "السائق", accounts: "الحسابات", requests: "المراجعة" }[view];
  els.viewTitle.textContent = {
    submit: "إضافة طلب",
    orders: "عرض الطلبات",
    driver: "تتبع السائقين",
    addDriver: "إضافة سائق",
    accounts: "الحسابات",
    requests: "المراجعة"
  }[view] || els.viewTitle.textContent;
  if (view === "zidOrders") els.viewTitle.textContent = "طلبات زد";
  render();
}

function render() {
  const user = currentUser();
  if (!user) return;
  ensureDriverSelection();
  renderDriverOptions();
  renderFilters();
  renderCounts();
  renderOrdersBoard();
  renderDriverQueue();
  renderAccountList();
  renderRequests();
}

function getFlowType(order) {
  if (order.flowType) return order.flowType;
  if (order.kind === "custom") return "custom";
  if (order.type === "Return") return "return";
  if (order.type === "Replacement") return "replacement";
  return "order";
}

function isZidOrder(order) {
  return Boolean(order.zid?.id || order.zidStatusCode || order.zidStatusName);
}

function ensureDriverSelection() {
  const user = currentUser();
  if (user.role === "driver") {
    activeDriverId = user.id;
    return;
  }
  if (!drivers().some((driver) => driver.id === activeDriverId)) activeDriverId = drivers()[0]?.id || "";
}

function renderDriverOptions() {
  const unassigned = '<option value="">غير مسند</option>';
  const options = drivers().map((driver) => `<option value="${driver.id}">${escapeHtml(driver.name)}</option>`).join("");
  els.driverSelect.innerHTML = unassigned + options;
  els.activeDriverSelect.innerHTML = options || '<option value="">لا يوجد سائقون</option>';
  els.activeDriverSelect.value = activeDriverId;
}

function renderFilters() {
  const selectedDriver = els.driverFilter.value || "all";
  const driverOptionsHtml = [
    '<option value="all">كل السائقين</option>',
    '<option value="">غير مسند</option>',
    ...drivers().map((driver) => `<option value="${driver.id}">${escapeHtml(driver.name)}</option>`)
  ].join("");
  els.driverFilter.innerHTML = driverOptionsHtml;
  els.driverFilter.value = [...els.driverFilter.options].some((option) => option.value === selectedDriver) ? selectedDriver : "all";
}

function renderCounts() {
  const visible = visibleOrders();
  els.openCount.textContent = visible.filter((order) => !["completed", "delivered", "cancelled"].includes(order.status)).length;
  els.todayDoneCount.textContent = visible.filter((order) => ["completed", "delivered", "late"].includes(order.status)).length;
  els.failedCount.textContent = visible.filter((order) => order.status === "late").length;
}

function getStats(orders) {
  return {
    total: orders.length,
    orders: orders.filter((order) => getFlowType(order) === "order").length,
    returns: orders.filter((order) => getFlowType(order) === "return").length,
    replacements: orders.filter((order) => getFlowType(order) === "replacement").length,
    accepted: orders.filter((order) => order.status === "accepted").length,
    late: orders.filter((order) => order.status === "late").length
  };
}

function renderStats(root, orders) {
  const stats = getStats(orders);
  root.innerHTML = `
    <button data-stat-filter="all" type="button"><strong>${stats.total}</strong><span>الإجمالي</span></button>
    <button data-stat-filter="order" type="button"><strong>${stats.orders}</strong><span>طلبات</span></button>
    <button data-stat-filter="return" type="button"><strong>${stats.returns}</strong><span>إرجاع</span></button>
    <button data-stat-filter="replacement" type="button"><strong>${stats.replacements}</strong><span>استبدال</span></button>
    <button data-status-filter="accepted" type="button"><strong>${stats.accepted}</strong><span>مقبولة</span></button>
    <button data-status-filter="late" type="button"><strong>${stats.late}</strong><span>متأخرة</span></button>
  `;
  root.querySelectorAll("[data-stat-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      els.categoryFilter.value = button.dataset.statFilter;
      els.statusFilter.value = "all";
      render();
    });
  });
  root.querySelectorAll("[data-status-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      els.categoryFilter.value = "all";
      els.statusFilter.value = button.dataset.statusFilter;
      render();
    });
  });
}

function visibleOrders() {
  const user = currentUser();
  if (user.role === "driver") return state.orders.filter((order) => order.driverId === user.id);
  return state.orders;
}

function matchingOrders(orders) {
  const search = els.searchInput.value.trim().toLowerCase();
  return orders.filter((order) => `${order.number} ${order.customer} ${order.phone} ${order.area} ${order.locationText || ""} ${order.shippingPolicy?.number || ""} ${(order.products || []).map((product) => product.name).join(" ")}`.toLowerCase().includes(search));
}

function renderOrdersBoard() {
  if (currentUser().role !== "admin") {
    els.ordersBoard.innerHTML = "";
    return;
  }
  const status = els.statusFilter.value;
  const category = els.categoryFilter.value;
  const driverId = els.driverFilter.value;
  const sourceOrders = currentView === "zidOrders"
    ? state.orders.filter(isZidOrder)
    : state.orders.filter((order) => !isZidOrder(order));
  let baseOrders = matchingOrders(sourceOrders);
  if (driverId !== "all") baseOrders = baseOrders.filter((order) => order.driverId === driverId);
  renderStats(els.orderStats, baseOrders);
  let orders = baseOrders;
  if (category !== "all") orders = orders.filter((order) => getFlowType(order) === category);
  if (status !== "all") orders = orders.filter((order) => order.status === status);
  els.ordersBoard.innerHTML = orders.length
    ? orders.map((order) => renderOrderCard(order, "admin")).join("")
    : getEmptyState("لا توجد طلبات", "أضف طلب عميل أو مشوار خاص.");
  wireOrderControls(els.ordersBoard);
}

function renderDriverQueue() {
  const driver = state.users.find((item) => item.id === activeDriverId);
  const category = els.categoryFilter.value;
  const status = els.statusFilter.value;
  const baseOrders = matchingOrders(state.orders.filter((order) => order.driverId === activeDriverId && order.status !== "cancelled"));
  let orders = baseOrders;
  if (category !== "all") orders = orders.filter((order) => getFlowType(order) === category);
  if (status !== "all") orders = orders.filter((order) => order.status === status);
  const owed = orders.reduce((total, order) => total + getPay(order), 0);
  els.driverNameHeading.textContent = driver ? `لوحة ${driver.name}` : "لم يتم اختيار سائق";
  els.driverRouteSummary.textContent = orders.length ? `${orders.length} طلبات مسندة. طلبات العملاء 30 ريال، وتصبح 20 ريال عند التأخير.` : "لا توجد طلبات مسندة.";
  els.driverOwed.textContent = `${owed} ريال`;
  renderStats(els.driverStats, baseOrders);
  els.driverOrders.innerHTML = orders.length ? orders.map((order) => renderOrderCard(order, "driver")).join("") : getEmptyState("لا توجد طلبات", "ستظهر الطلبات المسندة هنا.");
  wireOrderControls(els.driverOrders);
}

function renderAccountList() {
  els.accountList.innerHTML = state.users.length
    ? state.users
        .map((user) => {
          const active = user.role === "driver" ? state.orders.filter((order) => order.driverId === user.id && !["completed", "delivered", "cancelled"].includes(order.status)).length : 0;
          const owed = user.role === "driver" ? state.orders.filter((order) => order.driverId === user.id).reduce((total, order) => total + getPay(order), 0) : 0;
          return `
            <article class="driver-card">
              <div>
                <strong>${escapeHtml(user.name)} (${user.role === "admin" ? "مدير" : "سائق"})</strong>
                <div class="order-details">الدخول: ${escapeHtml(user.username)} / ${escapeHtml(user.password)}</div>
                ${user.role === "driver" ? `<div class="order-details">${active} نشط | ${owed} ريال مستحق</div>` : ""}
              </div>
            </article>
          `;
        })
        .join("")
    : getEmptyState("لا توجد حسابات", "أنشئ أول حساب.");
}

function renderRequests() {
  const requests = [];
  state.orders.forEach((order) => {
    [...(order.delayRequests || []), ...(order.appeals || [])].forEach((request) => {
      if (request.status === "pending") requests.push({ order, request });
    });
  });
  els.requestList.innerHTML = requests.length
    ? requests
        .map(({ order, request }) => {
          const driver = state.users.find((user) => user.id === order.driverId);
          const isDelay = String(request.id || "").startsWith("delay");
          return `
          <article class="order-card">
            <div class="order-card-header">
              <div>
                <strong>${isDelay ? "طلب تأجيل من السائق" : "اعتراض من السائق"} - ${escapeHtml(order.number)}</strong>
                <div class="order-details">
                  <span><strong>العميل:</strong> ${escapeHtml(order.customer)}</span>
                  <span><strong>السائق:</strong> ${escapeHtml(driver?.name || "غير محدد")}</span>
                  <span><strong>السبب:</strong> ${escapeHtml(request.reason)}</span>
                </div>
                ${request.proof ? `<a class="proof-link" href="${escapeAttribute(request.proof)}" target="_blank" rel="noreferrer">فتح إثبات السائق</a>` : ""}
              </div>
              <span class="status-pill status-pending_acceptance">بانتظار المراجعة</span>
            </div>
            <div class="order-actions">
              <button class="primary-button" data-action="approve_request" data-request="${request.id}" data-id="${order.id}" type="button">قبول</button>
              <button class="danger-button" data-action="reject_request" data-request="${request.id}" data-id="${order.id}" type="button">رفض</button>
            </div>
          </article>
        `;
        })
        .join("")
    : getEmptyState("لا توجد طلبات مراجعة", "طلبات التأجيل والاعتراضات من السائقين ستظهر هنا.");
  wireOrderControls(els.requestList);
}

function renderOrderCard(order, mode) {
  const createdDate = order.orderCreatedAt || order.requestDate || order.createdAt || "";
  const orderNumberHtml = mode === "admin" && order.zid?.url
    ? `<a href="${escapeAttribute(order.zid.url)}" target="_blank" rel="noreferrer">${escapeHtml(order.number)}</a>`
    : escapeHtml(order.number);
  const driver = state.users.find((item) => item.id === order.driverId);
  const pay = getPay(order);
  const deadline = order.deadlineAt ? formatDeadline(order.deadlineAt) : "لم يستلم بعد";
  const canDriverAccept = mode === "driver" && order.kind === "custom" && order.status === "pending_acceptance";
  const canPickup = mode === "driver" && ["ready", "accepted"].includes(order.status);
  const canComplete = mode === "driver" && ["picked_up", "late", "delayed"].includes(order.status);
  const canDelay = mode === "driver" && ["picked_up", "late", "delayed"].includes(order.status);
  const canAppeal = mode === "driver" && order.status === "late";
  const canCreateService = mode === "admin" && getFlowType(order) === "order";
  const canManagePolicy = mode === "admin" && !["delivered", "completed"].includes(order.status);
  const canAssignDriver = mode === "admin" && !["delivered", "completed", "cancelled"].includes(order.status);
  const statusText = statusLabels[order.status] || order.status || "غير محدد";
  const policyLine = order.shippingPolicy ? `<span><strong>رقم البوليصة:</strong> ${escapeHtml(order.shippingPolicy.number)}</span>` : "";
  const policyPreview = mode === "admin" && order.shippingPolicy
    ? `<button class="policy-preview" data-policy-print="${order.id}" type="button"><img src="${escapeAttribute(policyPngPath(order))}" alt="بوليصة الشحن ${escapeAttribute(order.shippingPolicy.number)}" /><span>اضغط هنا للطباعة المباشرة</span></button>`
    : "";
  const policyActions =
    mode === "admin"
      ? `<div class="order-actions policy-actions">
          ${canManagePolicy && !order.shippingPolicy ? `<button class="primary-button" data-policy-create="${order.id}" type="button">جاهز للطباعة</button>` : ""}
          ${order.shippingPolicy ? `<button class="primary-button print-now-button" data-policy-print="${order.id}" type="button">طباعة مباشرة</button>` : ""}
          ${canManagePolicy && order.shippingPolicy ? `<button class="ghost-button" data-policy-delete="${order.id}" type="button">حذف البوليصة</button>` : ""}
        </div>`
      : "";
  const zidLine = order.zidStatusName || order.zidStatusCode ? `<span><strong>حالة زد:</strong> ${escapeHtml(order.zidStatusName || order.zidStatusCode)}${order.zidStatusError ? ` - ${escapeHtml(order.zidStatusError)}` : ""}</span>` : "";
  const locationLine = order.mapUrl ? `<span><strong>الموقع:</strong> <a href="${escapeAttribute(order.mapUrl)}" target="_blank" rel="noreferrer">فتح الاتجاهات</a></span>` : "";
  const products = Array.isArray(order.products) ? order.products : [];
  const productLine = products.length
    ? `<div class="product-strip">${products.map((product) => `<span class="product-chip">${product.image ? `<img src="${escapeAttribute(product.image)}" alt="" loading="lazy" />` : ""}<b>${escapeHtml(product.name)}</b>${product.quantity > 1 ? `<small>x${product.quantity}</small>` : ""}</span>`).join("")}</div>`
    : "";
  const serviceDetails =
    getFlowType(order) === "replacement"
      ? `<span><strong>المسترجع:</strong> ${escapeHtml(order.returnedOrderNumber || order.number)}</span><span><strong>يسلم للعميل:</strong> ${escapeHtml(order.replacementOrderNumber || "غير محدد")}</span>`
      : getFlowType(order) === "return"
        ? `<span><strong>طلب الإرجاع:</strong> ${escapeHtml(order.returnedOrderNumber || order.number)}</span>`
        : "";
  return `
    <article class="order-card" data-priority="${escapeHtml(order.kind)}">
      <div class="order-card-header">
        <div>
          <strong>${orderNumberHtml} - ${escapeHtml(order.customer)}</strong>
          <div class="order-details">${escapeHtml(order.area)} | ${escapeHtml(typeLabels[order.type] || order.type)} | تاريخ الإنشاء: ${escapeHtml(createdDate ? formatDateTime(createdDate) : "غير محدد")}</div>
          <div class="order-status-line">الحالة الحالية: <strong>${escapeHtml(statusText)}</strong>${driver ? ` | السائق: <strong>${escapeHtml(driver.name)}</strong>` : " | غير مسند"}</div>
        </div>
        <span class="status-pill status-${order.status}">${escapeHtml(statusText)}</span>
      </div>

      <div class="order-details">
        <span><strong>واتساب:</strong> <a href="${escapeAttribute(whatsappLink(order.phone))}" target="_blank" rel="noreferrer">${escapeHtml(order.phone)}</a></span>
        <span><strong>السائق:</strong> ${escapeHtml(driver?.name || "غير مسند")}</span>
        <span><strong>الموعد النهائي:</strong> ${escapeHtml(deadline)}</span>
        <span><strong>مستحق السائق:</strong> ${pay} ريال${order.status === "late" && order.kind === "customer" ? " (خصم تأخير)" : ""}</span>
        ${zidLine}
        ${locationLine}
        ${policyLine}
        ${serviceDetails}
      </div>
      ${productLine}
      ${policyPreview}
      ${policyActions}

      <div class="order-actions">
        ${canAssignDriver ? `<label class="inline-control">السائق ${`<select data-assign="${order.id}" aria-label="تعيين السائق">${driverOptions(order.driverId)}</select>`}</label>` : ""}
        ${canDriverAccept ? `<button class="primary-button" data-action="accept" data-id="${order.id}" type="button">قبول المبلغ</button>` : ""}
        ${canPickup ? `<button class="primary-button" data-action="pickup" data-id="${order.id}" type="button">استلمت الطلب</button>` : ""}
        ${canComplete ? `<button class="primary-button" data-action="complete" data-id="${order.id}" type="button">تم التوصيل</button>` : ""}
        ${canDelay ? `<button class="secondary-button" data-action="delay_request" data-id="${order.id}" type="button">العميل لا يستطيع الاستلام</button>` : ""}
        ${canAppeal ? `<button class="secondary-button" data-action="appeal" data-id="${order.id}" type="button">اعتراض على الخصم</button>` : ""}
        ${canCreateService ? `<button class="secondary-button" data-action="create_return" data-id="${order.id}" type="button">إنشاء إرجاع</button>` : ""}
        ${canCreateService ? `<button class="secondary-button" data-action="create_replacement" data-id="${order.id}" type="button">إنشاء استبدال</button>` : ""}
        ${mode === "admin" && order.status !== "cancelled" ? `<button class="ghost-button" data-action="cancel" data-id="${order.id}" type="button">إلغاء</button>` : ""}
      </div>
    </article>
  `;
}

function driverOptions(selectedId) {
  return [
    '<option value="">غير مسند</option>',
    ...drivers().map((driver) => `<option value="${driver.id}" ${driver.id === selectedId ? "selected" : ""}>${escapeHtml(driver.name)}</option>`)
  ].join("");
}

function wireOrderControls(root) {
  root.querySelectorAll("[data-assign]").forEach((select) => {
    select.addEventListener("change", async () => updateOrder(select.dataset.assign, { driverId: select.value }));
  });
  root.querySelectorAll("[data-policy-create]").forEach((button) => {
    button.addEventListener("click", async () => createPolicy(button.dataset.policyCreate));
  });
  root.querySelectorAll("[data-policy-print]").forEach((button) => {
    button.addEventListener("click", () => printPolicy(button.dataset.policyPrint));
  });
  root.querySelectorAll("[data-policy-delete]").forEach((button) => {
    button.addEventListener("click", async () => deletePolicy(button.dataset.policyDelete));
  });
  root.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const patch = { action: button.dataset.action };
      if (button.dataset.request) patch.requestId = button.dataset.request;
      if (button.dataset.action === "delay_request") {
        openDelayModal(button.dataset.id);
        return;
      }
      if (button.dataset.action === "appeal") patch.reason = prompt("ما سبب الاعتراض على الخصم؟") || "السائق اعترض على خصم التأخير.";
      if (button.dataset.action === "create_replacement") {
        const replacementOrderNumber = prompt("اكتب رقم طلب الاستبدال الذي سيتم تسليمه للعميل:");
        if (!replacementOrderNumber) return;
        patch.replacementOrderNumber = replacementOrderNumber;
      }
      await updateOrder(button.dataset.id, patch);
    });
  });
}

async function updateOrder(id, patch) {
  await api(`/api/orders/${encodeURIComponent(id)}`, { method: "PATCH", body: patch });
  await loadState();
  render();
}

function openDelayModal(orderId) {
  els.delayOrderId.value = orderId;
  els.delayReason.value = "";
  els.delayProof.value = "";
  els.delayProofPreview.classList.add("hidden");
  els.delayProofPreview.removeAttribute("src");
  els.delayModal.classList.remove("hidden");
}

function closeDelayModal() {
  els.delayModal.classList.add("hidden");
  els.delayForm.reset();
  els.delaySubmitBtn.disabled = false;
  els.delaySubmitBtn.textContent = "إرسال للمراجعة";
  els.delayProofPreview.classList.add("hidden");
  els.delayProofPreview.removeAttribute("src");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("تعذر قراءة صورة الإثبات."));
    reader.readAsDataURL(file);
  });
}

function imageFileToCompressedDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxSide = 1280;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      image.onerror = () => reject(new Error("تعذر تجهيز صورة الإثبات."));
      image.src = String(reader.result || "");
    };
    reader.onerror = () => reject(new Error("تعذر قراءة صورة الإثبات."));
    reader.readAsDataURL(file);
  });
}

async function createPolicy(id) {
  try {
    state = await api(`/api/orders/${encodeURIComponent(id)}/policy`, { method: "POST" });
    render();
    setTimeout(() => printPolicy(id), 150);
  } catch (error) {
    alert(error.message);
  }
}

async function deletePolicy(id) {
  if (!confirm("حذف البوليصة الحالية؟ الرقم لن يستخدم مرة ثانية.")) return;
  try {
    state = await api(`/api/orders/${encodeURIComponent(id)}/policy`, { method: "DELETE" });
    render();
  } catch (error) {
    alert(error.message);
  }
}

function printPolicy(id) {
  const order = state.orders.find((item) => item.id === id);
  if (!order?.shippingPolicy) {
    alert("لا توجد بوليصة لهذا الطلب.");
    return;
  }
  const png = policyPngPath(order);
  els.printPolicyImage.src = png;
  els.downloadPolicyBtn.href = png;
  els.downloadPolicyBtn.download = `hasinah-policy-${order.shippingPolicy.number}.png`;
  els.appShell.classList.add("hidden");
  els.printScreen.classList.remove("hidden");
  els.printPolicyImage.onload = () => setTimeout(() => window.print(), 250);
}

function policyPngPath(order) {
  return `/api/orders/${encodeURIComponent(order.id)}/policy.png?v=${encodeURIComponent(order.shippingPolicy.number)}`;
}

function isLate(order, now = new Date()) {
  return order.deadlineAt && now.getTime() > new Date(order.deadlineAt).getTime() && !order.cutRemoved;
}

function getPay(order) {
  if (["cancelled", "pending_acceptance", "new", "ready", "accepted", "picked_up", "delayed"].includes(order.status)) return 0;
  if (order.kind === "custom") return Number(order.customAmount || 0);
  if (order.cutRemoved) return CUSTOMER_PAY;
  if (order.status === "late" || (order.status === "delivered" && isLate(order))) return LATE_PAY;
  return CUSTOMER_PAY;
}

function whatsappLink(phone) {
  const normalized = normalizePhone(phone);
  const international = normalized.startsWith("966") ? normalized : `966${normalized.replace(/^0/, "")}`;
  return `https://wa.me/${international}`;
}

function formatDeadline(value) {
  const date = new Date(value);
  return date.toLocaleString("ar-SA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDate(value) {
  return new Date(value).toLocaleDateString("ar-SA", { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "غير محدد";
  return date.toLocaleString("ar-SA", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function getEmptyState(title, message) {
  return `<div class="empty-state"><div><strong>${escapeHtml(title)}</strong><br /><span>${escapeHtml(message)}</span></div></div>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

if ("serviceWorker" in navigator && !IS_FILE_MODE) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

bootApp();
