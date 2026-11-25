const puppeteer = require("puppeteer");

const DB_URL = process.env.FIREBASE_DB_URL || "https://chat-4e280-default-rtdb.firebaseio.com";
const DB_SECRET = process.env.FIREBASE_DB_SECRET || "";
const ENV_COOKIE = process.env.LAZI_COOKIE || "";
const ENV_ACCOUNT_ID = process.env.ACCOUNT_ID || "";

const BASE = "https://play.lazi.vn/rest/v1/rpc";
const AUTH_ENDPOINTS = [
  "https://play.lazi.vn/auth/v1/token?grant_type=refresh_token",
  "https://vvyohpqnvxxyxygscxsj.supabase.co/auth/v1/token?grant_type=refresh_token"
];
const APIKEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzk1MzIxNzY4LCJleHAiOjIxMTA2ODE3Njh9.TFy0zQvn7fXnwbaniwb4yvfBfdLp3SXD59pG6w9QQjg";

const MAX_HOURS = Math.max(0.1, Math.min(parseFloat(process.env.RUN_HOURS || "1"), 5));
const DELAY_MS = Math.max(500, parseInt(process.env.DELAY_MS || "1500", 10));
const RUN_NOTE = process.env.RUN_NOTE || "Treo câu cá tự động";
const RUN_ID = process.env.GITHUB_RUN_ID || `local-${Date.now()}`;
const END_TIME = Date.now() + MAX_HOURS * 3600 * 1000;

// =========================================================================
// BẢNG GIÁ CẦN CÂU & MỒI CÂU (CẤP 1 -> 6)
// =========================================================================
const ROD_PRICES = {
  1: { name: "Cần trúc (Cấp 1)", price: 0, free: true },
  2: { name: "Cần sợi thuỷ tinh (Cấp 2)", price: 500, free: false },
  3: { name: "Cần carbon (Cấp 3)", price: 1000, free: false },
  4: { name: "Cần hợp kim (Cấp 4)", price: 3000, free: false },
  5: { name: "Cần biển sâu (Cấp 5)", price: 7000, free: false },
  6: { name: "Cần huyền thoại (Cấp 6)", price: 10000, free: false }
};

const BAIT_BY_CODE = {
  giun: { code: "giun", tier: 1, name: "Giun đất (Cấp 1)", price: 0, packSize: null, free: true },
  cam: { code: "cam", tier: 2, name: "Mồi cám (Cấp 2)", price: 100, packSize: 20, free: false },
  tom: { code: "tom", tier: 3, name: "Tôm tươi (Cấp 3)", price: 200, packSize: 20, free: false },
  muc: { code: "muc", tier: 4, name: "Mực ống (Cấp 4)", price: 350, packSize: 20, free: false },
  ca_moi: { code: "ca_moi", tier: 5, name: "Cá mồi sống (Cấp 5)", price: 600, packSize: 20, free: false },
  ngoc: { code: "ngoc", tier: 6, name: "Ngọc trai mồi (Cấp 6)", price: 800, packSize: 10, free: false }
};

const BAIT_ALIAS_TO_CODE = {
  "giun": "giun", "giun_dat": "giun", "1": "giun", "bait:1": "giun",
  "cam": "cam", "moi_cam": "cam", "2": "cam", "bait:2": "cam",
  "tom": "tom", "tom_tuoi": "tom", "3": "tom", "bait:3": "tom",
  "muc": "muc", "muc_ong": "muc", "4": "muc", "bait:4": "muc",
  "ca_moi": "ca_moi", "ca_moi_song": "ca_moi", "5": "ca_moi", "bait:5": "ca_moi",
  "ngoc": "ngoc", "ngoc_trai": "ngoc", "ngoc_trai_moi": "ngoc", "6": "ngoc", "bait:6": "ngoc"
};

function parseRodTier(itemStr) {
  const s = String(itemStr || "").trim().toLowerCase();
  const m = s.match(/^(?:rod[:_]?|cap[:_]?|tier[:_]?)?([1-6])$/);
  return m ? parseInt(m[1], 10) : null;
}

function normalizeBaitCode(itemStr) {
  const s = String(itemStr || "").trim().toLowerCase();
  if (!s) return null;
  if (BAIT_ALIAS_TO_CODE[s]) return BAIT_ALIAS_TO_CODE[s];
  const m = s.match(/^(?:bait[:_]?|cap[:_]?|tier[:_]?)?([1-6])$/);
  if (m) {
    const mapByNum = { 1: "giun", 2: "cam", 3: "tom", 4: "muc", 5: "ca_moi", 6: "ngoc" };
    return mapByNum[parseInt(m[1], 10)] || null;
  }
  return s;
}

function resolvePurchaseTarget(itemStr, qty) {
  const safeQty = Math.max(1, Math.min(999, parseInt(qty, 10) || 1));
  const rodTier = parseRodTier(itemStr);
  if (rodTier) {
    const info = ROD_PRICES[rodTier];
    return {
      kind: "rod",
      tier: rodTier,
      itemCode: `rod:${rodTier}`,
      qty: safeQty,
      cost: info.free ? 0 : info.price * safeQty,
      free: info.free,
      label: info.name
    };
  }

  const baitCode = normalizeBaitCode(itemStr);
  if (baitCode && BAIT_BY_CODE[baitCode]) {
    const info = BAIT_BY_CODE[baitCode];
    return {
      kind: "bait",
      tier: info.tier,
      itemCode: info.code,
      qty: safeQty,
      cost: info.free ? 0 : info.price * safeQty,
      free: info.free,
      label: info.name
    };
  }

  return {
    kind: "unknown",
    tier: null,
    itemCode: String(itemStr).trim(),
    qty: safeQty,
    cost: null,
    free: false,
    label: String(itemStr).trim()
  };
}

const FISH_DICT = {
  ro_dong: "Cá rô đồng",
  diec: "Cá diếc",
  muong: "Cá mương",
  tre: "Cá trê",
  ro_phi: "Cá rô phi",
  bong: "Cá bống",
  sac: "Cá sặc",
  vang: "Cá vàng",
  chach: "Cá chạch",
  bay_mau: "Cá bảy màu",
  thia: "Cá xiêm",
  ro_hoang_kim: "Cá rô hoàng kim",
  tre_bach_tang: "Cá trê bạch tạng",
  chep: "Cá chép",
  tram_co: "Cá trắm cỏ",
  me_trang: "Cá mè trắng",
  loc: "Cá lóc",
  tra: "Cá tra",
  basa: "Cá ba sa",
  chim_trang: "Cá chim trắng",
  he_do: "Cá he đỏ",
  thac_lac: "Cá thát lát còm",
  koi: "Cá Koi",
  bong_tuong: "Cá bống tượng",
  chep_vu_mon: "Cá chép vượt Vũ Môn",
  tram_den: "Cá trắm đen",
  tai_tuong: "Cá tai tượng",
  lang: "Cá lăng",
  hoi: "Cá hồi",
  hoi_van: "Cá hồi vân",
  chien: "Cá chiên",
  chem: "Cá chẽm",
  chinh: "Cá chình",
  tam: "Cá tầm",
  ngan_long: "Cá ngân long",
  huyet_long: "Cá huyết long",
  ca_ho: "Cá hô khổng lồ",
  thu: "Cá thu",
  mu: "Cá mú",
  hong: "Cá hồng",
  bop: "Cá bớp",
  noc: "Cá nóc",
  vet: "Cá vẹt",
  nhong: "Cá nhồng",
  napoleon: "Cá Napoleon",
  duoi: "Cá đuối bồng",
  mu_nghe: "Cá mú nghệ",
  vua_ran_san_ho: "Vua rạn san hô",
  ngu_soc: "Cá ngừ sọc dưa",
  ngu_vay_vang: "Cá ngừ vây vàng",
  dorado: "Cá nục heo cờ",
  map_xanh: "Cá mập xanh",
  co: "Cá cờ",
  kiem: "Cá kiếm",
  map_bua: "Cá mập đầu búa",
  manta: "Cá đuối manta",
  mat_trang: "Cá mặt trăng",
  ngu_vay_xanh: "Cá ngừ vây xanh",
  marlin: "Cá cờ xanh",
  map_trang: "Cá mập trắng",
  long_den: "Cá lồng đèn",
  chinh_tui: "Cá chình túi",
  mai_cheo: "Cá mái chèo",
  vay_tay: "Cá vây tay",
  map_voi: "Cá mập voi",
  hac_long: "Hắc long vực thẳm",
  phuong_hoang: "Cá phượng hoàng",
  thuy_quai_bang: "Thuỷ quái băng giá",
  kim_long: "Kim long",
  ky_lan_bien: "Kỳ lân biển"
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ACTIVE_ACC = {
  id: "default",
  label: "Mặc định",
  uid: "",
  username: "",
  fullName: "",
  rawCookie: "",
  coins: null,
  // Theo dõi trạng thái cần hiện tại từ phản hồi fishing_land
  rodState: {
    id: null,
    tier: null,
    durability: null,
    broken: false
  },
  // Theo dõi số mồi còn lại từ phản hồi fishing_cast
  baitState: {
    tier: null,
    left: null
  }
};

// Ưu tiên state.coins (tổng ví thật), fallback sang coins ở root
function extractCoinsFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.state && typeof payload.state.coins === "number") return payload.state.coins;
  if (payload.data && payload.data.state && typeof payload.data.state.coins === "number") return payload.data.state.coins;
  if (typeof payload.coins === "number") return payload.coins;
  if (payload.data && typeof payload.data.coins === "number") return payload.data.coins;
  return null;
}

async function syncCoins(newCoins) {
  if (typeof newCoins !== "number" || Number.isNaN(newCoins)) return;
  ACTIVE_ACC.coins = newCoins;
  if (ACTIVE_ACC.id && ACTIVE_ACC.id !== "default") {
    await fbPatch(`worker_accounts/${ACTIVE_ACC.id}`, {
      coins: newCoins,
      coins_updated_at: Date.now()
    });
  }
}

// =========================================================================
// FIREBASE REALTIME DATABASE HELPERS
// =========================================================================
function dbEndpoint(path) {
  const clean = path.replace(/^\/+|\/+$/g, "");
  return DB_SECRET
    ? `${DB_URL}/${clean}.json?auth=${encodeURIComponent(DB_SECRET)}`
    : `${DB_URL}/${clean}.json`;
}

async function fbGet(path) {
  try {
    const res = await fetch(dbEndpoint(path));
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

async function fbPatch(path, data) {
  try {
    await fetch(dbEndpoint(path), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
  } catch (e) {
    console.error(`[FB_PATCH_ERR] ${path}:`, e.message);
  }
}

async function fbPost(path, data) {
  try {
    await fetch(dbEndpoint(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
  } catch (e) {
    console.error(`[FB_POST_ERR] ${path}:`, e.message);
  }
}

async function pushLog(level, msg, latency = null) {
  const prefix = ACTIVE_ACC.label ? `[${ACTIVE_ACC.label}] ` : "";
  const entry = {
    ts: Date.now(),
    level,
    msg: `${prefix}${msg}`,
    latency,
    run_id: RUN_ID,
    account_id: ACTIVE_ACC.id
  };
  const latStr = latency !== null ? ` (${latency}ms)` : "";
  console.log(`[${new Date().toISOString()}] [${level}] ${prefix}${msg}${latStr}`);
  await fbPost("worker_logs", entry);
}

async function pruneOldLogs(keep = 180) {
  try {
    const res = await fetch(`${dbEndpoint("worker_logs")}${DB_SECRET ? "&" : "?"}shallow=true`);
    if (!res.ok) return;
    const keys = Object.keys((await res.json()) || {}).sort();
    if (keys.length <= keep) return;
    const toDelete = keys.slice(0, keys.length - keep);
    const patchObj = {};
    for (const k of toDelete) patchObj[k] = null;
    await fbPatch("worker_logs", patchObj);
  } catch {}
}

// =========================================================================
// BỘ PHÂN TÍCH COOKIE ĐA ĐỊNH DẠNG (JSON ARRAY HOẶC HEADER STRING) & NHẬN DIỆN ACC
// =========================================================================
function parseSmartCookies(rawInput) {
  if (!rawInput) return [];

  let parsedArray = null;

  if (Array.isArray(rawInput)) {
    parsedArray = rawInput;
  } else if (typeof rawInput === "object" && Array.isArray(rawInput.cookies)) {
    parsedArray = rawInput.cookies;
  } else if (typeof rawInput === "string") {
    const trimmed = rawInput.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        const obj = JSON.parse(trimmed);
        if (Array.isArray(obj)) parsedArray = obj;
        else if (obj && Array.isArray(obj.cookies)) parsedArray = obj.cookies;
      } catch (e) {
        throw new Error(`Chuỗi JSON cookie bị lỗi cú pháp: ${e.message}`);
      }
    }
  }

  if (parsedArray) {
    const cookies = [];
    for (const item of parsedArray) {
      if (!item || !item.name) continue;
      const c = {
        name: String(item.name).trim(),
        value: item.value !== undefined && item.value !== null ? String(item.value) : "",
        domain: item.domain ? String(item.domain).trim() : ".lazi.vn",
        path: item.path ? String(item.path).trim() : "/",
        secure: Boolean(item.secure),
        httpOnly: Boolean(item.httpOnly)
      };

      if (item.sameSite) {
        const ss = String(item.sameSite).toLowerCase();
        if (ss === "no_restriction" || ss === "none") c.sameSite = "None";
        else if (ss === "lax") c.sameSite = "Lax";
        else if (ss === "strict") c.sameSite = "Strict";
      }

      if (typeof item.expirationDate === "number" && item.expirationDate > 0) {
        c.expires = Math.floor(item.expirationDate);
      }

      cookies.push(c);
    }
    return cookies;
  }

  const str = String(rawInput).replace(/^Cookie:\s*/i, "").trim();
  const cookies = [];
  for (const pair of str.split(";")) {
    const p = pair.trim();
    const eqIdx = p.indexOf("=");
    if (eqIdx <= 0) continue;
    cookies.push({
      name: p.slice(0, eqIdx).trim(),
      value: p.slice(eqIdx + 1).trim(),
      domain: ".lazi.vn",
      path: "/",
      secure: true
    });
  }
  return cookies;
}

function buildCookieHeader(rawInput) {
  const cookies = parseSmartCookies(rawInput);
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

function inspectAccountFromCookies(cookies) {
  const map = {};
  for (const c of cookies) {
    map[c.name] = c.value;
  }

  const uid = map.lazi_identity || map.lazi_identity_code || "";
  let username = "";
  let fullName = "";

  if (map.lazi_user_info) {
    try {
      const decoded = decodeURIComponent(map.lazi_user_info.replace(/\+/g, " "));
      const info = JSON.parse(decoded);
      username = info.username || "";
      fullName = info.full_name || "";
    } catch {}
  }

  const hasAuthKey = Boolean(map.lazi_remember_code || map.lazi_user_code || map.lazi_cms);
  return { uid, username, fullName, hasAuthKey };
}

async function resolveTargetAccount() {
  const ctrl = (await fbGet("worker_control")) || {};
  const targetId = (ENV_ACCOUNT_ID || ctrl.active_account || "").trim();

  if (targetId) {
    const acc = await fbGet(`worker_accounts/${targetId}`);
    if (acc && acc.cookie) {
      const cookies = parseSmartCookies(acc.cookie);
      const meta = inspectAccountFromCookies(cookies);
      const label = acc.name || meta.fullName || meta.username || meta.uid || targetId;

      ACTIVE_ACC = {
        id: targetId,
        label,
        uid: meta.uid || acc.uid || "",
        username: meta.username || acc.username || "",
        fullName: meta.fullName || acc.full_name || "",
        rawCookie: acc.cookie,
        coins: typeof acc.coins === "number" ? acc.coins : null,
        rodState: { id: null, tier: null, durability: null, broken: false },
        baitState: { tier: null, left: null }
      };

      await fbPatch(`worker_accounts/${targetId}`, {
        uid: ACTIVE_ACC.uid,
        username: ACTIVE_ACC.username,
        full_name: ACTIVE_ACC.fullName,
        last_used: Date.now()
      });

      return cookies;
    }
  }

  if (ENV_COOKIE && ENV_COOKIE.trim()) {
    const cookies = parseSmartCookies(ENV_COOKIE);
    const meta = inspectAccountFromCookies(cookies);
    const autoId = meta.uid ? `acc_${meta.uid}` : "default";
    const label = meta.fullName || meta.username || meta.uid || "Secret Mặc Định";

    ACTIVE_ACC = {
      id: autoId,
      label,
      uid: meta.uid,
      username: meta.username,
      fullName: meta.fullName,
      rawCookie: ENV_COOKIE,
      coins: null,
      rodState: { id: null, tier: null, durability: null, broken: false },
      baitState: { tier: null, left: null }
    };
    return cookies;
  }

  throw new Error("Không tìm thấy cookie nào (cả worker_accounts trên Firebase lẫn LAZI_COOKIE đều trống)!");
}

// =========================================================================
// PUPPETEER SSO EXTRACTOR
// =========================================================================
async function fetchTokensViaPuppeteer(preloadedCookies = null) {
  const cookies = preloadedCookies || (await resolveTargetAccount());
  if (!cookies.length) {
    throw new Error("Danh sách cookie sau khi phân tích bị rỗng (0 cookie hợp lệ)!");
  }

  const meta = inspectAccountFromCookies(cookies);
  if (!meta.hasAuthKey) {
    throw new Error("Bộ cookie thiếu khóa đăng nhập (lazi_remember_code / lazi_user_code). Hãy copy lại đủ cookie khi đã đăng nhập!");
  }

  const tStart = Date.now();
  await pushLog(
    "INFO",
    `[SSO 1/5] Khởi chạy Chromium | Nhận diện acc: ${meta.fullName || "?"} (@${meta.username || "?"} | ID: ${meta.uid || "?"}) — ${cookies.length} cookie`
  );

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1366,768"
    ]
  });

  try {
    const page = await browser.newPage();

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({
      "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"
    });

    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (["image", "font", "media"].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    let interceptedSession = null;
    page.on("response", async (res) => {
      try {
        const url = res.url();
        if (url.includes("token") || url.includes("auth") || url.includes("verify") || url.includes("otp")) {
          const ct = res.headers()["content-type"] || "";
          if (ct.includes("application/json")) {
            const json = await res.json().catch(() => null);
            const s = json?.session || json?.data?.session || json;
            if (s && s.access_token && s.refresh_token) {
              interceptedSession = {
                access_token: s.access_token,
                refresh_token: s.refresh_token,
                source: `Network (${url.split("?")[0]})`
              };
            }
          }
        }
      } catch {}
    });

    await page.setCookie(...cookies);
    await pushLog("INFO", `[SSO 2/5] Đã nạp ${cookies.length} cookie chuẩn định dạng vào trình duyệt.`);

    const resMain = await page.goto("https://lazi.vn/", {
      waitUntil: "domcontentloaded",
      timeout: 30000
    }).catch(() => null);
    await pushLog("INFO", `[SSO 3/5] Ping lazi.vn (HTTP ${resMain ? resMain.status() : "N/A"})`);

    const resLobby = await page.goto("https://play.lazi.vn/lobby", {
      waitUntil: "networkidle2",
      timeout: 45000
    });
    await pushLog(
      "INFO",
      `[SSO 4/5] Mở play.lazi.vn/lobby (HTTP ${resLobby ? resLobby.status() : "N/A"}) -> URL: ${page.url()}`
    );

    let session = null;
    for (let i = 1; i <= 20; i++) {
      if (interceptedSession) {
        session = interceptedSession;
        break;
      }

      session = await page.evaluate(() => {
        const stores = [
          { name: "localStorage", obj: window.localStorage },
          { name: "sessionStorage", obj: window.sessionStorage }
        ];
        for (const st of stores) {
          try {
            for (let j = 0; j < st.obj.length; j++) {
              const k = st.obj.key(j);
              const v = st.obj.getItem(k);
              if (k.includes("auth-token") || (v && v.includes("access_token"))) {
                const parsed = JSON.parse(v);
                const s = parsed.currentSession || parsed.session || parsed;
                if (s && s.access_token && s.refresh_token) {
                  return {
                    access_token: s.access_token,
                    refresh_token: s.refresh_token,
                    source: `${st.name} (${k})`
                  };
                }
              }
            }
          } catch {}
        }
        return null;
      });

      if (session) break;
      await sleep(1000);
    }

    if (!session) {
      const diag = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        lsKeys: Object.keys(localStorage)
      }));
      throw new Error(
        `Không bắt được token sau 20s (cookie có thể đã hết hạn) | URL=${diag.url} | Title="${diag.title}" | LS=${JSON.stringify(diag.lsKeys)}`
      );
    }

    await fbPatch(`worker_auth/${ACTIVE_ACC.id}`, {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: Date.now() + 3300 * 1000,
      updated_at: Date.now(),
      source: session.source,
      uid: ACTIVE_ACC.uid,
      username: ACTIVE_ACC.username
    });

    await pushLog(
      "INFO",
      `[SSO 5/5] Bắt thành công token từ ${session.source} | Refresh: ${session.refresh_token.slice(0, 6)}***`,
      Date.now() - tStart
    );

    return session.access_token;
  } finally {
    await browser.close();
  }
}

// =========================================================================
// QUẢN LÝ TOKEN RIÊNG TỪNG ACC
// =========================================================================
async function getValidToken(forceRefresh = false) {
  const authPath = `worker_auth/${ACTIVE_ACC.id}`;
  const authData = (await fbGet(authPath)) || {};

  if (
    !forceRefresh &&
    authData.access_token &&
    authData.expires_at &&
    Date.now() < authData.expires_at - 180000
  ) {
    return authData.access_token;
  }

  if (authData.refresh_token) {
    for (const url of AUTH_ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": APIKEY,
            "Origin": "https://play.lazi.vn",
            "Referer": "https://play.lazi.vn/lobby"
          },
          body: JSON.stringify({ refresh_token: authData.refresh_token })
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok && data.access_token && data.refresh_token) {
          await fbPatch(authPath, {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_at: Date.now() + (data.expires_in || 3600) * 1000,
            updated_at: Date.now(),
            source: "API Refresh"
          });
          await pushLog(
            "INFO",
            `Đã gia hạn nhanh token qua API (Refresh mới: ${data.refresh_token.slice(0, 6)}***).`
          );
          return data.access_token;
        }
      } catch {}
    }
    await pushLog("WARN", "Refresh token đã hết hiệu lực, bật Puppeteer lấy lại phiên từ cookie...");
  }

  return await fetchTokensViaPuppeteer();
}

// =========================================================================
// GỌI RPC GAME: FISHING_CAST, FISHING_LAND, FISHING_BUY, FISHING_SELL
// =========================================================================
async function rpc(name, body, token) {
  const t0 = Date.now();
  const cookieHeader = buildCookieHeader(ACTIVE_ACC.rawCookie);
  const headers = {
    "Content-Type": "application/json",
    "Content-Profile": "public",
    "apikey": APIKEY,
    "Authorization": `Bearer ${token}`,
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:153.0) Gecko/20100101 Firefox/153.0",
    "Referer": "https://play.lazi.vn/lobby",
    "Origin": "https://play.lazi.vn"
  };
  if (cookieHeader) headers["Cookie"] = cookieHeader;

  const res = await fetch(`${BASE}/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data, ms: Date.now() - t0 };
}

function normalizeAutomationConfig(rawCfg) {
  const cfg = rawCfg || {};
  const rawBait = String(cfg.bait_item || "ngoc").trim();
  return {
    auto_buy_rod: Boolean(cfg.auto_buy_rod),
    rod_item: String(cfg.rod_item || "rod:2").trim(),
    rod_qty: Math.max(1, Math.min(999, parseInt(cfg.rod_qty, 10) || 1)),
    rod_every: Math.max(0, parseInt(cfg.rod_every, 10) || 0),

    auto_buy_bait: Boolean(cfg.auto_buy_bait),
    bait_item: normalizeBaitCode(rawBait) || "ngoc",
    bait_qty: Math.max(1, Math.min(999, parseInt(cfg.bait_qty, 10) || 1)),
    bait_every: Math.max(0, parseInt(cfg.bait_every, 10) || 0),

    auto_sell: Boolean(cfg.auto_sell),
    sell_every: Math.max(1, parseInt(cfg.sell_every, 10) || 25),
    sell_fish: cfg.sell_fish && String(cfg.sell_fish).trim() !== "" ? String(cfg.sell_fish).trim() : null
  };
}

async function getAutomationConfig() {
  const ctrl = (await fbGet("worker_control")) || {};
  const perAcc = ctrl.automation?.[ACTIVE_ACC.id];
  const fallbackShop = ctrl.shop?.[ACTIVE_ACC.id];
  if (perAcc) return normalizeAutomationConfig(perAcc);
  if (fallbackShop) {
    return normalizeAutomationConfig({
      auto_buy_bait: Boolean(fallbackShop.buy_on_start || fallbackShop.auto_refill),
      bait_item: fallbackShop.item || "ngoc",
      bait_qty: fallbackShop.qty || 1
    });
  }
  return normalizeAutomationConfig({});
}

async function buyItem(item, qty, tag) {
  if (!item) return { ok: false, raw: "Thiếu mã vật phẩm" };
  const target = resolvePurchaseTarget(item, qty);

  if (target.free) {
    await pushLog("INFO", `[${tag}] ${target.label} (${target.itemCode}) có sẵn miễn phí, không cần mua.`);
    return { ok: true, free: true };
  }

  if (target.cost !== null && typeof ACTIVE_ACC.coins === "number") {
    if (ACTIVE_ACC.coins < target.cost) {
      await pushLog(
        "WARN",
        `[${tag}] Không đủ coin mua ${target.label} (${target.itemCode}) x${target.qty} (Cần ${target.cost.toLocaleString("vi-VN")} coin, ví đang có ${ACTIVE_ACC.coins.toLocaleString("vi-VN")} coin)`
      );
      return { ok: false, skipped: "insufficient_coins" };
    }
  }

  let token = await getValidToken(false);
  let res = await rpc("fishing_buy", { p_item: target.itemCode, p_qty: target.qty }, token);

  if (res.status === 401 || res.status === 403) {
    token = await getValidToken(true);
    res = await rpc("fishing_buy", { p_item: target.itemCode, p_qty: target.qty }, token);
  }

  const ok = res.status >= 200 && res.status < 300;
  const serverCoins = extractCoinsFromPayload(res.data);
  if (typeof serverCoins === "number") {
    await syncCoins(serverCoins);
  } else if (ok && target.cost !== null && typeof ACTIVE_ACC.coins === "number") {
    await syncCoins(Math.max(0, ACTIVE_ACC.coins - target.cost));
  }

  // Nếu vừa mua cần mới thành công thì reset trạng thái hỏng của cần để dùng cần mới
  if (ok && target.kind === "rod") {
    ACTIVE_ACC.rodState.broken = false;
    ACTIVE_ACC.rodState.durability = null;
  }

  const costTxt = target.cost !== null ? `${target.cost.toLocaleString("vi-VN")} coin` : "?";
  const coinTxt = typeof ACTIVE_ACC.coins === "number" ? ` | Ví: ${ACTIVE_ACC.coins.toLocaleString("vi-VN")} coin` : "";
  await pushLog(
    ok ? "SUCCESS" : "WARN",
    `[${tag}] Mua "${target.itemCode}" x${target.qty} (${costTxt})${coinTxt} -> HTTP ${res.status} (${JSON.stringify(res.data).slice(0, 140)})`,
    res.ms
  );
  return { ok, ...res };
}

async function sellFish(pFish, tag) {
  let token = await getValidToken(false);
  let res = await rpc("fishing_sell", { p_fish: pFish ?? null }, token);

  if (res.status === 401 || res.status === 403) {
    token = await getValidToken(true);
    res = await rpc("fishing_sell", { p_fish: pFish ?? null }, token);
  }

  const ok = res.status >= 200 && res.status < 300;
  const serverCoins = extractCoinsFromPayload(res.data);
  if (typeof serverCoins === "number") {
    await syncCoins(serverCoins);
  }

  const targetDesc = pFish ? `"${pFish}"` : "TẤT CẢ CÁ (null)";
  const coinInfo = typeof ACTIVE_ACC.coins === "number" ? ` | Ví: ${ACTIVE_ACC.coins.toLocaleString("vi-VN")} coin` : "";
  await pushLog(
    ok ? "SUCCESS" : "WARN",
    `[${tag}] Bán ${targetDesc}${coinInfo} -> HTTP ${res.status} (${JSON.stringify(res.data).slice(0, 140)})`,
    res.ms
  );
  return { ok, ...res };
}

// Kiểm tra độ bền cần: chỉ mua khi broken === true hoặc durability <= 0
async function checkAndBuyRodIfNeeded(cfg, tag) {
  if (!cfg.auto_buy_rod || !cfg.rod_item) return false;
  const target = resolvePurchaseTarget(cfg.rod_item, cfg.rod_qty);
  if (target.free) return false;

  const rs = ACTIVE_ACC.rodState;
  const rodExpiredOrBroken =
    rs.broken === true ||
    (typeof rs.durability === "number" && rs.durability <= 0);

  // Nếu đã biết cần đang còn độ bền (> 0) và chưa gãy thì KHÔNG mua thêm
  if (!rodExpiredOrBroken && typeof rs.durability === "number" && rs.durability > 0) {
    return false;
  }

  // Nếu chưa từng có thông tin độ bền (vừa khởi động) nhưng cần cấp mục tiêu khác tier cần hiện tại, hoặc cần hiện tại đã gãy/hết độ bền
  const shouldBuy =
    rodExpiredOrBroken ||
    (rs.durability === null && rs.tier !== null && target.tier && rs.tier < target.tier);

  if (!shouldBuy) return false;

  const r = await buyItem(cfg.rod_item, cfg.rod_qty, tag);
  return Boolean(r.ok);
}

// Kiểm tra số mồi còn lại từ bait_left của fishing_cast: chỉ mua khi bait_left <= 0
async function checkAndBuyBaitIfNeeded(cfg, tag) {
  if (!cfg.auto_buy_bait || !cfg.bait_item) return false;
  const target = resolvePurchaseTarget(cfg.bait_item, cfg.bait_qty);
  if (target.free) return false;

  const bs = ACTIVE_ACC.baitState;
  // Chỉ mua khi đã biết bait_left <= 0 (và nếu có bait_tier thì ưu tiên khớp cấp mồi đang chọn)
  const baitDepleted = typeof bs.left === "number" && bs.left <= 0;
  if (!baitDepleted) return false;

  const r = await buyItem(cfg.bait_item, cfg.bait_qty, tag);
  if (r.ok) {
    ACTIVE_ACC.baitState.left = null;
  }
  return Boolean(r.ok);
}

async function runPeriodicAutomation(cfg, cycleNum) {
  if (cfg.auto_buy_rod && cfg.rod_every > 0 && cycleNum % cfg.rod_every === 0) {
    await checkAndBuyRodIfNeeded(cfg, `AUTO-ROD #${cycleNum}`);
  }
  if (cfg.auto_buy_bait && cfg.bait_every > 0 && cycleNum % cfg.bait_every === 0) {
    await checkAndBuyBaitIfNeeded(cfg, `AUTO-BAIT #${cycleNum}`);
  }
  if (cfg.auto_sell && cycleNum % cfg.sell_every === 0) {
    await sellFish(cfg.sell_fish, `AUTO-SELL #${cycleNum}`);
  }
}

async function tryAutoRestockOnError(errText, cfg, cycleNum) {
  const lower = String(errText || "").toLowerCase();
  let restocked = false;

  const mentionsRod = /rod|cần|need_rod|no_rod|durability|broken/.test(lower);
  const mentionsBait = /bait|mồi|ngoc|cam|tom|muc|ca_moi|item|empty|hết|thiếu|not enough|insufficient|no_bait/.test(lower);

  if (cfg.auto_buy_rod && cfg.rod_item && mentionsRod) {
    ACTIVE_ACC.rodState.broken = true;
    ACTIVE_ACC.rodState.durability = 0;
    const bought = await checkAndBuyRodIfNeeded(cfg, `REFILL-ROD #${cycleNum}`);
    if (bought) restocked = true;
  }
  if (cfg.auto_buy_bait && cfg.bait_item && mentionsBait) {
    ACTIVE_ACC.baitState.left = 0;
    const bought = await checkAndBuyBaitIfNeeded(cfg, `REFILL-BAIT #${cycleNum}`);
    if (bought) restocked = true;
  }
  return restocked;
}

function getPreferredRodParam(cfg) {
  const target = resolvePurchaseTarget(cfg.rod_item, cfg.rod_qty);
  const rs = ACTIVE_ACC.rodState;
  if (
    target.kind === "rod" &&
    rs.id &&
    !rs.broken &&
    (rs.durability === null || rs.durability > 0) &&
    rs.tier === target.tier
  ) {
    return rs.id;
  }
  return null;
}

async function executeSingleCycle(cycleNum, cfg) {
  let token = await getValidToken(false);
  const tCycle = Date.now();

  // Nếu mồi đã hết (bait_left <= 0) từ lượt trước thì mua thêm trước khi thả câu
  await checkAndBuyBaitIfNeeded(cfg, `PRE-CAST-BAIT #${cycleNum}`);

  const pRod = getPreferredRodParam(cfg);
  let castRes = await rpc("fishing_cast", { p_rod: pRod }, token);

  if (castRes.status === 401 || castRes.status === 403) {
    await pushLog("WARN", `Vòng #${cycleNum}: Token bị từ chối (${castRes.status}), đang làm mới...`);
    token = await getValidToken(true);
    castRes = await rpc("fishing_cast", { p_rod: pRod }, token);
  }

  // Cập nhật bait_left & bait_tier ngay khi fishing_cast trả về
  if (castRes.status === 200 && castRes.data) {
    if (typeof castRes.data.bait_left === "number") {
      ACTIVE_ACC.baitState.left = castRes.data.bait_left;
    }
    if (typeof castRes.data.bait_tier === "number") {
      ACTIVE_ACC.baitState.tier = castRes.data.bait_tier;
    }
  }

  if (castRes.status !== 200 || !castRes.data?.cast) {
    const errPayload = JSON.stringify(castRes.data);
    const bought = await tryAutoRestockOnError(errPayload, cfg, cycleNum);
    if (bought) {
      await sleep(600);
      castRes = await rpc("fishing_cast", { p_rod: getPreferredRodParam(cfg) }, token);
      if (castRes.status === 200 && castRes.data && typeof castRes.data.bait_left === "number") {
        ACTIVE_ACC.baitState.left = castRes.data.bait_left;
      }
    }
    if (castRes.status !== 200 || !castRes.data?.cast) {
      return {
        ok: false,
        detail: `Vòng #${cycleNum} | Thả câu lỗi (HTTP ${castRes.status}): ${JSON.stringify(castRes.data)}`
      };
    }
  }

  const { cast, bite_ms = 2000, fight_ms = 1500, fish_tier, bait_left } = castRes.data;
  const waitTotal = bite_ms + fight_ms + 250;

  await sleep(waitTotal);

  const landRes = await rpc("fishing_land", { p_cast: cast, p_ok: true }, token);
  const totalLatency = Date.now() - tCycle;

  if (landRes.status !== 200 || !landRes.data) {
    await tryAutoRestockOnError(JSON.stringify(landRes.data), cfg, cycleNum);
    return {
      ok: false,
      detail: `Vòng #${cycleNum} | Kéo cá lỗi (HTTP ${landRes.status}): ${JSON.stringify(landRes.data)}`
    };
  }

  const d = landRes.data;

  // Cập nhật độ bền cần (durability / broken / id / tier) từ fishing_land
  if (d.rod && typeof d.rod === "object") {
    const durVal = typeof d.rod.durability === "number" ? d.rod.durability : null;
    const isBroken = Boolean(d.rod.broken) || (durVal !== null && durVal <= 0);
    ACTIVE_ACC.rodState = {
      id: d.rod.id || ACTIVE_ACC.rodState.id,
      tier: typeof d.rod.tier === "number" ? d.rod.tier : ACTIVE_ACC.rodState.tier,
      durability: durVal,
      broken: isBroken
    };

    if (isBroken) {
      await pushLog("WARN", `Vòng #${cycleNum} | Cần đã hết độ bền / gãy (durability=${durVal ?? 0})`);
      await checkAndBuyRodIfNeeded(cfg, `BROKEN-ROD #${cycleNum}`);
    }
  }

  // Nếu lượt này bait_left vừa chạm 0 thì mua thêm mồi cho vòng tiếp theo
  if (typeof bait_left === "number" && bait_left <= 0) {
    await checkAndBuyBaitIfNeeded(cfg, `EMPTY-BAIT #${cycleNum}`);
  }

  if (d.result !== "caught") {
    return {
      ok: false,
      detail: `Vòng #${cycleNum} | Cá sổng mất (result=${d.result || "unknown"}, tier=${fish_tier ?? "?"})`
    };
  }

  const fishId = String(d.fish_id || "").toLowerCase().trim();
  const fishName =
    FISH_DICT[fishId] ||
    (fishId ? `Cá ${fishId.replace(/_/g, " ")}` : `Cá Tier ${fish_tier ?? 1} (Hiếm ${d.rarity ?? 0})`);

  const newTag = d.new ? " [MỚI!]" : "";
  const durTxt = typeof ACTIVE_ACC.rodState.durability === "number" ? ` | Độ bền: ${ACTIVE_ACC.rodState.durability}` : "";
  const baitTxt = typeof bait_left === "number" ? ` | Mồi còn: ${bait_left}` : "";

  return {
    ok: true,
    item: fishName,
    value: Number(d.value || 0),
    points: Number(d.points || 0),
    latency: totalLatency,
    detail: `#${cycleNum}${newTag} | ${d.size ?? "?"}m - ${d.weight ?? "?"}kg | Túi: ${d.count ?? "?"} | Điểm tổng: ${d.score ?? "?"}${durTxt}${baitTxt} | Cast:${castRes.ms}ms + Chờ:${waitTotal}ms + Land:${landRes.ms}ms`
  };
}

// =========================================================================
// VÒNG LẶP CHÍNH
// =========================================================================
(async () => {
  let okCount = 0;
  let errCount = 0;
  let totalLatency = 0;

  let initialCookies = [];
  try {
    initialCookies = await resolveTargetAccount();
  } catch (err) {
    await pushLog("ERROR", `Không nạp được tài khoản: ${err.message}`);
    await fbPatch("worker_control", { status: "idle", last_heartbeat: Date.now() });
    return;
  }

  await fbPatch("worker_control", {
    status: "running",
    stop: false,
    paused: false,
    run_id: RUN_ID,
    note: RUN_NOTE,
    active_account: ACTIVE_ACC.id,
    active_account_name: ACTIVE_ACC.label,
    started_at: Date.now(),
    ends_at: END_TIME,
    last_heartbeat: Date.now(),
    ok_count: 0,
    err_count: 0,
    avg_latency: 0
  });

  const autoCfg = await getAutomationConfig();
  await pushLog(
    "INFO",
    `=== KHỞI ĐỘNG WORKER #${RUN_ID} (${MAX_HOURS}h, delay ${DELAY_MS}ms) | Acc: ${ACTIVE_ACC.fullName || ACTIVE_ACC.label} (UID: ${ACTIVE_ACC.uid || "N/A"}) | MuaCần:${autoCfg.auto_buy_rod ? autoCfg.rod_item : "OFF"} | MuaMồi:${autoCfg.auto_buy_bait ? autoCfg.bait_item : "OFF"} | TựBán:${autoCfg.auto_sell ? `mỗi ${autoCfg.sell_every} lượt` : "OFF"} ===`
  );

  try {
    await fetchTokensViaPuppeteer(initialCookies);
  } catch (err) {
    await pushLog("ERROR", `Dừng worker do lỗi khởi tạo phiên: ${err.message}`);
    await fbPatch("worker_control", { status: "idle", last_heartbeat: Date.now() });
    return;
  }

  let loopIndex = 0;
  while (Date.now() < END_TIME) {
    const ctrl = (await fbGet("worker_control")) || {};

    if (ctrl.stop === true) {
      await pushLog("WARN", "Nhận lệnh DỪNG KHẨN CẤP từ bảng điều khiển.");
      break;
    }

    if (ctrl.paused === true) {
      await fbPatch("worker_control", { status: "paused", last_heartbeat: Date.now() });
      await sleep(3000);
      continue;
    }

    const activeCfg = normalizeAutomationConfig(ctrl.automation?.[ACTIVE_ACC.id] || autoCfg);

    loopIndex++;
    try {
      const result = await executeSingleCycle(loopIndex, activeCfg);

      if (result.ok) {
        okCount++;
        totalLatency += result.latency || 0;
        const avgLat = Math.round(totalLatency / okCount);

        const safeKey = (result.item || "Khác").replace(/[.#$/\[\]]/g, "_");
        const itemPath = `worker_items/${ACTIVE_ACC.id}/${safeKey}`;
        const curItem = (await fbGet(itemPath)) || {
          name: result.item || "Khác",
          count: 0,
          total_value: 0,
          total_points: 0
        };

        await fbPatch(itemPath, {
          name: result.item || "Khác",
          count: curItem.count + 1,
          total_value: curItem.total_value + Number(result.value || 0),
          total_points: curItem.total_points + Number(result.points || 0),
          last_seen: Date.now()
        });

        await fbPatch("worker_control", {
          status: "running",
          last_heartbeat: Date.now(),
          ok_count: okCount,
          err_count: errCount,
          avg_latency: avgLat
        });

        await pushLog(
          "SUCCESS",
          `${result.item} (+${result.value} xu, +${result.points}đ) — ${result.detail}`,
          result.latency
        );

        await runPeriodicAutomation(activeCfg, okCount);
      } else {
        errCount++;
        await fbPatch("worker_control", {
          status: "running",
          last_heartbeat: Date.now(),
          err_count: errCount
        });
        await pushLog("WARN", result.detail || "Chu kỳ thất bại");
      }
    } catch (err) {
      errCount++;
      await fbPatch("worker_control", {
        status: "running",
        last_heartbeat: Date.now(),
        err_count: errCount
      });
      await pushLog("ERROR", `Vòng #${loopIndex} gặp ngoại lệ: ${err.message}`);
    }

    if (loopIndex % 25 === 0) {
      await pruneOldLogs(180);
    }

    await sleep(DELAY_MS);
  }

  if (autoCfg.auto_sell && okCount > 0) {
    await sellFish(autoCfg.sell_fish, "AUTO-SELL END");
  }

  await fbPatch("worker_control", {
    status: "idle",
    paused: false,
    last_heartbeat: Date.now()
  });
  await pushLog("INFO", `=== KẾT THÚC PHIÊN #${RUN_ID} | Dính cá: ${okCount} | Hụt/Lỗi: ${errCount} ===`);
})();
