import { apiClient } from '../../lib/api-client';

export default function ChatPage() {
  async function loadModels() {
    return apiClient.getAiConfig();
  }

  function startChat() {
    return apiClient.createChatStream('hello');
  }

  loadModels();
  startChat();
  return null;
}
