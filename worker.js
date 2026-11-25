const puppeteer = require("puppeteer");

const DB_URL = process.env.FIREBASE_DB_URL || "https://chat-4e280-default-rtdb.firebaseio.com";
const DB_SECRET = process.env.FIREBASE_DB_SECRET || "";
const ENV_COOKIE = process.env.LAZI_COOKIE || "";
const ENV_ACCOUNT_ID = process.env.ACCOUNT_ID || "";

const BASE = "https://play.lazi.vn/rest/v1/rpc";
const REST_BASE = "https://play.lazi.vn/rest/v1";
const AUTH_ENDPOINTS = [
  "https://play.lazi.vn/auth/v1/token?grant_type=refresh_token",
  "https://vvyohpqnvxxyxygscxsj.supabase.co/auth/v1/token?grant_type=refresh_token"
];
const APIKEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzk1MzIxNzY4LCJleHAiOjIxMTA2ODE3Njh9.TFy0zQvn7fXnwbaniwb4yvfBfdLp3SXD59pG6w9QQjg";

const MAX_HOURS = Math.max(0.1, Math.min(parseFloat(process.env.RUN_HOURS || "1"), 5));
const DELAY_MS = Math.max(800, parseInt(process.env.DELAY_MS || "1500", 10));
const RUN_NOTE = process.env.RUN_NOTE || "Treo câu cá tự động";
const RUN_ID = process.env.GITHUB_RUN_ID || `local-${Date.now()}`;
const END_TIME = Date.now() + MAX_HOURS * 3600 * 1000;

// =========================================================================
// BẢNG GIÁ, CẤP & UUID MẶC ĐỊNH CỦA CẦN CÂU & MỒI CÂU (CẤP 1 -> 6)
// =========================================================================
const ROD_PRICES = {
  1: { name: "Cần trúc", price: 0, free: true },
  2: { name: "Cần sợi thuỷ tinh", price: 500, free: false },
  3: { name: "Cần carbon", price: 1000, free: false },
  4: { name: "Cần hợp kim", price: 3000, free: false },
  5: { name: "Cần biển sâu", price: 7000, free: false },
  6: { name: "Cần huyền thoại", price: 10000, free: false }
};

const SEED_RODS_BY_TIER = {
  "1": ["starter"],
  "2": ["a6add667-45ca-4d09-b4bc-d461009269dc"],
  "5": ["fd7f555e-691b-425a-9682-0e4d90b84df3"],
  "6": [
    "dd3c29be-f6e6-43b9-bf4b-1c2858a45f9f",
    "46db5ee0-c28f-4eb4-9386-bad8bbf04a72"
  ]
};

const KNOWN_ROD_META = {
  "starter": { name: "Cần trúc", tier: 1 },
  "a6add667-45ca-4d09-b4bc-d461009269dc": { name: "Cần sợi thuỷ tinh", tier: 2 },
  "fd7f555e-691b-425a-9682-0e4d90b84df3": { name: "Cần biển sâu", tier: 5 },
  "dd3c29be-f6e6-43b9-bf4b-1c2858a45f9f": { name: "Cần huyền thoại", tier: 6 },
  "46db5ee0-c28f-4eb4-9386-bad8bbf04a72": { name: "Cần huyền thoại", tier: 6 }
};

const BAIT_BY_CODE = {
  giun: { code: "giun", tier: 1, baitId: "1", name: "Giun đất", price: 0, packSize: null, free: true },
  cam: { code: "cam", tier: 2, baitId: "2", name: "Mồi cám", price: 100, packSize: 20, free: false },
  tom: { code: "tom", tier: 3, baitId: "3", name: "Tôm tươi", price: 200, packSize: 20, free: false },
  muc: { code: "muc", tier: 4, baitId: "4", name: "Mực ống", price: 350, packSize: 20, free: false },
  ca_moi: { code: "ca_moi", tier: 5, baitId: "5", name: "Cá mồi sống", price: 600, packSize: 20, free: false },
  ngoc: { code: "ngoc", tier: 6, baitId: "6", name: "Ngọc trai mồi", price: 800, packSize: 10, free: false }
};

const BAIT_BY_TIER = Object.fromEntries(
  Object.values(BAIT_BY_CODE).map((b) => [b.tier, b])
);

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
      label: `${info.name} (Cấp ${rodTier})`
    };
  }

  const baitCode = normalizeBaitCode(itemStr);
  if (baitCode && BAIT_BY_CODE[baitCode]) {
    const info = BAIT_BY_CODE[baitCode];
    return {
      kind: "bait",
      tier: info.tier,
      baitId: info.baitId,
      itemCode: info.code,
      qty: safeQty,
      cost: info.free ? 0 : info.price * safeQty,
      free: info.free,
      label: `${info.name} (Cấp ${info.tier})`
    };
  }

  return {
    kind: "unknown",
    tier: null,
    baitId: null,
    itemCode: String(itemStr).trim(),
    qty: safeQty,
    cost: null,
    free: false,
    label: String(itemStr).trim()
  };
}

function formatRodLabel(tier, uuid = null) {
  if (tier && ROD_PRICES[tier]) return `${ROD_PRICES[tier].name} (C${tier})`;
  if (uuid && KNOWN_ROD_META[uuid]) {
    const m = KNOWN_ROD_META[uuid];
    return `${m.name} (C${m.tier})`;
  }
  return uuid ? `Cần (${uuid.slice(0, 8)})` : "Cần trúc (C1)";
}

function formatBaitLabel(tier, fallbackCode = null) {
  if (tier && BAIT_BY_TIER[tier]) return `${BAIT_BY_TIER[tier].name} (C${tier})`;
  if (fallbackCode && BAIT_BY_CODE[fallbackCode]) {
    const b = BAIT_BY_CODE[fallbackCode];
    return `${b.name} (C${b.tier})`;
  }
  return tier ? `Mồi C${tier}` : "Mồi mặc định";
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

function buildSeedRodsPool(savedPool = {}) {
  const pool = {};
  for (const [tierKey, uuids] of Object.entries(SEED_RODS_BY_TIER)) {
    pool[tierKey] = Array.from(new Set(uuids));
  }
  if (savedPool && typeof savedPool === "object") {
    for (const [tierKey, list] of Object.entries(savedPool)) {
      if (Array.isArray(list)) {
        pool[tierKey] = Array.from(new Set([...(pool[tierKey] || []), ...list.filter(Boolean)]));
      } else if (typeof list === "string" && list) {
        pool[tierKey] = Array.from(new Set([...(pool[tierKey] || []), list]));
      }
    }
  }
  return pool;
}

const RECENT_PURCHASES = {};

let ACTIVE_ACC = {
  id: "default",
  label: "Mặc định",
  uid: "",
  username: "",
  fullName: "",
  rawCookie: "",
  coins: null,
  rodsPoolByTier: buildSeedRodsPool(),
  rodRegistry: {},
  rodState: {
    id: null,
    tier: null,
    durability: null,
    broken: false
  },
  baitLeftByTier: {},
  baitState: {
    tier: null,
    left: null
  }
};

function isRodUsable(uuid) {
  if (!uuid) return false;
  if (uuid === "starter") return true;
  const reg = ACTIVE_ACC.rodRegistry[uuid];
  if (!reg) return true;
  if (reg.broken) return false;
  if (typeof reg.durability === "number" && reg.durability <= 0) return false;
  return true;
}

function markRodBroken(uuid, tier = null) {
  if (!uuid || uuid === "starter") return;
  const effTier = typeof tier === "number"
    ? tier
    : (ACTIVE_ACC.rodRegistry[uuid]?.tier ?? KNOWN_ROD_META[uuid]?.tier ?? null);

  ACTIVE_ACC.rodRegistry[uuid] = {
    uuid,
    tier: effTier,
    durability: 0,
    broken: true
  };

  if (effTier) {
    const tKey = String(effTier);
    const list = ACTIVE_ACC.rodsPoolByTier[tKey] || [];
    ACTIVE_ACC.rodsPoolByTier[tKey] = list.filter((id) => id !== uuid);
  }

  if (ACTIVE_ACC.rodState.id === uuid) {
    ACTIVE_ACC.rodState.durability = 0;
    ACTIVE_ACC.rodState.broken = true;
  }
}

function recordRodInfo(uuid, tier = null, durability = null, broken = null) {
  if (!uuid) return;
  const effTier = typeof tier === "number" ? tier : (KNOWN_ROD_META[uuid]?.tier ?? null);
  const prev = ACTIVE_ACC.rodRegistry[uuid] || {};
  const nextDur = typeof durability === "number" ? durability : (prev.durability ?? null);
  const nextBroken = typeof broken === "boolean"
    ? broken
    : (Boolean(prev.broken) || (typeof nextDur === "number" && nextDur <= 0));

  ACTIVE_ACC.rodRegistry[uuid] = {
    uuid,
    tier: effTier ?? prev.tier ?? null,
    durability: nextBroken ? 0 : nextDur,
    broken: nextBroken
  };

  if (effTier) {
    const tKey = String(effTier);
    const arr = ACTIVE_ACC.rodsPoolByTier[tKey] || [];
    if (nextBroken) {
      ACTIVE_ACC.rodsPoolByTier[tKey] = arr.filter((id) => id !== uuid);
    } else if (!arr.includes(uuid)) {
      ACTIVE_ACC.rodsPoolByTier[tKey] = [...arr, uuid];
    }
  }
}

// Đồng bộ toàn bộ mảng rods & rod từ phản hồi server
function syncRodsFromPayload(payload, preferredTier = null) {
  if (!payload || typeof payload !== "object") return null;

  const root = Array.isArray(payload) ? (payload[0] || {}) : payload;
  const rodsList =
    (Array.isArray(root.rods) && root.rods) ||
    (Array.isArray(root.state?.rods) && root.state.rods) ||
    (Array.isArray(root.data?.rods) && root.data.rods) ||
    (Array.isArray(root.data?.state?.rods) && root.data.state.rods) ||
    null;

  let chosenRod = null;

  if (rodsList) {
    const rebuiltPool = { "1": ["starter"] };
    const seenAliveIds = new Set(["starter"]);

    for (const r of rodsList) {
      if (!r || typeof r !== "object" || !r.id) continue;
      const rId = String(r.id);
      const rTier = typeof r.tier === "number" ? r.tier : (KNOWN_ROD_META[rId]?.tier ?? null);
      const rDur = typeof r.durability === "number" ? r.durability : null;
      const rBroken = Boolean(r.broken) || (typeof rDur === "number" && rDur <= 0);

      recordRodInfo(rId, rTier, rDur, rBroken);

      if (!rBroken) {
        seenAliveIds.add(rId);
        if (rTier) {
          const tKey = String(rTier);
          if (!rebuiltPool[tKey]) rebuiltPool[tKey] = [];
          if (!rebuiltPool[tKey].includes(rId)) rebuiltPool[tKey].push(rId);
        }

        if (preferredTier && rTier === preferredTier) {
          if (!chosenRod || (rDur ?? 100) > (chosenRod.durability ?? 0)) {
            chosenRod = { id: rId, tier: rTier, durability: rDur ?? 100, broken: false };
          }
        }
      }
    }

    for (const [tKey, list] of Object.entries(ACTIVE_ACC.rodsPoolByTier)) {
      if (tKey === "1") continue;
      const kept = (list || []).filter((id) => seenAliveIds.has(id));
      ACTIVE_ACC.rodsPoolByTier[tKey] = rebuiltPool[tKey]
        ? Array.from(new Set([...rebuiltPool[tKey], ...kept]))
        : kept;
    }
    for (const [tKey, list] of Object.entries(rebuiltPool)) {
      ACTIVE_ACC.rodsPoolByTier[tKey] = list;
    }
  }

  const single =
    root.rod ||
    root.state?.rod ||
    root.data?.rod ||
    root.data?.state?.rod ||
    null;

  if (single && typeof single === "object" && single.id) {
    const sId = String(single.id);
    const sTier = typeof single.tier === "number" ? single.tier : (KNOWN_ROD_META[sId]?.tier ?? null);
    const sDur = typeof single.durability === "number" ? single.durability : null;
    const sBroken = Boolean(single.broken) || (typeof sDur === "number" && sDur <= 0);
    recordRodInfo(sId, sTier, sDur, sBroken);
    if (!chosenRod && (!preferredTier || sTier === preferredTier) && !sBroken) {
      chosenRod = { id: sId, tier: sTier, durability: sDur ?? 100, broken: false };
    }
  }

  if (chosenRod) {
    ACTIVE_ACC.rodState = {
      id: chosenRod.id,
      tier: chosenRod.tier,
      durability: chosenRod.durability,
      broken: false
    };
  }

  return chosenRod;
}

function getUsableRodsInTier(tier) {
  if (!tier) return [];
  if (tier === 1) return ["starter"];
  const pool = ACTIVE_ACC.rodsPoolByTier[String(tier)] || [];
  return pool.filter((uuid) => isRodUsable(uuid));
}

function getSelectedRodUuid(cfg) {
  const target = resolvePurchaseTarget(cfg.rod_item, cfg.rod_qty);
  const desiredTier = target.kind === "rod" ? target.tier : ACTIVE_ACC.rodState.tier;
  if (!desiredTier) return isRodUsable(ACTIVE_ACC.rodState.id) ? ACTIVE_ACC.rodState.id : null;

  if (desiredTier === 1) return "starter";

  if (
    ACTIVE_ACC.rodState.id &&
    ACTIVE_ACC.rodState.tier === desiredTier &&
    isRodUsable(ACTIVE_ACC.rodState.id)
  ) {
    return ACTIVE_ACC.rodState.id;
  }

  const usableList = getUsableRodsInTier(desiredTier);
  return usableList.length > 0 ? usableList[0] : null;
}

// Chuyển sang cây cần dự phòng cùng cấp nếu còn trong kho, trả về true nếu đã tìm thấy cây dùng được
async function switchToAvailableRodInTier(cfg, tag = null) {
  const target = resolvePurchaseTarget(cfg.rod_item, cfg.rod_qty);
  if (target.kind !== "rod") return false;
  if (target.tier === 1) {
    ACTIVE_ACC.rodState = { id: "starter", tier: 1, durability: null, broken: false };
    return true;
  }

  const usableList = getUsableRodsInTier(target.tier);
  if (usableList.length === 0) return false;

  const pickedUuid = usableList[0];
  const prevId = ACTIVE_ACC.rodState.id;
  const reg = ACTIVE_ACC.rodRegistry[pickedUuid] || {};

  ACTIVE_ACC.rodState = {
    id: pickedUuid,
    tier: target.tier,
    durability: typeof reg.durability === "number" ? reg.durability : null,
    broken: false
  };

  if (prevId !== pickedUuid) {
    await syncGearTelemetry();
    if (tag) {
      const durTxt = typeof ACTIVE_ACC.rodState.durability === "number"
        ? `${ACTIVE_ACC.rodState.durability}%`
        : "sẵn sàng";
      await pushLog(
        "INFO",
        `[${tag}] Đã chuyển sang cần dự phòng trong kho: ${formatRodLabel(target.tier, pickedUuid)} [UUID: ${pickedUuid.slice(0, 8)}... | Độ bền: ${durTxt} | Còn ${usableList.length} cây cấp ${target.tier}]`
      );
    }
  }

  return true;
}

function getSelectedRodStatus(cfg) {
  const uuid = getSelectedRodUuid(cfg);
  const target = resolvePurchaseTarget(cfg.rod_item, cfg.rod_qty);
  const desiredTier = target.kind === "rod" ? target.tier : ACTIVE_ACC.rodState.tier;
  const reg = uuid ? ACTIVE_ACC.rodRegistry[uuid] : null;
  const isCurrent = uuid && ACTIVE_ACC.rodState.id === uuid;

  const durability = isCurrent && typeof ACTIVE_ACC.rodState.durability === "number"
    ? ACTIVE_ACC.rodState.durability
    : (typeof reg?.durability === "number" ? reg.durability : null);

  const broken = desiredTier === 1
    ? false
    : Boolean(
        !uuid ||
        (isCurrent && ACTIVE_ACC.rodState.broken) ||
        reg?.broken ||
        (typeof durability === "number" && durability <= 0)
      );

  const usableList = desiredTier ? getUsableRodsInTier(desiredTier) : [];

  return {
    uuid,
    tier: desiredTier,
    durability,
    broken,
    usableCount: usableList.length,
    hasAnyUsableInTier: desiredTier === 1 || usableList.length > 0
  };
}

function getSelectedBaitStatus(cfg) {
  const target = resolvePurchaseTarget(cfg.bait_item, cfg.bait_qty);
  const desiredTier = target.kind === "bait" ? target.tier : ACTIVE_ACC.baitState.tier;
  if (!desiredTier) {
    return { tier: null, left: ACTIVE_ACC.baitState.left, code: null };
  }
  const info = BAIT_BY_TIER[desiredTier];
  if (desiredTier === 1 || info?.free) {
    return { tier: 1, left: null, code: "giun", free: true };
  }
  const left = typeof ACTIVE_ACC.baitLeftByTier[String(desiredTier)] === "number"
    ? ACTIVE_ACC.baitLeftByTier[String(desiredTier)]
    : (ACTIVE_ACC.baitState.tier === desiredTier ? ACTIVE_ACC.baitState.left : null);

  return {
    tier: desiredTier,
    left,
    code: info?.code || null,
    free: false
  };
}

function extractCoinsFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const root = Array.isArray(payload) ? (payload[0] || {}) : payload;
  if (root.state && typeof root.state.coins === "number") return root.state.coins;
  if (root.data && root.data.state && typeof root.data.state.coins === "number") return root.data.state.coins;
  if (typeof root.coins === "number") return root.coins;
  if (root.data && typeof root.data.coins === "number") return root.data.coins;
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

async function syncGearTelemetry() {
  if (!ACTIVE_ACC.id || ACTIVE_ACC.id === "default") return;
  const rs = ACTIVE_ACC.rodState;
  const bs = ACTIVE_ACC.baitState;
  await fbPatch(`worker_accounts/${ACTIVE_ACC.id}`, {
    active_rod_id: rs.id || null,
    active_rod_tier: rs.tier ?? null,
    active_rod_name: formatRodLabel(rs.tier, rs.id),
    active_rod_durability: rs.durability ?? null,
    active_rod_broken: Boolean(rs.broken),
    rods_pool_by_tier: ACTIVE_ACC.rodsPoolByTier,
    rod_registry: ACTIVE_ACC.rodRegistry,
    bait_left_by_tier: ACTIVE_ACC.baitLeftByTier,
    active_bait_tier: bs.tier ?? null,
    active_bait_name: formatBaitLabel(bs.tier),
    active_bait_left: bs.left ?? null,
    gear_updated_at: Date.now()
  });
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
        rodsPoolByTier: buildSeedRodsPool(acc.rods_pool_by_tier || acc.rods_by_tier),
        rodRegistry: acc.rod_registry && typeof acc.rod_registry === "object" ? { ...acc.rod_registry } : {},
        rodState: {
          id: acc.active_rod_id || null,
          tier: typeof acc.active_rod_tier === "number" ? acc.active_rod_tier : null,
          durability: typeof acc.active_rod_durability === "number" ? acc.active_rod_durability : null,
          broken: Boolean(acc.active_rod_broken)
        },
        baitLeftByTier: acc.bait_left_by_tier && typeof acc.bait_left_by_tier === "object" ? { ...acc.bait_left_by_tier } : {},
        baitState: {
          tier: typeof acc.active_bait_tier === "number" ? acc.active_bait_tier : null,
          left: typeof acc.active_bait_left === "number" ? acc.active_bait_left : null
        }
      };

      // Dọn sẵn các UUID đã gãy trong pool nếu có
      for (const [uuid, reg] of Object.entries(ACTIVE_ACC.rodRegistry)) {
        if (reg && (reg.broken || (typeof reg.durability === "number" && reg.durability <= 0))) {
          markRodBroken(uuid, reg.tier);
        }
      }

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
      rodsPoolByTier: buildSeedRodsPool(),
      rodRegistry: {},
      rodState: { id: null, tier: null, durability: null, broken: false },
      baitLeftByTier: {},
      baitState: { tier: null, left: null }
    };
    return cookies;
  }

  throw new Error("Không tìm thấy cookie nào (cả worker_accounts trên Firebase lẫn LAZI_COOKIE đều trống)!");
}

// =========================================================================
// PUPPETEER SSO EXTRACTOR + ĐỌC/ĐỒNG BỘ CẦN & MỒI TRONG LOCALSTORAGE
// =========================================================================
async function fetchTokensViaPuppeteer(preloadedCookies = null, desiredCfg = null) {
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

    const baitTarget = desiredCfg ? resolvePurchaseTarget(desiredCfg.bait_item, desiredCfg.bait_qty) : null;
    const rodTarget = desiredCfg ? resolvePurchaseTarget(desiredCfg.rod_item, desiredCfg.rod_qty) : null;
    const desiredBaitId = baitTarget?.kind === "bait" && baitTarget.baitId ? baitTarget.baitId : null;
    const desiredRodUuid = rodTarget?.kind === "rod" ? getSelectedRodUuid(desiredCfg) : null;

    const fishingLocal = await page.evaluate(({ targetBaitId, targetRodUuid }) => {
      try {
        if (targetBaitId) {
          window.localStorage.setItem("blockstage.fishing.bait", String(targetBaitId));
        }
        if (targetRodUuid) {
          window.localStorage.setItem("blockstage.fishing.rod", String(targetRodUuid));
        }
        return {
          rodId: window.localStorage.getItem("blockstage.fishing.rod") || null,
          baitId: window.localStorage.getItem("blockstage.fishing.bait") || null
        };
      } catch {
        return { rodId: null, baitId: null };
      }
    }, { targetBaitId: desiredBaitId, targetRodUuid: desiredRodUuid });

    if (fishingLocal.rodId && isRodUsable(fishingLocal.rodId)) {
      recordRodInfo(fishingLocal.rodId);
      if (!ACTIVE_ACC.rodState.id) {
        ACTIVE_ACC.rodState.id = fishingLocal.rodId;
        ACTIVE_ACC.rodState.tier = KNOWN_ROD_META[fishingLocal.rodId]?.tier ?? null;
      }
    }
    if (fishingLocal.baitId && /^\d+$/.test(fishingLocal.baitId)) {
      const parsedBait = parseInt(fishingLocal.baitId, 10);
      if (!ACTIVE_ACC.baitState.tier) {
        ACTIVE_ACC.baitState.tier = parsedBait;
      }
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

    await syncGearTelemetry();

    await pushLog(
      "INFO",
      `[SSO 5/5] Bắt thành công token từ ${session.source} | Cần:${formatRodLabel(ACTIVE_ACC.rodState.tier, fishingLocal.rodId)} | Mồi:${formatBaitLabel(ACTIVE_ACC.baitState.tier)}`,
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
// GỌI RPC GAME & ĐỒNG BỘ KHO CẦN TRÊN SERVER TRƯỚC KHI MUA
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

// Dò kho cần thật trên server (phòng trường hợp đã mua thừa hoặc mua tay trên web)
async function syncServerInventoryBeforeBuy(token, preferredTier) {
  const cookieHeader = buildCookieHeader(ACTIVE_ACC.rawCookie);
  const baseHeaders = {
    "Accept": "application/json",
    "apikey": APIKEY,
    "Authorization": `Bearer ${token}`,
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:153.0) Gecko/20100101 Firefox/153.0",
    "Referer": "https://play.lazi.vn/lobby",
    "Origin": "https://play.lazi.vn"
  };
  if (cookieHeader) baseHeaders["Cookie"] = cookieHeader;

  // 1. Thử các RPC đọc state phổ biến
  for (const fn of ["fishing_state", "fishing_get", "get_fishing_state"]) {
    try {
      const r = await rpc(fn, {}, token);
      if (r.status === 200 && r.data) {
        const picked = syncRodsFromPayload(r.data, preferredTier);
        const c = extractCoinsFromPayload(r.data);
        if (typeof c === "number") await syncCoins(c);
        await syncGearTelemetry();
        if (picked || getUsableRodsInTier(preferredTier).length > 0) return true;
      }
    } catch {}
  }

  // 2. Thử đọc trực tiếp từ các bảng Supabase REST (RLS chỉ trả về dòng của acc hiện tại)
  for (const tbl of ["fishing_states", "fishing_players", "fishing_profiles"]) {
    try {
      const res = await fetch(`${REST_BASE}/${tbl}?select=*&limit=1`, { headers: baseHeaders });
      if (res.ok) {
        const json = await res.json().catch(() => null);
        if (json) {
          const picked = syncRodsFromPayload(json, preferredTier);
          const c = extractCoinsFromPayload(json);
          if (typeof c === "number") await syncCoins(c);
          await syncGearTelemetry();
          if (picked || getUsableRodsInTier(preferredTier).length > 0) return true;
        }
      }
    } catch {}
  }

  return false;
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

  // Khóa chống mua trùng liên tiếp trong 5 giây
  const lockKey = `${target.kind}:${target.itemCode}`;
  if (RECENT_PURCHASES[lockKey] && Date.now() - RECENT_PURCHASES[lockKey] < 5000) {
    return { ok: true, skipped: "cooldown" };
  }

  if (target.cost !== null && typeof ACTIVE_ACC.coins === "number") {
    if (ACTIVE_ACC.coins < target.cost) {
      await pushLog(
        "WARN",
        `[${tag}] Không đủ coin mua ${target.label} x${target.qty} (Cần ${target.cost.toLocaleString("vi-VN")} coin, ví còn ${ACTIVE_ACC.coins.toLocaleString("vi-VN")} coin) — bỏ qua mua.`
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
  if (ok) {
    RECENT_PURCHASES[lockKey] = Date.now();
  }

  const serverCoins = extractCoinsFromPayload(res.data);
  if (typeof serverCoins === "number") {
    await syncCoins(serverCoins);
  } else if (ok && target.cost !== null && typeof ACTIVE_ACC.coins === "number") {
    await syncCoins(Math.max(0, ACTIVE_ACC.coins - target.cost));
  }

  let syncedNewUuid = null;
  if (ok && target.kind === "rod") {
    const picked = syncRodsFromPayload(res.data, target.tier);
    if (picked && picked.id) {
      syncedNewUuid = picked.id;
    } else {
      ACTIVE_ACC.rodState = {
        id: null,
        tier: target.tier,
        durability: 100,
        broken: false
      };
    }
    await syncGearTelemetry();
  }

  if (ok && target.kind === "bait") {
    if (target.tier) {
      ACTIVE_ACC.baitState.tier = target.tier;
      ACTIVE_ACC.baitState.left = null;
      delete ACTIVE_ACC.baitLeftByTier[String(target.tier)];
    }
    await syncGearTelemetry();
  }

  const costTxt = target.cost !== null ? `${target.cost.toLocaleString("vi-VN")} coin` : "?";
  const coinTxt = typeof ACTIVE_ACC.coins === "number" ? ` | Ví: ${ACTIVE_ACC.coins.toLocaleString("vi-VN")} coin` : "";
  const uuidTxt = syncedNewUuid ? ` | UUID mới: ${syncedNewUuid.slice(0, 8)}...` : "";
  await pushLog(
    ok ? "SUCCESS" : "WARN",
    `[${tag}] Mua "${target.itemCode}" x${target.qty} (${costTxt})${coinTxt}${uuidTxt} -> HTTP ${res.status}`,
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
  syncRodsFromPayload(res.data);

  const targetDesc = pFish ? `"${pFish}"` : "TẤT CẢ CÁ (null)";
  const coinInfo = typeof ACTIVE_ACC.coins === "number" ? ` | Ví: ${ACTIVE_ACC.coins.toLocaleString("vi-VN")} coin` : "";
  await pushLog(
    ok ? "SUCCESS" : "WARN",
    `[${tag}] Bán ${targetDesc}${coinInfo} -> HTTP ${res.status} (${JSON.stringify(res.data).slice(0, 140)})`,
    res.ms
  );
  return { ok, ...res };
}

// Kiểm tra 3 lớp khi cần hết độ bền / chưa có cần cầm:
// 1) Tìm trong pool UUID đã lưu -> nếu còn thì đổi sang cầm luôn (không mua)
// 2) Quét kho trên server -> nếu có cây mua thừa/mua tay chưa đồng bộ thì lấy ra dùng luôn (không mua)
// 3) Chỉ khi hết sạch cả 2 nơi và bật auto_buy_rod mới bấm mua
async function ensureUsableRodOrBuy(cfg, tag) {
  if (!cfg.rod_item) return false;
  const target = resolvePurchaseTarget(cfg.rod_item, cfg.rod_qty);
  if (target.kind !== "rod" || target.free) return true;

  // Lớp 1: Kiểm tra kho UUID đã lưu trong bot / Firebase
  const switchedLocal = await switchToAvailableRodInTier(cfg, tag);
  if (switchedLocal) {
    return true;
  }

  // Lớp 2: Kiểm tra lại kho thật trên server (tránh mua trùng khi đã mua thừa từ trước)
  const token = await getValidToken(false);
  const foundOnServer = await syncServerInventoryBeforeBuy(token, target.tier);
  if (foundOnServer) {
    const switchedServer = await switchToAvailableRodInTier(cfg, `${tag}-SYNC`);
    if (switchedServer) {
      await pushLog(
        "INFO",
        `[${tag}] Quét kho server thấy còn ${getUsableRodsInTier(target.tier).length} cây ${target.label} (mua thừa trước đó), lấy ra dùng luôn — bỏ qua mua mới!`
      );
      return true;
    }
  }

  // Lớp 3: Xác nhận hết sạch cần cấp này -> chỉ mua nếu bật auto_buy_rod
  if (!cfg.auto_buy_rod) {
    return false;
  }

  const r = await buyItem(cfg.rod_item, cfg.rod_qty, tag);
  if (r.ok) {
    await switchToAvailableRodInTier(cfg, null);
    return true;
  }
  return false;
}

async function checkAndBuyBaitIfNeeded(cfg, tag) {
  if (!cfg.auto_buy_bait || !cfg.bait_item) return false;
  const target = resolvePurchaseTarget(cfg.bait_item, cfg.bait_qty);
  if (target.kind !== "bait" || target.free) return false;

  const selBait = getSelectedBaitStatus(cfg);
  if (typeof selBait.left !== "number" || selBait.left > 0) return false;

  const r = await buyItem(cfg.bait_item, cfg.bait_qty, tag);
  return Boolean(r.ok);
}

async function runPeriodicAutomation(cfg, cycleNum) {
  if (cfg.auto_buy_rod && cfg.rod_every > 0 && cycleNum % cfg.rod_every === 0) {
    await ensureUsableRodOrBuy(cfg, `AUTO-ROD #${cycleNum}`);
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

  if (cfg.rod_item && mentionsRod) {
    const sel = getSelectedRodStatus(cfg);
    if (sel.uuid) {
      markRodBroken(sel.uuid, sel.tier);
    }
    const ready = await ensureUsableRodOrBuy(cfg, `REFILL-ROD #${cycleNum}`);
    if (ready) restocked = true;
  }
  if (cfg.auto_buy_bait && cfg.bait_item && mentionsBait) {
    const selBait = getSelectedBaitStatus(cfg);
    if (selBait.tier) {
      ACTIVE_ACC.baitLeftByTier[String(selBait.tier)] = 0;
    }
    ACTIVE_ACC.baitState.left = 0;
    const bought = await checkAndBuyBaitIfNeeded(cfg, `REFILL-BAIT #${cycleNum}`);
    if (bought) restocked = true;
  }
  return restocked;
}

function buildGearStatusText(cfg, fallbackBaitLeft = null, fallbackBaitTier = null, usedRodUuid = undefined) {
  const targetRod = resolvePurchaseTarget(cfg.rod_item, cfg.rod_qty);
  const fellBackToStarter = usedRodUuid === null && targetRod.kind === "rod" && targetRod.tier > 1;

  let rodName;
  let durStr;

  if (fellBackToStarter) {
    rodName = `Cần trúc (C1) [Hết C${targetRod.tier}]`;
    durStr = "∞";
  } else {
    const selRod = getSelectedRodStatus(cfg);
    rodName = formatRodLabel(selRod.tier, selRod.uuid);
    const spareNote = selRod.tier > 1 && selRod.usableCount > 1 ? ` · Dự phòng: ${selRod.usableCount - 1}` : "";
    durStr = selRod.tier === 1
      ? "∞"
      : (typeof selRod.durability === "number"
          ? `${selRod.durability}%${selRod.broken ? " [HẾT/GÃY]" : ""}${spareNote}`
          : (selRod.broken ? "HẾT/GÃY" : `?%${spareNote}`));
  }

  const selBait = getSelectedBaitStatus(cfg);
  const effBaitTier = selBait.tier ?? fallbackBaitTier ?? ACTIVE_ACC.baitState.tier;
  const effBaitLeft = typeof selBait.left === "number"
    ? selBait.left
    : (typeof fallbackBaitLeft === "number" ? fallbackBaitLeft : ACTIVE_ACC.baitState.left);

  const baitName = formatBaitLabel(effBaitTier, cfg.bait_item);
  const baitLeftStr = effBaitTier === 1
    ? "∞"
    : (typeof effBaitLeft === "number" ? `${effBaitLeft}` : "?");

  return `Cần: ${rodName} [Độ bền: ${durStr}] | Mồi: ${baitName} [Còn: ${baitLeftStr}]`;
}

async function executeSingleCycle(cycleNum, cfg) {
  let token = await getValidToken(false);
  const tCycle = Date.now();

  // Trước khi thả câu: luôn đảm bảo đang cầm cây dự phòng còn dùng được (hoặc mua nếu hết sạch)
  await ensureUsableRodOrBuy(cfg, `CHECK-ROD #${cycleNum}`);
  await checkAndBuyBaitIfNeeded(cfg, `PRE-CAST-BAIT #${cycleNum}`);

  let pRod = getSelectedRodUuid(cfg);
  let castRes = await rpc("fishing_cast", { p_rod: pRod }, token);

  if (castRes.status === 401 || castRes.status === 403) {
    await pushLog("WARN", `Vòng #${cycleNum}: Token bị từ chối (${castRes.status}), đang làm mới...`);
    token = await getValidToken(true);
    castRes = await rpc("fishing_cast", { p_rod: pRod }, token);
  }

  if (castRes.status === 400 && castRes.data?.message === "too_fast") {
    await pushLog("WARN", `Vòng #${cycleNum}: Server báo too_fast, nghỉ 2.5s rồi thả lại...`);
    await sleep(2500);
    castRes = await rpc("fishing_cast", { p_rod: pRod }, token);
  }

  const castCoins = extractCoinsFromPayload(castRes.data);
  if (typeof castCoins === "number") await syncCoins(castCoins);
  syncRodsFromPayload(castRes.data);

  // Phát hiện trường hợp gửi UUID cần cấp cao nhưng server từ chối và rơi về Cần trúc (tier 1)
  const targetRod = resolvePurchaseTarget(cfg.rod_item, cfg.rod_qty);
  if (
    castRes.status === 200 &&
    castRes.data &&
    pRod &&
    pRod !== "starter" &&
    targetRod.kind === "rod" &&
    targetRod.tier > 1 &&
    typeof castRes.data.rod_tier === "number" &&
    castRes.data.rod_tier !== targetRod.tier
  ) {
    await pushLog(
      "WARN",
      `Vòng #${cycleNum}: UUID cần ${pRod.slice(0, 8)}... đã hỏng trên server (server hạ về C${castRes.data.rod_tier}), đang chuyển cây khác...`
    );
    markRodBroken(pRod, targetRod.tier);
    await syncGearTelemetry();
    await ensureUsableRodOrBuy(cfg, `SWAP-DEAD-ROD #${cycleNum}`);
  }

  if (castRes.status === 200 && castRes.data) {
    const bTier = typeof castRes.data.bait_tier === "number"
      ? castRes.data.bait_tier
      : (resolvePurchaseTarget(cfg.bait_item, cfg.bait_qty).tier ?? ACTIVE_ACC.baitState.tier);

    if (typeof castRes.data.bait_left === "number") {
      ACTIVE_ACC.baitState.left = castRes.data.bait_left;
      if (bTier) ACTIVE_ACC.baitLeftByTier[String(bTier)] = castRes.data.bait_left;
    }
    if (typeof castRes.data.bait_tier === "number") {
      ACTIVE_ACC.baitState.tier = castRes.data.bait_tier;
    }
    if (typeof castRes.data.rod_tier === "number" && (!pRod || pRod === "starter" || castRes.data.rod_tier === targetRod.tier)) {
      ACTIVE_ACC.rodState.tier = castRes.data.rod_tier;
    }
    if (pRod && isRodUsable(pRod)) {
      ACTIVE_ACC.rodState.id = pRod;
      recordRodInfo(pRod, ACTIVE_ACC.rodState.tier);
    }
  }

  if (castRes.status !== 200 || !castRes.data?.cast) {
    const errPayload = JSON.stringify(castRes.data);
    const bought = await tryAutoRestockOnError(errPayload, cfg, cycleNum);
    if (bought) {
      await sleep(700);
      pRod = getSelectedRodUuid(cfg);
      castRes = await rpc("fishing_cast", { p_rod: pRod }, token);
      if (castRes.status === 200 && castRes.data) {
        if (typeof castRes.data.bait_left === "number") {
          ACTIVE_ACC.baitState.left = castRes.data.bait_left;
          const bT = castRes.data.bait_tier ?? ACTIVE_ACC.baitState.tier;
          if (bT) ACTIVE_ACC.baitLeftByTier[String(bT)] = castRes.data.bait_left;
        }
        if (typeof castRes.data.bait_tier === "number") ACTIVE_ACC.baitState.tier = castRes.data.bait_tier;
      }
    }
    if (castRes.status !== 200 || !castRes.data?.cast) {
      return {
        ok: false,
        detail: `Vòng #${cycleNum} | Thả câu lỗi (HTTP ${castRes.status}): ${JSON.stringify(castRes.data)} | ${buildGearStatusText(cfg, null, null, pRod)}`
      };
    }
  }

  const { cast, bite_ms = 2000, fight_ms = 1500, fish_tier, bait_left, bait_tier } = castRes.data;
  const waitTotal = bite_ms + fight_ms + 300;

  await sleep(waitTotal);

  const landRes = await rpc("fishing_land", { p_cast: cast, p_ok: true }, token);
  const totalLatency = Date.now() - tCycle;

  if (landRes.status !== 200 || !landRes.data) {
    await tryAutoRestockOnError(JSON.stringify(landRes.data), cfg, cycleNum);
    return {
      ok: false,
      detail: `Vòng #${cycleNum} | Kéo cá lỗi (HTTP ${landRes.status}): ${JSON.stringify(landRes.data)} | ${buildGearStatusText(cfg, bait_left, bait_tier, pRod)}`
    };
  }

  const d = landRes.data;
  const landCoins = extractCoinsFromPayload(d);
  if (typeof landCoins === "number") await syncCoins(landCoins);
  syncRodsFromPayload(d);

  if (d.rod && typeof d.rod === "object") {
    const durVal = typeof d.rod.durability === "number" ? d.rod.durability : ACTIVE_ACC.rodState.durability;
    const isBroken = Boolean(d.rod.broken) || (typeof durVal === "number" && durVal <= 0);
    const nextRodId = d.rod.id || ACTIVE_ACC.rodState.id || pRod;
    const nextRodTier = typeof d.rod.tier === "number"
      ? d.rod.tier
      : (ACTIVE_ACC.rodState.tier ?? KNOWN_ROD_META[nextRodId]?.tier ?? null);

    if (isBroken) {
      if (nextRodId) markRodBroken(nextRodId, nextRodTier);
      await syncGearTelemetry();
      await pushLog("WARN", `Vòng #${cycleNum} | ${formatRodLabel(nextRodTier, nextRodId)} đã hết độ bền / gãy (Độ bền: ${durVal ?? 0}%)`);
      // Kiểm tra lại kho xem còn cây dự phòng nào không; hết sạch mới mua
      await ensureUsableRodOrBuy(cfg, `BROKEN-ROD #${cycleNum}`);
    } else {
      ACTIVE_ACC.rodState = {
        id: nextRodId,
        tier: nextRodTier,
        durability: durVal,
        broken: false
      };
      if (nextRodId) recordRodInfo(nextRodId, nextRodTier, durVal, false);
      await syncGearTelemetry();
    }
  } else {
    await syncGearTelemetry();
  }

  if (typeof bait_left === "number" && bait_left <= 0) {
    await checkAndBuyBaitIfNeeded(cfg, `EMPTY-BAIT #${cycleNum}`);
  }

  const gearText = buildGearStatusText(cfg, bait_left, bait_tier, pRod);

  if (d.result !== "caught") {
    return {
      ok: false,
      detail: `Vòng #${cycleNum} | Cá sổng mất (result=${d.result || "unknown"}, tier=${fish_tier ?? "?"}) | ${gearText}`
    };
  }

  const fishId = String(d.fish_id || "").toLowerCase().trim();
  const fishName =
    FISH_DICT[fishId] ||
    (fishId ? `Cá ${fishId.replace(/_/g, " ")}` : `Cá Tier ${fish_tier ?? 1} (Hiếm ${d.rarity ?? 0})`);

  const newTag = d.new ? " [MỚI!]" : "";

  return {
    ok: true,
    item: fishName,
    value: Number(d.value || 0),
    points: Number(d.points || 0),
    latency: totalLatency,
    detail: `#${cycleNum}${newTag} | ${d.size ?? "?"}m - ${d.weight ?? "?"}kg | Túi: ${d.count ?? "?"} | Điểm tổng: ${d.score ?? "?"} | ${gearText} | Cast:${castRes.ms}ms + Chờ:${waitTotal}ms + Land:${landRes.ms}ms`
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
    `=== KHỞI ĐỘNG WORKER #${RUN_ID} (${MAX_HOURS}h, delay ${DELAY_MS}ms) | Acc: ${ACTIVE_ACC.fullName || ACTIVE_ACC.label} (UID: ${ACTIVE_ACC.uid || "N/A"}) | Cần chọn:${autoCfg.rod_item} (Mua:${autoCfg.auto_buy_rod ? "ON" : "OFF"}) | Mồi chọn:${autoCfg.bait_item} (Mua:${autoCfg.auto_buy_bait ? "ON" : "OFF"}) | TựBán:${autoCfg.auto_sell ? `mỗi ${autoCfg.sell_every} lượt` : "OFF"} ===`
  );

  try {
    await fetchTokensViaPuppeteer(initialCookies, autoCfg);
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

        const selRod = getSelectedRodStatus(activeCfg);
        const selBait = getSelectedBaitStatus(activeCfg);

        await fbPatch("worker_control", {
          status: "running",
          last_heartbeat: Date.now(),
          ok_count: okCount,
          err_count: errCount,
          avg_latency: avgLat,
          active_rod_name: formatRodLabel(selRod.tier, selRod.uuid),
          active_rod_durability: selRod.durability ?? null,
          active_bait_name: formatBaitLabel(selBait.tier, activeCfg.bait_item),
          active_bait_left: selBait.left ?? null
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
