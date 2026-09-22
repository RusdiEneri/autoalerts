import fs from "fs";
import path from "path";
import crypto from "crypto";

const STATE_PATH = path.resolve("data/alerts-state.json");
const HISTORY_PATH = path.resolve("data/alerts-history.json");
const MAX_HISTORY = 20;

const normalize = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const normalizeDate = (value) => {
  const parsed = Date.parse(value || "");
  return Number.isNaN(parsed) ? normalize(value) : new Date(parsed).toISOString();
};

// ID logis alert tidak bergantung pada identifier CAP yang bisa berubah saat BMKG merevisi alert.
export function getAlertKey(alert) {
  return [
    normalize(alert.province),
    normalize(alert.headline),
    normalize(alert.event),
    normalizeDate(alert.effective),
  ].join("|");
}

// Fingerprint hanya berisi data yang benar-benar ditampilkan/digunakan.
// identifier, sent, dan capUrl sengaja tidak dimasukkan agar perubahan ID saja tidak dianggap perubahan isi.
export function getAlertFingerprint(alert) {
  const payload = {
    province: normalize(alert.province),
    headline: normalize(alert.headline),
    event: normalize(alert.event),
    urgency: normalize(alert.urgency),
    severity: normalize(alert.severity),
    certainty: normalize(alert.certainty),
    effective: normalizeDate(alert.effective),
    expires: normalizeDate(alert.expires),
    description: normalize(alert.description),
    areaDesc: normalize(alert.areaDesc),
    web: alert.web || null,
  };

  return crypto.createHash("sha1").update(JSON.stringify(payload)).digest("hex");
}

export function readState() {
  try {
    if (!fs.existsSync(STATE_PATH)) {
      return { schemaVersion: 2, active: {}, count: 0 };
    }
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { schemaVersion: 2, active: {}, count: 0 };
  }
}

export function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
}

export function readHistory() {
  try {
    if (!fs.existsSync(HISTORY_PATH)) return [];

    const data = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
    if (!Array.isArray(data)) return [];

    // History disusun terbaru -> terlama, jadi versi pertama untuk key yang sama adalah versi terbaru.
    const seen = new Set();
    const unique = [];

    for (const alert of data) {
      if (!alert || typeof alert !== "object") continue;
      const key = getAlertKey(alert);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(alert);
    }

    const cleaned = unique.slice(0, MAX_HISTORY);

    // Sekalian bersihkan history lama yang berisi versi/duplikat alert yang sama.
    if (JSON.stringify(cleaned) !== JSON.stringify(data)) {
      writeHistory(cleaned);
    }

    return cleaned;
  } catch {
    return [];
  }
}

export function writeHistory(history) {
  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  fs.writeFileSync(
    HISTORY_PATH,
    JSON.stringify(history.slice(0, MAX_HISTORY), null, 2) + "\n",
    "utf8"
  );
}

export function upsertHistory(alert) {
  const history = readHistory();
  const key = getAlertKey(alert);
  const index = history.findIndex((item) => getAlertKey(item) === key);

  // identifier/sent baru tetapi isi sama -> jangan tulis ulang.
  if (index !== -1 && getAlertFingerprint(history[index]) === getAlertFingerprint(alert)) {
    return false;
  }

  const existing = index !== -1 ? history[index] : null;
  const record = {
    ...alert,
    // Waktu deteksi pertama dipertahankan saat alert direvisi.
    detectedAt: existing?.detectedAt || new Date().toISOString(),
  };

  const next = history.filter((_, i) => i !== index);
  next.unshift(record);
  writeHistory(next);
  return true;
}
