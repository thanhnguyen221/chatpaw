import { socket } from "./index.js";

const peers = {};
const pendingCandidates = {};

let localStream = null;
let currentCallId = null;
let currentCallType = null;       // 'private' | 'group'
let currentFacingMode = 'user';
let isMicOn = true;
let isCamOn = true;
let isInCall = false;

// --- BIẾN CHO TÍNH NĂNG VẼ (UPDATED) ---
let isDrawingMode = false;
let isDrawing = false;
let drawColor = '#ff0000';
let drawWidth = 4;
let currentBrushType = 'pen';   // Mặc định: Bút tròn
let isReactionVisible = false;  // Trạng thái thanh cảm xúc

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelay', credential: 'openrelay' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelay', credential: 'openrelay' }
    ]
};

// ================== 1. LOGIC KHỞI TẠO ==================

function showCallOverlay() {
    const overlay = document.getElementById('call-overlay');
    if (overlay) overlay.style.display = 'flex';

    // Resize canvas ban đầu
    setTimeout(() => {
        resizeCanvas('local-box');
    }, 500);

    // Hiện nút flip cam trên mobile
    const btnFlip = document.getElementById('btn-flip');
    if (btnFlip && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        btnFlip.style.display = 'inline-flex';
    }
}

function hideCallOverlay() {
    const overlay = document.getElementById('call-overlay');
    if (overlay) overlay.style.display = 'none';
    
    // Reset các chế độ khi tắt call
    if (isDrawingMode) toggleDrawingMode();
    if (isReactionVisible) toggleReactionBar();
}

export async function startGroupCall(conversationId, conversationType = 'group') {
    console.log("[Call] Starting call:", conversationId, "type:", conversationType);

    if (isInCall && currentCallId && currentCallId !== conversationId) {
        internalEndCall(true);
    }

    if (isInCall && currentCallId === conversationId) {
        showCallOverlay();
        return;
    }

    currentCallId = conversationId;
    currentCallType = conversationType;
    isInCall = true;

    showCallOverlay();
    
    // Kích hoạt Canvas cho local video
    setupLocalCanvas();

    try {
        await getMedia('user');
        socket.emit('call:join', { conversation_id: conversationId });
    } catch (e) {
        console.error("[Call] getMedia error:", e);
        alert('Không thể truy cập Camera/Mic. Hãy kiểm tra quyền và thiết bị.');
        internalEndCall(true);
    }
}

async function getMedia(facingMode) {
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }

    localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: facingMode }
    });

    const videoEl = document.getElementById('local-video');
    if (videoEl) {
        videoEl.srcObject = localStream;
        videoEl.play().catch(e => console.warn(e));

        // Lật gương nếu là cam trước
        if (facingMode === 'user') {
            videoEl.classList.remove('env-mode');
            videoEl.style.transform = 'scaleX(-1)';
        } else {
            videoEl.classList.add('env-mode');
            videoEl.style.transform = 'none';
        }
    }

    const audioTrack = localStream.getAudioTracks()[0];
    const videoTrack = localStream.getVideoTracks()[0];

    if (audioTrack) audioTrack.enabled = isMicOn;
    if (videoTrack) videoTrack.enabled = isCamOn;

    if (currentCallId) replaceTrackInPeers();
}

function replaceTrackInPeers() {
    if (!localStream) return;
    const newVideoTrack = localStream.getVideoTracks()[0];
    if (!newVideoTrack) return;

    for (let sid in peers) {
        const sender = peers[sid].getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(newVideoTrack).catch(e => {});
    }
}

function internalEndCall(emitLeave = true) {
    if (emitLeave && currentCallId) {
        socket.emit('call:leave', { conversation_id: currentCallId });
    }

    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }

    for (let sid in peers) {
        try { peers[sid].close(); } catch (e) {}
        delete peers[sid];
    }

    document.querySelectorAll('.video-box:not(#local-box)').forEach(el => el.remove());
    
    // Xóa sạch canvas mình vẽ
    const localCanvas = document.querySelector('#local-box canvas');
    if(localCanvas) {
        const ctx = localCanvas.getContext('2d');
        ctx.clearRect(0, 0, localCanvas.width, localCanvas.height);
    }

    hideCallOverlay();
    currentCallId = null;
    currentCallType = null;
    isInCall = false;
}

export function endCall() {
    internalEndCall(true);
}

// ================== 2. LOGIC WEBRTC ==================

socket.on('call:all_users', (data) => {
    if (!isInCall || !currentCallId) return;
    (data.users || []).forEach(uid => createPeer(uid, true));
});

socket.on('call:user_joined', (data) => {
    if (!isInCall || !currentCallId) return;
    createPeer(data.signal_initiator_sid, false);
    if (data.user_info) {
        addVideoBox(data.signal_initiator_sid, data.user_info);
    }
});

socket.on('call:user_left', (data) => {
    removePeer(data.sid);
});

socket.on('webrtc:offer', async (data) => {
    const peer = peers[data.from] || createPeer(data.from, false);
    
    try {
        if (peer.signalingState !== "stable") {
            await Promise.all([
                peer.setLocalDescription({ type: "rollback" }),
                peer.setRemoteDescription(new RTCSessionDescription(data.sdp))
            ]);
        } else {
            await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));
        }

        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit('webrtc:answer', { to: data.from, sdp: answer });

        if (pendingCandidates[data.from]) {
            pendingCandidates[data.from].forEach(c => peer.addIceCandidate(new RTCIceCandidate(c)).catch(e=>{}));
            delete pendingCandidates[data.from];
        }

        if (data.user_info) addVideoBox(data.from, data.user_info);
    } catch (err) { console.error(err); }
});

socket.on('webrtc:answer', async (data) => {
    const peer = peers[data.from];
    if (!peer) return;
    try {
        await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));
        if (pendingCandidates[data.from]) {
            pendingCandidates[data.from].forEach(c => peer.addIceCandidate(new RTCIceCandidate(c)).catch(e=>{}));
            delete pendingCandidates[data.from];
        }
    } catch (err) { console.error(err); }
});

socket.on('webrtc:candidate', async (data) => {
    const peer = peers[data.from];
    if (!peer) {
        if (!pendingCandidates[data.from]) pendingCandidates[data.from] = [];
        pendingCandidates[data.from].push(data.candidate);
        return;
    }
    try {
        if (peer.remoteDescription) await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
        else {
            if (!pendingCandidates[data.from]) pendingCandidates[data.from] = [];
            pendingCandidates[data.from].push(data.candidate);
        }
    } catch (e) { console.error(e); }
});

function createPeer(targetSid, initiator) {
    if (peers[targetSid]) return peers[targetSid];

    const peer = new RTCPeerConnection(rtcConfig);
    peers[targetSid] = peer;

    if (localStream) {
        localStream.getTracks().forEach(t => peer.addTrack(t, localStream));
    }

    peer.onicecandidate = (e) => {
        if (e.candidate) socket.emit('webrtc:candidate', { to: targetSid, candidate: e.candidate });
    };

    peer.ontrack = (e) => {
        const div = document.getElementById(`c-${targetSid}`) || createVideoDiv(targetSid);
        const vid = div.querySelector('video');
        if (vid) {
            vid.srcObject = e.streams[0];
            vid.muted = false;
            vid.play().catch(e => {});
        }
    };

    if (initiator) {
        peer.createOffer().then(o => peer.setLocalDescription(o)).then(() => {
            socket.emit('webrtc:offer', { to: targetSid, sdp: peer.localDescription });
        });
    }
    return peer;
}

function removePeer(sid) {
    if (peers[sid]) {
        try { peers[sid].close(); } catch (e) {}
        delete peers[sid];
    }
    document.getElementById(`c-${sid}`)?.remove();
}

// ================== 3. UI HELPER ==================

function addVideoBox(sid, info = {}) {
    let div = document.getElementById(`c-${sid}`);
    if (!div) div = createVideoDiv(sid);
    const avatar = info.avatar || '/static/img/default-avatar.png';
    const username = info.username || 'User';
    const label = div.querySelector('.user-label');
    if (label) {
        label.innerHTML = `<img src="${avatar}"> ${username}`;
    }
}

function createVideoDiv(sid) {
    const div = document.createElement('div');
    div.className = 'video-box';
    div.id = `c-${sid}`;
    
    div.innerHTML = `
        <video autoplay playsinline></video>
        <canvas class="drawing-canvas"></canvas> 
        <div class="user-label">Đang kết nối...</div>
        <div class="reaction-container"></div>
    `;
    document.getElementById('video-grid').appendChild(div);
    
    setTimeout(() => resizeCanvas(`c-${sid}`), 100);
    
    return div;
}

// ================== 4. DRAWING LOGIC (NÂNG CẤP) ==================

function setupLocalCanvas() {
    setTimeout(() => {
        const box = document.getElementById('local-box');
        const canvas = box ? box.querySelector('canvas') : null;
        if (canvas) {
            resizeCanvas('local-box');
            initDrawingListeners(canvas, 'local');
        }
    }, 500);
}

function initDrawingListeners(canvas, scope) {
    const ctx = canvas.getContext('2d');

    const getCoords = (e) => {
        const rect = canvas.getBoundingClientRect();
        let clientX = e.touches ? e.touches[0].clientX : e.clientX;
        let clientY = e.touches ? e.touches[0].clientY : e.clientY;

        let x = (clientX - rect.left) / rect.width;
        let y = (clientY - rect.top) / rect.height;

        if (scope === 'local' && currentFacingMode === 'user') {
            x = 1 - x; 
        }
        return { x, y };
    };

    const startDraw = (e) => {
        if (!isDrawingMode) return;
        isDrawing = true;
        const { x, y } = getCoords(e);
        
        // Vẽ local với loại cọ hiện tại
        drawStroke(canvas, x, y, drawColor, drawWidth, 'start', currentBrushType, scope === 'local' && currentFacingMode === 'user');
        emitDraw(x, y, 'start');
    };

    const moveDraw = (e) => {
        if (!isDrawingMode || !isDrawing) return;
        e.preventDefault(); 
        const { x, y } = getCoords(e);
        
        drawStroke(canvas, x, y, drawColor, drawWidth, 'move', currentBrushType, scope === 'local' && currentFacingMode === 'user');
        emitDraw(x, y, 'move');
    };

    const endDraw = () => {
        if (!isDrawing) return;
        isDrawing = false;
        emitDraw(0, 0, 'end');
        ctx.beginPath(); 
    };

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', moveDraw);
    canvas.addEventListener('mouseup', endDraw);
    canvas.addEventListener('touchstart', startDraw);
    canvas.addEventListener('touchmove', moveDraw);
    canvas.addEventListener('touchend', endDraw);
}

// HÀM VẼ NÂNG CẤP (Hỗ trợ Pen, Marker, Neon)
function drawStroke(canvas, normX, normY, color, width, type, brushType = 'pen', mirrorMode = false) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    let x = normX * w;
    let y = normY * h;

    if (mirrorMode) x = (1 - normX) * w;

    // --- CẤU HÌNH CỌ ---
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    
    // Reset hiệu ứng cũ
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (brushType === 'marker') {
        ctx.lineCap = 'square'; // Nét vuông
    } else if (brushType === 'neon') {
        ctx.shadowBlur = 15;      // Phát sáng
        ctx.shadowColor = color;
    }
    // --------------------

    if (type === 'start') {
        ctx.beginPath();
        ctx.moveTo(x, y);
    } else if (type === 'move') {
        ctx.lineTo(x, y);
        ctx.stroke();
        // Neon trick: vẽ đè lần 2 cho sáng hơn
        if (brushType === 'neon') ctx.stroke();
    } else if (type === 'end') {
        ctx.beginPath();
    }
}

// Gửi dữ liệu vẽ (Kèm brush_type)
function emitDraw(x, y, type) {
    if (!currentCallId) return;
    socket.emit('call:draw_stroke', {
        conversation_id: currentCallId,
        x: x, y: y,
        color: drawColor,
        width: drawWidth,
        brush_type: currentBrushType, // Gửi loại cọ
        type: type
    });
}

function resizeCanvas(boxId) {
    const box = document.getElementById(boxId);
    if (!box) return;
    const canvas = box.querySelector('canvas');
    if (canvas) {
        canvas.width = box.clientWidth;
        canvas.height = box.clientHeight;
    }
}
window.addEventListener('resize', () => {
    document.querySelectorAll('.video-box').forEach(box => resizeCanvas(box.id));
});

// ================== 5. RECEIVE EVENTS ==================

socket.on('call:draw_stroke', (data) => {
    const box = document.getElementById(`c-${data.from_sid}`);
    if (box) {
        const canvas = box.querySelector('canvas');
        if (canvas) {
            // Nhận loại cọ từ server
            drawStroke(canvas, data.x, data.y, data.color, data.width, data.type, data.brush_type, false);
        }
    }
});

socket.on('call:clear_board', (data) => {
    const box = document.getElementById(`c-${data.from_sid}`);
    if(box) {
        const cvs = box.querySelector('canvas');
        if(cvs) {
            const ctx = cvs.getContext('2d');
            ctx.clearRect(0, 0, cvs.width, cvs.height);
        }
    }
});

socket.on('call:receive_reaction', (data) => {
    let containerId = (data.from_sid === socket.id) ? 'local-box' : `c-${data.from_sid}`;
    const videoBox = document.getElementById(containerId);

    if (videoBox) {
        let rc = videoBox.querySelector('.reaction-container');
        if (!rc) {
            rc = document.createElement('div');
            rc.className = 'reaction-container';
            videoBox.appendChild(rc);
        }

        const count = 15;
        for (let i = 0; i < count; i++) {
            const span = document.createElement('span');
            span.className = 'floating-emoji';
            span.textContent = data.emoji;
            
            const left = Math.random() * 100;
            const delay = Math.random() * 0.5;
            const duration = 1.5 + Math.random();

            span.style.left = `${left}%`;
            span.style.animationDelay = `${delay}s`;
            span.style.animationDuration = `${duration}s`;

            rc.appendChild(span);
            setTimeout(() => span.remove(), 2000);
        }
    }
});

// ================== 6. CONTROLS (VẼ & REACTION) ==================

// Toggle chế độ Vẽ
window.toggleDrawingMode = function() {
    isDrawingMode = !isDrawingMode;
    
    const toolbar = document.getElementById('drawing-toolbar');
    const btn = document.getElementById('btn-draw-toggle');
    const localBox = document.getElementById('local-box');

    if (isDrawingMode) {
        toolbar.style.display = 'flex';
        if(btn) btn.classList.add('btn-active');
        if(localBox) localBox.classList.add('drawing-active');
        
        // Tắt Reaction nếu đang mở để tránh rối mắt
        if(isReactionVisible) toggleReactionBar();
        
        resizeCanvas('local-box');
    } else {
        toolbar.style.display = 'none';
        if(btn) btn.classList.remove('btn-active');
        if(localBox) localBox.classList.remove('drawing-active');
    }
};

// Toggle thanh Reaction (MỚI)
window.toggleReactionBar = function() {
    isReactionVisible = !isReactionVisible;
    const bar = document.getElementById('reaction-bar');
    const btn = document.getElementById('btn-reaction-toggle');

    if (isReactionVisible) {
        bar.style.display = 'flex';
        if(btn) btn.classList.add('btn-active');
        
        // Tắt Drawing nếu đang mở
        if(isDrawingMode) toggleDrawingMode();
    } else {
        bar.style.display = 'none';
        if(btn) btn.classList.remove('btn-active');
    }
};

// Sự kiện các công cụ vẽ
document.getElementById('draw-color')?.addEventListener('input', (e) => drawColor = e.target.value);
document.getElementById('draw-width')?.addEventListener('input', (e) => drawWidth = e.target.value);

// Xóa bảng
document.getElementById('btn-clear-draw')?.addEventListener('click', () => {
    const canvas = document.querySelector('#local-box canvas');
    if (canvas) {
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    }
    if (currentCallId) socket.emit('call:clear_board', { conversation_id: currentCallId });
});

// Chọn loại cọ (Pen, Marker, Neon)
document.querySelectorAll('.brush-options .tool-icon').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.brush-options .tool-icon').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        currentBrushType = e.currentTarget.dataset.brush;
    });
});

// Gửi Reaction
window.sendReaction = function (emoji) {
    if (!currentCallId) return;
    socket.emit('call:send_reaction', { conversation_id: currentCallId, emoji: emoji });
};

// ================== 7. MEDIA CONTROLS ==================

window.toggleMic = () => {
    isMicOn = !isMicOn;
    if (localStream) localStream.getAudioTracks()[0].enabled = isMicOn;
    const btn = document.getElementById('btn-mic');
    if (btn) {
        btn.classList.toggle('btn-off', !isMicOn);
        btn.innerHTML = isMicOn ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
    }
};

window.toggleCam = () => {
    isCamOn = !isCamOn;
    if (localStream) localStream.getVideoTracks()[0].enabled = isCamOn;
    const btn = document.getElementById('btn-cam');
    if (btn) {
        btn.classList.toggle('btn-off', !isCamOn);
        btn.innerHTML = isCamOn ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
    }
};

window.flipCamera = async () => {
    currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
    try { await getMedia(currentFacingMode); } catch (e) { console.error(e); }
};

window.startGroupCall = startGroupCall;
window.endCall = endCall;

// Incoming Call
socket.on('call:incoming_notification', (data) => {
    const popup = document.getElementById('incoming-call-popup');
    if (!popup) return;
    const ringtone = document.getElementById('ringtone-audio');

    document.getElementById('incoming-name').textContent = data.room_name || data.caller?.username || 'Call';
    document.getElementById('incoming-avatar').src = data.caller?.avatar || '/static/img/default-avatar.png';

    popup.style.display = 'block';
    if(ringtone) ringtone.play().catch(()=>{});

    const btnAccept = document.getElementById('btn-accept-call');
    const newAccept = btnAccept.cloneNode(true);
    btnAccept.parentNode.replaceChild(newAccept, btnAccept);

    newAccept.onclick = () => {
        popup.style.display = 'none';
        if(ringtone) ringtone.pause();
        startGroupCall(data.conversation_id, data.conversation_type);
    };

    const btnDecline = document.getElementById('btn-decline-call');
    const newDecline = btnDecline.cloneNode(true);
    btnDecline.parentNode.replaceChild(newDecline, btnDecline);
    
    newDecline.onclick = () => {
        popup.style.display = 'none';
        if(ringtone) ringtone.pause();
        socket.emit('call:decline', {
             conversation_id: data.conversation_id,
             conversation_type: data.conversation_type
        });
    };
});

socket.on('call:declined', (data) => {
    if (currentCallId === data.conversation_id && isInCall) {
        const name = data.decliner?.username || 'Người kia';
        alert(`${name} đã từ chối cuộc gọi`);
        endCall();
    }
});