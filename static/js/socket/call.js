// static/js/socket/call.js
// PHIÊN BẢN HOÀN CHỈNH (TURN, Sửa addTrack, Sửa Bật/Tắt âm thanh)

import { socket } from './index.js';

let pc;
let localStream;
let currentConversationId = null; 
let isCaller = false;
let incomingCallData = null; 


let currentFacingMode = 'user'; // [MỚI] 'user' (trước), 'environment' (sau)

// [FIX 1] rtcConfig MỚI với STUN + TURN để sửa lỗi màn hình đen (khi test 4G/Wi-Fi Isolation)
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelay',
      credential: 'openrelay'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelay',
      credential: 'openrelay'
    }
  ]
};

export function setCurrentConversation(id) {
  console.log('[Call] Đã chuyển sang hội thoại:', id);
  currentConversationId = id;
}

export function bindCallUI() {
  console.log('[Call] bindCallUI() đang chạy...');
  const startBtn = document.getElementById('start-video-call');
  const endBtn = document.getElementById('end-video-call');
  const modal = document.getElementById('video-call-modal');
  const hangupBtn = document.getElementById('hangup');
  const toggleMic = document.getElementById('toggle-mic');
  const toggleCam = document.getElementById('toggle-cam');
  const flipBtn = document.getElementById('flip-cam'); // [MỚI] Nút Lật Cam

  // Nút cho modal lời mời
  const acceptBtn = document.getElementById('accept-call');
  const declineBtn = document.getElementById('decline-call');
  const incomingModal = document.getElementById('incoming-call-modal');
  const ringtone = document.getElementById('ringtone-audio'); // [THÊM MỚI]

  if (startBtn) {
    startBtn.addEventListener('click', startCall);
    console.log('[Call] Đã gán sự kiện click cho startBtn');
  } else {
    console.error('[Call] Lỗi: Không tìm thấy #start-video-call');
  }

  endBtn?.addEventListener('click', endCall);
  hangupBtn?.addEventListener('click', endCall);

  toggleMic?.addEventListener('click', () => {
    if (!localStream) return;
    const track = localStream.getAudioTracks()[0];
    if (track) track.enabled = !track.enabled;
  });

  toggleCam?.addEventListener('click', () => {
    if (!localStream) return;
    const track = localStream.getVideoTracks()[0];
    if (track) track.enabled = !track.enabled;
  });
  // [THÊM MỚI] Toàn bộ logic Lật Cam
  flipBtn?.addEventListener('click', async () => {
    if (!pc || !localStream) {
      console.log('Chưa trong cuộc gọi, không thể lật');
      return;
    }

    // 1. Tắt camera cũ
    localStream.getVideoTracks().forEach(track => {
      track.stop();
    });

    // 2. Đảo chế độ
    currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';

    let newVideoTrack;
    try {
      // 3. Lấy stream camera mới (chỉ cần video)
      const newStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: currentFacingMode } 
      });
      newVideoTrack = newStream.getVideoTracks()[0];
    } catch (err) {
      console.error("Lỗi lật camera:", err);
      // Nếu lỗi, thử quay lại camera cũ
      currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
      return;
    }
    
    // 4. Tìm bộ gửi (sender) và thay thế track
    const sender = pc.getSenders().find(s => s.track.kind === 'video');
    if (sender) {
      sender.replaceTrack(newVideoTrack);
    }
    
    // 5. Cập nhật stream cục bộ
    localStream.removeTrack(localStream.getVideoTracks()[0]);
    localStream.addTrack(newVideoTrack);
    
    const localVideo = document.getElementById('localVideo');
    if (localVideo) localVideo.srcObject = localStream;
  });

  // Xử lý nút Chấp nhận
  acceptBtn?.addEventListener('click', async () => {
    if (!incomingCallData) return;
    ringtone?.pause(); // [THÊM MỚI] Dừng nhạc chuông
    
    const convId = incomingCallData.conversation_id;
    console.log('[Call] Đã chấp nhận cuộc gọi từ phòng:', convId);

    if (incomingModal) incomingModal.style.display = 'none';
    setCurrentConversation(convId);

    await ensurePC();
    await openLocalMedia(); // Mở media và add tracks LẦN 1
    showModal(true); 

    socket.emit('call:accept', { 
        conversation_id: convId
    });
    
    incomingCallData = null;
  });

  // Xử lý nút Từ chối
  declineBtn?.addEventListener('click', () => {
    ringtone?.pause(); // [THÊM MỚI] Dừng nhạc chuông
    console.log('[Call] Đã từ chối cuộc gọi');
    if (incomingModal) incomingModal.style.display = 'none';
    
    if (incomingCallData) {
        socket.emit('call:decline', { 
            conversation_id: incomingCallData.conversation_id 
        });
    }
    incomingCallData = null;
  });


  // Socket signaling handlers
  // [FIX 2] Sửa logic incoming call
  socket.on('call:incoming', async ({ conversation_id, caller_id }) => {
    console.log(`[Call] Nhận được lời mời từ ${caller_id} cho phòng ${conversation_id}`);
    
    if (pc) {
      console.log('[Call] Đang bận (pc exists), tự động từ chối');
      return;
    }
    if (incomingCallData) {
      console.log('[Call] Đang có lời mời khác, bỏ qua');
      return;
    }

    incomingCallData = { conversation_id, caller_id };

    const incomingModal = document.getElementById('incoming-call-modal');
    if (incomingModal) {
      const callerNameEl = document.getElementById('caller-name');
      if (callerNameEl) callerNameEl.textContent = 'Ai đó'; 
      incomingModal.style.display = 'block';
      console.log('[Call] Đã hiển thị modal lời mời.');
      try {
        await ringtone?.play();
      } catch (e) {
        console.warn('Không thể tự động phát chuông (chờ người dùng click):', e);
      }
    } else {
      console.error('[Call] LỖI NGHIÊM TRỌNG: KHÔNG TÌM THẤY #incoming-call-modal TRONG HTML');
    }
  });


  socket.on('call:accepted', async ({ conversation_id }) => {
    console.log('[Call] Người nhận đã chấp nhận');
    if (!isCaller || conversation_id !== currentConversationId) {
      console.warn('[Call] Bỏ qua "call:accepted" (không phải người gọi hoặc sai phòng)');
      return;
    }
    console.log('[Call] Đang tạo offer...');
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('webrtc:offer', {
      conversation_id: currentConversationId,
      sdp: offer
    });
  });

  socket.on('call:declined', ({ conversation_id }) => {
    if (conversation_id === currentConversationId && isCaller) {
        alert('Người dùng đã từ chối cuộc gọi.');
        cleanup(); // Tắt cuộc gọi phía người gọi
    }
  });

  // [FIX 3] Sửa lỗi addTrack (xóa 'openLocalMedia')
  socket.on('webrtc:offer', async ({ sdp }) => {
    console.log('[Call] Nhận được offer, đang tạo answer...');
    await ensurePC();
        
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('webrtc:answer', { conversation_id: currentConversationId, sdp: answer });
  });

  socket.on('webrtc:answer', async ({ sdp }) => {
    console.log('[Call] Nhận được answer.');
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  });

  socket.on('webrtc:candidate', async ({ candidate }) => {
    if (!pc || !candidate) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.error('addIceCandidate error:', e);
    }
  });

  socket.on('call:ended', () => cleanup());

  

  console.log('[Call] bindCallUI() đã chạy xong.');
}

async function startCall() {
  if (!currentConversationId) {
    alert('Hãy chọn hội thoại trước');
    return;
  }
  console.log('[Call] Bắt đầu gọi phòng:', currentConversationId);
  isCaller = true;
  await ensurePC();
  await openLocalMedia(); // Người gọi mở media ngay
  showModal(true);
  socket.emit('call:invite', {
    conversation_id: currentConversationId,
    conversation_type: 'private'
  });
}

function endCall() {
  console.log('[Call] Người dùng nhấn kết thúc cuộc gọi');
  if (!currentConversationId) return;
  socket.emit('call:end', { conversation_id: currentConversationId });
  cleanup();
}

function showModal(show) {
  // Sửa lại để dùng CSS class mới
  const modal = document.getElementById('video-call-modal');
  if(modal) modal.style.display = show ? 'flex' : 'none';
  // [THÊM MỚI] Reset lớp phủ bật tiếng khi Mở/Tắt modal
  const overlay = document.getElementById('unmute-overlay');
  if(overlay) overlay.style.display = show ? 'flex' : 'none';
  // [KẾT THÚC THÊM MỚI]
  
  const startBtn = document.getElementById('start-video-call');
  const endBtn = document.getElementById('end-video-call');
  if(startBtn) startBtn.style.display = show ? 'none' : 'inline-block';
  if(endBtn) endBtn.style.display = show ? 'inline-block' : 'none';
}

async function ensurePC() {
  if (pc) return pc;
  console.log('[Call] Đang tạo RTCPeerConnection mới...');
  pc = new RTCPeerConnection(rtcConfig); // Dùng rtcConfig MỚI

  pc.onicecandidate = (e) => {
    if (e.candidate && currentConversationId) {
      socket.emit('webrtc:candidate', {
        conversation_id: currentConversationId,
        candidate: e.candidate
      });
    }
  };

  // [THAY THẾ] Toàn bộ hàm pc.ontrack này
  pc.ontrack = (e) => {
    console.log('[Call] Nhận được remote track (video của đối phương)!');
    const remoteVideo = document.getElementById('remoteVideo');
    const overlay = document.getElementById('unmute-overlay'); // [SỬA]

    if (remoteVideo && e.streams && e.streams[0]) {
      remoteVideo.srcObject = e.streams[0];

      // [SỬA] Logic Bật tiếng mạnh mẽ hơn
      const unmute = () => {
        remoteVideo.muted = false; // Bắt buộc Bật tiếng
        remoteVideo.play().catch(e => console.error("Lỗi khi play video:", e)); // Thử play (cho Safari)
        
        if (overlay) overlay.style.display = 'none'; // Ẩn lớp phủ
        
        // Bỏ sự kiện đi sau khi đã bấm
        if (overlay) overlay.removeEventListener('click', unmute);
        remoteVideo.removeEventListener('click', unmute);
      };

      if (overlay) overlay.addEventListener('click', unmute);
      remoteVideo.addEventListener('click', unmute); 
    }
  };

  return pc;
}

async function openLocalMedia() {
  if (localStream) {
    console.log('[Call] Đã có local media, đang add tracks...');
    try {
      // [FIX 3.1] Sửa logic addTrack
      const senders = pc.getSenders();
      localStream.getTracks().forEach(track => {
        const senderExists = senders.some(sender => sender.track === track);
        if (!senderExists) {
          pc.addTrack(track, localStream);
          console.log('[Call] Đã add track:', track.kind);
        }
      });
    } catch (e) {
      console.error('[Call] Lỗi khi addTrack:', e);
    }
    return localStream;
  }
  
  try {
    console.log('[Call] Đang xin quyền camera/mic...');
   // Sửa thành
    localStream = await navigator.mediaDevices.getUserMedia({ 
      audio: true, 
      video: { facingMode: currentFacingMode } 
    });
    checkAndShowFlipButton();
    const localVideo = document.getElementById('localVideo');
    if (localVideo) localVideo.srcObject = localStream;
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    console.log('[Call] Đã lấy được media và add tracks.');
    return localStream;
  } catch (err) {
    console.error('[Call] LỖI KHI LẤY MEDIA (getUserMedia):', err);
    alert('Không thể truy cập camera/micro. Vui lòng kiểm tra quyền truy cập.');
  }
}

function cleanup() {
  console.log('[Call] Dọn dẹp cuộc gọi (cleanup)...');
  showModal(false);
  document.getElementById('ringtone-audio')?.pause(); // [THÊM MỚI]
  
  const startBtn = document.getElementById('start-video-call');
  const endBtn = document.getElementById('end-video-call');
  if (startBtn) startBtn.style.display = 'inline-block';
  if (endBtn) endBtn.style.display = 'none';

  if (pc) {
    pc.getSenders().forEach(s => { try { s.track && s.track.stop(); } catch {} });
    try { pc.close(); } catch {}
  }
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
  }

  const incomingModal = document.getElementById('incoming-call-modal');
  if (incomingModal) incomingModal.style.display = 'none';
  
  pc = null;
  localStream = null;
  isCaller = false;
  // Sửa thành
  incomingCallData = null;
  currentFacingMode = 'user'; // [MỚI] Reset camera về mặc định
}

// [THÊM MỚI] Hàm kiểm tra camera và ẩn/hiện nút lật
async function checkAndShowFlipButton() {
  const flipBtn = document.getElementById('flip-cam');
  if (!flipBtn) return;

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');
    
    // Chỉ hiện nút lật cam nếu có nhiều hơn 1 camera
    if (videoDevices.length > 1) {
      console.log('[Call] Phát hiện nhiều camera, hiển thị nút lật cam.');
      flipBtn.style.display = 'inline-block';
    } else {
      console.log('[Call] Chỉ có 1 camera, ẩn nút lật cam.');
      flipBtn.style.display = 'none';
    }
  } catch (e) {
    console.error('Không thể liệt kê thiết bị:', e);
    flipBtn.style.display = 'none'; // Ẩn nếu có lỗi
  }
}