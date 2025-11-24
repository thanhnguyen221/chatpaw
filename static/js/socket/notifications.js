// static/js/socket/notifications.js
(function () {
  const CONTAINER_ID = 'in-app-notifications-container';
  const MAX_NOTIFICATIONS = 3;
const notifSound = new Audio('/static/sounds/mixkit-happy-puppy-barks-741.wav');





  function ensureContainer() {
    let container = document.getElementById(CONTAINER_ID);
    if (!container) {
      container = document.createElement('div');
      container.id = CONTAINER_ID;
      container.className = 'in-app-notifications-container';
      document.body.appendChild(container);
    }
    return container;
  }

  function removeNotification(card, removeContainerIfEmpty = true) {
    if (!card) return;
    card.style.animation = 'notif-fade-out 0.2s forwards';
    setTimeout(() => {
      if (card.parentNode) card.parentNode.removeChild(card);
      if (removeContainerIfEmpty) {
        const container = document.getElementById(CONTAINER_ID);
        if (container && !container.children.length && container.parentNode) {
          container.parentNode.removeChild(container);
        }
      }
    }, 200);
  }

  window.showInAppNotification = function ({
    title,
    messagePreview,
    conversationId,
    conversationType,
  }) {
    const container = ensureContainer();

    // Giới hạn tối đa 3 card
    while (container.children.length >= MAX_NOTIFICATIONS) {
      const oldest = container.firstElementChild;
      if (oldest) container.removeChild(oldest);
      else break;
    }

    const card = document.createElement('div');
    card.className = 'in-app-notification';

    // Auto close sau 5s (pause khi hover)
    let autoCloseTimer = setTimeout(() => removeNotification(card), 5000);

    card.addEventListener('mouseenter', () => {
      clearTimeout(autoCloseTimer);
    });

    card.addEventListener('mouseleave', () => {
      autoCloseTimer = setTimeout(() => removeNotification(card), 2000);
    });

    // Icon trái
    const icon = document.createElement('div');
    icon.className = 'in-app-notification-icon';
    icon.innerHTML =
      conversationType === 'group'
        ? '<i class="fas fa-users"></i>'
        : '<i class="fas fa-user"></i>';

    // Body
    const body = document.createElement('div');
    body.className = 'in-app-notification-body';

    const titleRow = document.createElement('div');
    titleRow.className = 'in-app-notification-title';

    const titleSpan = document.createElement('span');
    titleSpan.textContent = title || 'Tin nhắn mới';

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = conversationType === 'group' ? 'Nhóm' : 'Tin nhắn';

    titleRow.appendChild(titleSpan);
    titleRow.appendChild(badge);

    const text = document.createElement('div');
    text.className = 'in-app-notification-text';
    text.textContent = messagePreview || '';

    body.appendChild(titleRow);
    body.appendChild(text);

    // Nút đóng
    const closeBtn = document.createElement('button');
    closeBtn.className = 'in-app-notification-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeNotification(card);
    });

    card.appendChild(icon);
    card.appendChild(body);
    card.appendChild(closeBtn);

    // Click vào card -> mở cuộc trò chuyện
    card.addEventListener('click', () => {
      try {
        if (conversationType === 'group') {
          if (typeof window.openGroupChat === 'function') {
            window.openGroupChat(conversationId, title || 'Nhóm');
          } else if (window.chatModule && typeof window.chatModule.openGroup === 'function') {
            window.chatModule.openGroup(conversationId);
          }
        } else {
          if (window.chatModule && typeof window.chatModule.openConversation === 'function') {
            window.chatModule.openConversation(conversationId);
          } else if (typeof window.openPrivateChat === 'function') {
            window.openPrivateChat(conversationId);
          }
        }
      } catch (err) {
        console.error('Error opening conversation from notification:', err);
      } finally {
        removeNotification(card);
      }
    });

    // Gắn card vào container
    container.appendChild(card);

    // Phát âm thanh "ting"
    try {
      notifSound.currentTime = 0;
      notifSound.play().catch((err) => {
        console.warn('Cannot play notification sound:', err);
      });
    } catch (err) {
      console.warn('Notification sound error:', err);
    }
  };
})();
