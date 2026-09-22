import fs from "fs";
import { fetchAllActiveAlerts } from "./fetchAlerts.js";
import { readState, writeState, readHistory, addToHistory } from "./storage.js";
import { sendAlertToDiscord } from "./notifier.js";
import { updateReadme } from "./readme.js";

async function main() {
  console.log("AutoAlerts Monitor started...");

  const alerts = await fetchAllActiveAlerts();
  const state = readState();
  const previousActiveIds = new Set(state.active || []);
  const currentActiveIds = new Set(alerts.map((a) => a.identifier));

  // Identifikasi alert BARU (tidak ada di state sebelumnya)
  const newAlerts = alerts.filter((a) => !previousActiveIds.has(a.identifier));

  // Kirim webhook untuk alert baru
  if (newAlerts.length > 0) {
    console.log(`🆕 ${newAlerts.length} alert baru terdeteksi!`);
    for (const alert of newAlerts) {
      await sendAlertToDiscord(alert);
      addToHistory(alert);
    }
  } else {
    console.log("✅ Tidak ada alert baru (semua sudah tercatat di state).");
  }

  // Update README dengan alert aktif + history terbaru
  const history = readHistory();
  updateReadme(alerts, history);
  console.log("📄 README.md diperbarui.");

  // Update state
  const newState = {
    active: Array.from(currentActiveIds),
    lastCheck: new Date().toISOString(),
    count: alerts.length,
  };
  writeState(newState);
  console.log(`💾 State disimpan: ${alerts.length} alert aktif.`);
}

try {
  await main();
  console.log("AutoAlerts Monitor finished.");
  process.exit(0);
} catch (err) {
  console.error("Fatal error:", err);
  process.exit(1);
}