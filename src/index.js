import fs from "fs";
import { fetchAllActiveAlerts } from "./fetchAlerts.js";
import { readState, writeState, readHistory, addToHistory } from "./storage.js";
import { sendAlertToDiscord } from "./notifier.js";
import { updateReadme } from "./readme.js";

const setEqual = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

async function main() {
  console.log("AutoAlerts Monitor started...");

  const alerts = await fetchAllActiveAlerts();

  // Guard: RSS kosong / gagal fetch → skip total.
  // Mencegah "false reset" yang bikin semua alert dianggap baru
  // (dan webhook duplikat) saat fetch pulih.
  if (alerts.length === 0) {
    console.log("⚠️ RSS kosong / gagal fetch → skip run ini.");
    return;
  }

  const state = readState();
  const previousActiveIds = new Set(state.active || []);
  const currentActiveIds = new Set(alerts.map((a) => a.identifier));

  // Alert BARU = ada di feed sekarang, tidak ada di state sebelumnya
  const newAlerts = alerts.filter((a) => !previousActiveIds.has(a.identifier));

  if (newAlerts.length > 0) {
    console.log(`🆕 ${newAlerts.length} alert baru terdeteksi!`);
    for (const alert of newAlerts) {
      await sendAlertToDiscord(alert);
      addToHistory(alert);
    }
  } else {
    console.log("✅ Tidak ada alert baru.");
  }

  const activeChanged = !setEqual(previousActiveIds, currentActiveIds);
  const readmeMissing = !fs.existsSync("README.md");

  // HANYA regenerate README + simpan state jika benar-benar ada perubahan
  if (activeChanged || readmeMissing) {
    const history = readHistory();
    updateReadme(alerts, history);

    const newState = {
      active: [...currentActiveIds].sort(), // deterministik
      count: alerts.length,
      // lastCheck dihapus agar file state tidak berubah tiap run
    };
    writeState(newState);

    console.log(
      readmeMissing && !activeChanged
        ? "📄 README belum ada → dibuat pertama kali."
        : "📄 Set alert aktif berubah → README + state diperbarui."
    );
  } else {
    console.log("Tidak ada perubahan alert aktif → tidak ada commit.");
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