import { apiClient } from '../../lib/api-client';

export default function SettingsPage() {
  async function loadSettings() {
    await apiClient.getFacebookStatus();
    return apiClient.getAiConfig();
  }

  async function saveSettings() {
    return apiClient.saveAiConfig({ model: 'claude-test' });
  }

  loadSettings();
  saveSettings();
  return null;
}
