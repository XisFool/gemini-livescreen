const { app, safeStorage } = require('electron');
const fs   = require('fs');
const path = require('path');

function getConfigPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function getSettings() {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to read settings:', e);
  }
  return {};
}

function saveSettings(data) {
  const configPath = getConfigPath();
  const existing = getSettings();
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify({ ...existing, ...data }, null, 2));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

function encryptKey(plaintext) {
  if (!plaintext) return '';
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('safeStorage encryption is not available. Saving plaintext key.');
    return plaintext;
  }
  return safeStorage.encryptString(plaintext).toString('base64');
}

function decryptKey(base64) {
  if (!base64) return '';
  if (!safeStorage.isEncryptionAvailable()) {
    return base64;
  }
  try {
    return safeStorage.decryptString(Buffer.from(base64, 'base64'));
  } catch (e) {
    console.error('Failed to decrypt API key:', e);
    return '';
  }
}

function getSettingsForUI() {
  const s = getSettings();
  const hasKey = !!s.encryptedApiKey;
  return {
    apiKeyMasked: hasKey ? '••••••••' : '',
    proxyUrl:     s.proxyUrl     || '',
    systemPrompt: s.systemPrompt || '',
    geminiVoice:  s.geminiVoice  || 'Aoede',
  };
}

module.exports = { getSettings, saveSettings, encryptKey, decryptKey, getSettingsForUI };
