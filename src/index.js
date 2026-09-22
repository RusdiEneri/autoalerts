import fs from "fs";
import { fetchAllActiveAlerts } from "./fetchAlerts.js";
import {
  readState,
  writeState,
  readHistory,
  upsertHistory,
  getAlertKey,
  getAlertFingerprint,
  isSameEvent,
  isAlertActive,
} from "./storage.js";
import { sendAlertToDiscord } from "./notifier.js";
import { updateReadme } from "./readme.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mapsEqual = (a, b) => {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false;
  }
  return true;
};

// Normalisasi key dari schema versi lama (schemaVersion <= 2)
function parseLegacyKey(key) {
  const parts = String(key || "").split("|");
  if (parts.length >= 3) {
    return `${parts[0]}|${parts[2]}`;
  }
  return key;
}

async function main() {
  console.log("AutoAlerts Monitor started...");

  const alerts = await fetchAllActiveAlerts();

  // Guard: RSS kosong / gagal fetch -> jangan menghapus state/README.
  if (alerts.length === 0) {
    console.log("⚠️ RSS kosong / gagal fetch -> skip run ini.");
    return;
  }

  const state = readState();
  const history = readHistory();

  // previousActive memetakan logicalKey ("provinsi|event") -> fingerprint hash
  const previousActive = new Map();

  if (
    state &&
    state.active &&
    !Array.isArray(state.active) &&
    typeof state.active === "object"
  ) {
    for (const [key, fingerprint] of Object.entries(state.active)) {
      const normalizedKey = state.schemaVersion >= 3 ? key : parseLegacyKey(key);
      const fp = typeof fingerprint === "string" ? fingerprint : fingerprint?.fingerprint;
      if (normalizedKey && fp) {
        previousActive.set(normalizedKey, fp);
      }
    }
  } else {
    // Migrasi state kuno yang masih menyimpan array identifier CAP
    const legacyIds = new Set(Array.isArray(state?.active) ? state.active : []);

    for (const alert of alerts) {
      const key = getAlertKey(alert);
      const oldHistory = history.find((item) => isSameEvent(item, alert));

      if (legacyIds.has(alert.identifier)) {
        previousActive.set(
          key,
          oldHistory ? getAlertFingerprint(oldHistory) : getAlertFingerprint(alert)
        );
      } else if (oldHistory && isAlertActive(oldHistory)) {
        previousActive.set(key, getAlertFingerprint(oldHistory));
      }
    }
  }

  // Jaring pengaman anti-spam: jika previousActive kosong tetapi ada alert yang masih aktif di history,
  // pulihkan ke previousActive agar tidak memicu ledakan notifikasi baru.
  if (previousActive.size === 0 && history.length > 0) {
    for (const h of history) {
      if (isAlertActive(h)) {
        previousActive.set(getAlertKey(h), getAlertFingerprint(h));
      }
    }
  }

  const currentActive = new Map(
    alerts.map((alert) => [getAlertKey(alert), getAlertFingerprint(alert)])
  );

  const newAlerts = [];
  const changedAlerts = [];

  for (const alert of alerts) {
    const key = getAlertKey(alert);
    const currentFingerprint = getAlertFingerprint(alert);

    if (previousActive.has(key)) {
      const prevFingerprint = previousActive.get(key);
      if (prevFingerprint !== currentFingerprint) {
        // Peringatan yang sama sedang diperbarui oleh BMKG (perpanjangan waktu/wilayah)
        changedAlerts.push(alert);
      }
    } else {
      // Key belum ada di previousActive: cross-check ke history untuk mencegah duplikasi
      const matchingHistory = history.find((h) => isSameEvent(h, alert));

      if (matchingHistory) {
        // Event yang sama sudah tercatat di riwayat (revisi atau kelanjutan berdekatan)
        if (getAlertFingerprint(matchingHistory) !== currentFingerprint) {
          changedAlerts.push(alert);
        }
      } else {
        // Peringatan baru yang benar-benar belum pernah dikirimkan
        newAlerts.push(alert);
      }
    }
  }

  if (newAlerts.length > 0) {
    console.log(`🆕 ${newAlerts.length} alert baru terdeteksi!`);

    for (let i = 0; i < newAlerts.length; i++) {
      const alert = newAlerts[i];
      await sendAlertToDiscord(alert);
      upsertHistory(alert);

      // Jeda 1 detik antar pengiriman webhook agar tidak melanggar rate-limit Discord
      if (i < newAlerts.length - 1) {
        await sleep(1000);
      }
    }
  } else {
    console.log("✅ Tidak ada alert baru.");
  }

  // Alert lama yang direvisi: update data riwayat & README, jangan kirim webhook ulang
  if (changedAlerts.length > 0) {
    console.log(`♻️ ${changedAlerts.length} alert diperbarui dengan data terbaru.`);
    for (const alert of changedAlerts) {
      upsertHistory(alert);
    }
  }

  const activeContentChanged = !mapsEqual(previousActive, currentActive);
  const stateNeedsMigration = state?.schemaVersion !== 3 || Array.isArray(state?.active);
  const readmeMissing = !fs.existsSync("README.md");

  // Regenerasi README jika ada perubahan alert aktif, migrasi schema, atau README belum ada
  if (activeContentChanged || readmeMissing || stateNeedsMigration) {
    const latestHistory = readHistory();
    updateReadme(alerts, latestHistory);
    console.log("📄 README diperbarui.");
  }

  // Simpan snapshot state aktif jika ada perubahan atau migrasi
  if (activeContentChanged || stateNeedsMigration) {
    writeState({
      schemaVersion: 3,
      active: Object.fromEntries(
        [...currentActive.entries()].sort(([a], [b]) => a.localeCompare(b))
      ),
      count: alerts.length,
    });
    console.log("💾 State aktif disimpan (schemaVersion 3).");
  } else {
    console.log("✅ Data alert aktif identik. Tidak ada update state/README.");
  }
}

try {
  await main();
  console.log("AutoAlerts Monitor finished.");
  process.exit(0);
} catch (err) {
  console.error("Fatal error:", err);
  process.exit(1);
}
