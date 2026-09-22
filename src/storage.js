import fs from "fs";
import path from "path";

const STATE_PATH = path.resolve("data/alerts-state.json");
const HISTORY_PATH = path.resolve("data/alerts-history.json");
const MAX_HISTORY = 20;

export function readState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return { active: [], lastCheck: null };
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { active: [], lastCheck: null };
  }
}

export function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export function readHistory() {
  try {
    if (!fs.existsSync(HISTORY_PATH)) return [];
    const data = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function writeHistory(history) {
  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
}

export function addToHistory(alert) {
  const history = readHistory().filter((h) => h.identifier !== alert.identifier);
  history.unshift({ ...alert, detectedAt: new Date().toISOString() });
  const trimmed = history.slice(0, MAX_HISTORY);
  writeHistory(trimmed);
  return trimmed;
}