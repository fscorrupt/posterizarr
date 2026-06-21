const API_URL = "/api";

const LOG_FILE_MAP = {
  testing: "Testinglog.log",
  manual: "Manuallog.log",
  normal: "Scriptlog.log",
  backup: "Scriptlog.log",
  syncjelly: "Scriptlog.log",
  syncemby: "Scriptlog.log",
  reset: "Scriptlog.log",
  scheduled: "Scriptlog.log",
  tautulli: "Scriptlog.log",
  arr: "Scriptlog.log",
  webhook: "Scriptlog.log",
  logoupdater: "Scriptlog.log",
};

export const getLogFileForMode = (mode) => {
  const safeMode = (mode || "").toLowerCase();
  return LOG_FILE_MAP[safeMode] || "Scriptlog.log";
};

export const waitForLogFile = async (logFileName, maxAttempts = 30, delayMs = 200) => {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${API_URL}/logs/${logFileName}/exists`);
      const data = await response.json();

      if (data.exists) {
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return false;
};
