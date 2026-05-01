export const socket = io({
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 2000,
  reconnectionDelayMax: 10000,
  timeout: 60000,
  transports: ['websocket', 'polling'],
  autoConnect: true
});
export let currentConversation = null;
