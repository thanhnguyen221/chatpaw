// static/js/socket/group_call.js
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

// --- BIẾN CHO TÍNH NĂNG VẼ ---
let isDrawingMode = false;
let isDrawing = false;
let drawColor = '#ff0000';
let drawWidth = 4;
let currentBrushType = 'pen';   // Mặc định: Bút tròn
let isReactionVisible = false;  // Trạng thái thanh cảm xúc
// Lưu điểm cuối cùng (normalized) của từng user remote để nối nét
const remoteStrokeState = {}; // { [from_sid]: { x, y } }


// --- UI JOIN REALTIME BUTTON ---
let currentConversationId = null;
let currentConversationType = null;
let joinRealtimeBtn = null;

const rtcConfig = {
    iceServers: [
        // STUN servers
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        // TURN servers miễn phí (nhiều server để backup)
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelay', credential: 'openrelay' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelay', credential: 'openrelay' },
        { urls: 'turn:openrelay.metered.ca:5349', username: 'openrelay', credential: 'openrelay' },
        { urls: 'turn:relay.metered.ca:80', username: 'openrelay', credential: 'openrelay' },
        { urls: 'turn:relay.metered.ca:443', username: 'openrelay', credential: 'openrelay' },
        // Backup TURN
        { urls: 'turn:turn.anyfirewall.com:443?transport=tcp', username: 'webrtc', credential: 'webrtc' },
        { urls: 'turn:turn1.xirsys.com:3478?transport=udp', username: 'openrelay', credential: 'openrelay' },
        { urls: 'turn:turn2.xirsys.com:3478?transport=udp', username: 'openrelay', credential: 'openrelay' },
        { urls: 'turn:turn3.xirsys.com:3478?transport=udp', username: 'openrelay', credential: 'openrelay' },
        { urls: 'turn:turn4.xirsys.com:3478?transport=udp', username: 'openrelay', credential: 'openrelay' }
    ],
    iceCandidatePoolSize: 10
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
        // Đã ở trong call này rồi -> chỉ mở lại overlay
        showCallOverlay();
        return;
    }

    currentCallId = conversationId;
    currentCallType = conversationType;
    isInCall = true;

    // 🔥 Nếu đang đứng đúng conversation này → bật hiệu ứng LIVE cho nút
    if (joinRealtimeBtn && currentConversationId === conversationId) {
        joinRealtimeBtn.classList.add('realtime-live');
    }

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

// ================== UI: JOIN REALTIME BUTTON ==================

function initRealtimeJoinButton() {
    if (joinRealtimeBtn) return; // đã tạo rồi

    const headerActions = document.querySelector('.header-actions');
    if (!headerActions) return;

    joinRealtimeBtn = document.createElement('button');
    joinRealtimeBtn.id = 'join-realtime-btn';
    joinRealtimeBtn.className = 'icon-button';
    joinRealtimeBtn.style.display = 'none';
    joinRealtimeBtn.innerHTML = `
        <i class="fa-solid fa-bolt"></i>
        <span class="label" style="margin-left:6px;font-size:0.9rem;">Realtime</span>
    `;

    joinRealtimeBtn.addEventListener('click', () => {
        if (!currentConversationId) return;
        // Logic:
        // - nếu chưa call -> join mới
        // - nếu đang call đúng room -> chỉ mở lại overlay
        // - nếu đang call room khác -> end call cũ + join room mới
        startGroupCall(currentConversationId, currentConversationType || 'group');
    });

    headerActions.appendChild(joinRealtimeBtn);
}

document.addEventListener('DOMContentLoaded', initRealtimeJoinButton);

// Cho file khác (chat / group) báo context hiện tại
window.setCurrentConversationForCall = function (conversationId, conversationType = 'group') {
    currentConversationId = conversationId;
    currentConversationType = conversationType;

    if (!joinRealtimeBtn) initRealtimeJoinButton();
    if (!joinRealtimeBtn) return;

    // Chỉ hiện nút cho group (nếu muốn dùng luôn cho private thì bỏ if này)
    if (conversationType === 'group') {
        joinRealtimeBtn.style.display = 'inline-flex';
    } else {
        joinRealtimeBtn.style.display = 'none';
    }

    // Nếu đang ở đúng call này thì bật hiệu ứng LIVE
    if (isInCall && currentCallId === conversationId) {
        joinRealtimeBtn.classList.add('realtime-live');
    } else {
        joinRealtimeBtn.classList.remove('realtime-live');
    }
};

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
            
            // Đồng bộ lật CSS cho Canvas
            const localCanvas = document.querySelector('#local-box canvas');
            if (localCanvas) localCanvas.style.transform = 'scaleX(-1)';

        } else {
            videoEl.classList.add('env-mode');
            videoEl.style.transform = 'none';

            // Đồng bộ lật CSS cho Canvas
            const localCanvas = document.querySelector('#local-box canvas');
            if (localCanvas) localCanvas.style.transform = 'none';
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
    if (localCanvas) {
        const ctx = localCanvas.getContext('2d');
        ctx.clearRect(0, 0, localCanvas.width, localCanvas.height);
    }

    // Reset trạng thái stroke remote
    for (const k in remoteStrokeState) {
        delete remoteStrokeState[k];
    }

    hideCallOverlay();
    currentCallId = null;
    currentCallType = null;
    isInCall = false;

    // 🔥 Reset nút Realtime: tắt LIVE nhưng vẫn HIỆN ngay nếu đang đứng ở group
    if (joinRealtimeBtn) {
        joinRealtimeBtn.classList.remove('realtime-live');
        if (currentConversationId && currentConversationType === 'group') {
            joinRealtimeBtn.style.display = 'inline-flex';
        }
    }
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
    const displayName = info.full_name || info.username || 'User';
    const label = div.querySelector('.user-label');
    if (label) {
        label.innerHTML = `<img src="${avatar}"> ${displayName}`;
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

// ================== 4. DRAWING LOGIC (FIX LỖI LẬT GƯƠNG) ==================

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
    
    // TÍNH TOÁN TỌA ĐỘ GỐC (CHƯA LẬT)
    const getCoords = (e) => {
        const rect = canvas.getBoundingClientRect();
        let clientX = e.touches ? e.touches[0].clientX : e.clientX;
        let clientY = e.touches ? e.touches[0].clientY : e.clientY;

        // Tọa độ GỐC (normalized 0-1)
        let x = (clientX - rect.left) / rect.width;
        let y = (clientY - rect.top) / rect.height;

        return { x, y }; // Trả về tọa độ GỐC (chưa lật)
    };

    const startDraw = (e) => {
        if (!isDrawingMode) return;
        isDrawing = true;
        let { x: normX, y: normY } = getCoords(e); // Lấy tọa độ GỐC

        // TÍNH TOÁN TỌA ĐỘ HIỂN THỊ CỤC BỘ (veX)
        let veX = normX;
        const isMirror = (scope === 'local' && currentFacingMode === 'user');
        if (isMirror) {
            veX = 1 - veX; // Lật X cho việc hiển thị cục bộ (gương soi)
        }
        
        // Vẽ local bằng tọa độ đã lật (veX)
        drawStroke(canvas, veX, normY, drawColor, drawWidth, 'start', currentBrushType); 
        
        // Gửi đi tọa độ GỐC (normX) - Đảm bảo người nhận vẽ đúng
        emitDraw(normX, normY, 'start');
    };

    const moveDraw = (e) => {
        if (!isDrawingMode || !isDrawing) return;
        e.preventDefault(); 
        let { x: normX, y: normY } = getCoords(e); // Lấy tọa độ GỐC

        // TÍNH TOÁN TỌA ĐỘ HIỂN THỊ CỤC BỘ (veX)
        let veX = normX;
        const isMirror = (scope === 'local' && currentFacingMode === 'user');
        if (isMirror) {
            veX = 1 - veX; // Lật X cho việc hiển thị cục bộ (gương soi)
        }

        // Vẽ local bằng tọa độ đã lật (veX)
        drawStroke(canvas, veX, normY, drawColor, drawWidth, 'move', currentBrushType); 
        
        // Gửi đi tọa độ GỐC (normX)
        emitDraw(normX, normY, 'move');
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

// HÀM VẼ NÂNG CẤP (XÓA BỎ LOGIC LẬT BÊN TRONG)
function drawStroke(canvas, normX, normY, color, width, type, brushType = 'pen') {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // normX luôn là tọa độ cuối cùng cần vẽ
    let x = normX * w;
    let y = normY * h;

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
    // Nếu server broadcast cả người gửi thì tránh tự vẽ đè lên chính mình
    if (data.from_sid === socket.id) return;

    // Nếu server có gửi conversation_id thì check đúng phòng (an toàn thêm)
    if (data.conversation_id && data.conversation_id !== currentCallId) return;

    const box = document.getElementById(`c-${data.from_sid}`);
    if (!box) return;

    const canvas = box.querySelector('canvas');
    if (!canvas) return;

    // Vẽ remote bằng hàm dùng state để nối nét
    drawRemoteStroke(canvas, data);
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
// HÀM VẼ REMOTE – DÙNG STATE ĐỂ NỐI NÉT GIỮA CÁC EVENT
function drawRemoteStroke(canvas, data) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    const nx = data.x;
    const ny = data.y;
    const type = data.type || 'move';  // nếu thiếu thì coi như move để nối nét

    const color = data.color || '#ff0000';
    const width = data.width || 4;
    const brushType = data.brush_type || 'pen';
    const fromSid = data.from_sid;

    const x = nx * w;
    const y = ny * h;

    ctx.lineWidth = width;
    ctx.strokeStyle = color;

    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (brushType === 'marker') {
        ctx.lineCap = 'square';
    } else if (brushType === 'neon') {
        ctx.shadowBlur = 15;
        ctx.shadowColor = color;
    }

    if (type === 'start') {
        // Lưu điểm bắt đầu
        remoteStrokeState[fromSid] = { x: nx, y: ny };
        ctx.beginPath();
        ctx.moveTo(x, y);

    } else if (type === 'move') {
        const last = remoteStrokeState[fromSid];

        if (!last) {
            // Nếu mất state (vd join giữa chừng) -> set lại
            remoteStrokeState[fromSid] = { x: nx, y: ny };
            ctx.beginPath();
            ctx.moveTo(x, y);
        } else {
            const lastX = last.x * w;
            const lastY = last.y * h;

            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
            ctx.lineTo(x, y);
            ctx.stroke();
            if (brushType === 'neon') ctx.stroke();

            // Update điểm cuối cùng
            remoteStrokeState[fromSid] = { x: nx, y: ny };
        }

    } else if (type === 'end') {
        delete remoteStrokeState[fromSid];
        ctx.beginPath();
    }
}


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

// Toggle thanh Reaction
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

    const callerName = data.caller?.full_name || data.caller?.username || 'Call';
    document.getElementById('incoming-name').textContent = data.room_name || callerName;
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
        const name = data.decliner?.full_name || data.decliner?.username || 'Người kia';
        alert(`${name} đã từ chối cuộc gọi`);
        endCall();
    }
});
// Khi server báo phòng call đã kết thúc (vd: người cuối cùng rời phòng)
socket.on('call:ended', (data) => {
    console.log('[Call] call:ended', data);
    if (!data) return;

    // Nếu CHÍNH MÌNH đang trong cuộc call đó → dọn dẹp nhưng KHÔNG emit leave nữa
    if (isInCall && currentCallId === data.conversation_id) {
        internalEndCall(false);
    } else {
        // Không ở trong call, nhưng đang đứng đúng group đó → đảm bảo nút trở về trạng thái "có thể bắt đầu realtime"
        if (
            data.conversation_type === 'group' &&
            joinRealtimeBtn &&
            currentConversationId === data.conversation_id
        ) {
            joinRealtimeBtn.classList.remove('realtime-live');
            joinRealtimeBtn.style.display = 'inline-flex';
        }
    }
});

