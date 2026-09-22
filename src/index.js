import fs from "fs";
import { fetchAllActiveAlerts } from "./fetchAlerts.js";
import {
  readState,
  writeState,
  readHistory,
  upsertHistory,
  getAlertKey,
  getAlertFingerprint,
} from "./storage.js";
import { sendAlertToDiscord } from "./notifier.js";
import { updateReadme } from "./readme.js";

const mapsEqual = (a, b) => {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false;
  }
  return true;
};

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

  // State baru: { active: { logicalKey: fingerprint } }
  const previousActive = new Map();

  if (
    state &&
    state.active &&
    !Array.isArray(state.active) &&
    typeof state.active === "object"
  ) {
    for (const [key, fingerprint] of Object.entries(state.active)) {
      previousActive.set(key, fingerprint);
    }
  } else {
    // Migrasi state lama yang masih menyimpan identifier CAP.
    const legacyIds = new Set(Array.isArray(state?.active) ? state.active : []);

    for (const alert of alerts) {
      const key = getAlertKey(alert);
      const oldHistory = history.find((item) => getAlertKey(item) === key);

      if (legacyIds.has(alert.identifier)) {
        previousActive.set(
          key,
          oldHistory ? getAlertFingerprint(oldHistory) : getAlertFingerprint(alert)
        );
      } else if (oldHistory) {
        // Cegah spam pada first run setelah migrasi ketika ID BMKG sudah berubah.
        previousActive.set(key, getAlertFingerprint(oldHistory));
      }
    }
  }

  const currentActive = new Map(
    alerts.map((alert) => [getAlertKey(alert), getAlertFingerprint(alert)])
  );

  const newAlerts = alerts.filter((alert) => !previousActive.has(getAlertKey(alert)));
  const changedAlerts = alerts.filter((alert) => {
    const key = getAlertKey(alert);
    return previousActive.has(key) && previousActive.get(key) !== getAlertFingerprint(alert);
  });

  if (newAlerts.length > 0) {
    console.log(`🆕 ${newAlerts.length} alert baru terdeteksi!`);

    for (const alert of newAlerts) {
      await sendAlertToDiscord(alert);
      upsertHistory(alert);
    }
  } else {
    console.log("✅ Tidak ada alert baru.");
  }

  // Alert lama yang direvisi: update ke data terbaru, tetapi jangan kirim webhook ulang.
  if (changedAlerts.length > 0) {
    console.log(`♻️ ${changedAlerts.length} alert diperbarui dengan data terbaru.`);
    for (const alert of changedAlerts) {
      upsertHistory(alert);
    }
  }

  const activeContentChanged = !mapsEqual(previousActive, currentActive);
  const stateNeedsMigration = state?.schemaVersion !== 2 || Array.isArray(state?.active);
  const readmeMissing = !fs.existsSync("README.md");

  // Saat migrasi, README juga ditulis ulang supaya riwayat duplikat lama langsung dibersihkan.
  if (activeContentChanged || readmeMissing || stateNeedsMigration) {
    const latestHistory = readHistory();
    updateReadme(alerts, latestHistory);
    console.log("📄 README diperbarui.");
  }

  // Snapshot aktif sekarang berbasis logical key + fingerprint.
  if (activeContentChanged || stateNeedsMigration) {
    writeState({
      schemaVersion: 2,
      active: Object.fromEntries(
        [...currentActive.entries()].sort(([a], [b]) => a.localeCompare(b))
      ),
      count: alerts.length,
    });
    console.log("💾 State aktif disimpan.");
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
