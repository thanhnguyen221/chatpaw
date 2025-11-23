// static/js/socket/group_call.js
import { socket } from "./index.js";

const peers = {};
const pendingCandidates = {};   // 🔴 FIX: Hàng đợi ICE candidate

let localStream = null;
let currentCallId = null;
let currentCallType = null;       // 'private' | 'group'
let currentFacingMode = 'user';
let isMicOn = true;
let isCamOn = true;
let isInCall = false;             // Để tránh join 2 cuộc gọi một lúc

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

    // Hiện nút flip cam trên mobile
    const btnFlip = document.getElementById('btn-flip');
    if (btnFlip && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        btnFlip.style.display = 'inline-flex';
    }
}

function hideCallOverlay() {
    const overlay = document.getElementById('call-overlay');
    if (overlay) overlay.style.display = 'none';
}

/**
 * Hàm bắt đầu cuộc gọi – dùng chung cho cả group & private
 * @param {string} conversationId 
 * @param {'private' | 'group'} conversationType 
 */
export async function startGroupCall(conversationId, conversationType = 'group') {
    console.log("[Call] Starting call:", conversationId, "type:", conversationType);

    // Nếu đang ở trong 1 cuộc gọi khác
    if (isInCall && currentCallId && currentCallId !== conversationId) {
        console.log("[Call] Already in another call, ending old call and starting new one...");
        internalEndCall(true);
    }

    // Nếu đang ở đúng call đó rồi -> chỉ cần hiện overlay lại
    if (isInCall && currentCallId === conversationId) {
        console.log("[Call] Call already active for this conversation, just showing overlay");
        showCallOverlay();
        return;
    }

    currentCallId = conversationId;
    currentCallType = conversationType;
    isInCall = true;

    showCallOverlay();

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
    // Dừng stream cũ nếu có
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }

    // Xin quyền media (🔴 ĐÃ có audio: true – giữ nguyên)
    localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: facingMode }
    });

    const videoEl = document.getElementById('local-video');
    if (videoEl) {
        videoEl.srcObject = localStream;

        // Thử play() local để chắc chắn video hiển thị (local muted nên không bị chặn)
        const playPromise = videoEl.play();
        if (playPromise !== undefined) {
            playPromise.catch(err => {
                console.warn("[Call] Autoplay blocked for local video:", err);
            });
        }

        // Lật gương nếu là cam trước
        if (facingMode === 'user') {
            videoEl.classList.remove('env-mode');
            videoEl.style.transform = 'scaleX(-1)';
        } else {
            videoEl.classList.add('env-mode');
            videoEl.style.transform = 'none';
        }
    }

    // Bật / tắt track theo trạng thái hiện tại
    const audioTrack = localStream.getAudioTracks()[0];
    const videoTrack = localStream.getVideoTracks()[0];

    if (audioTrack) audioTrack.enabled = isMicOn;
    if (videoTrack) videoTrack.enabled = isCamOn;

    // Thay track video mới cho các peer nếu đã có call
    if (currentCallId) replaceTrackInPeers();
}

function replaceTrackInPeers() {
    if (!localStream) return;
    const newVideoTrack = localStream.getVideoTracks()[0];
    if (!newVideoTrack) return;

    for (let sid in peers) {
        const sender = peers[sid]
            .getSenders()
            .find(s => s.track && s.track.kind === 'video');
        if (sender) {
            sender.replaceTrack(newVideoTrack).catch(err => {
                console.error("[Call] Error replacing track for peer", sid, err);
            });
        }
    }
}

/**
 * Hàm dọn dẹp call nội bộ
 * @param {boolean} emitLeave - có emit call:leave lên server hay không
 */
function internalEndCall(emitLeave = true) {
    if (emitLeave && currentCallId) {
        socket.emit('call:leave', { conversation_id: currentCallId });
    }

    // Dừng local stream
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }

    // Đóng tất cả peer connection
    for (let sid in peers) {
        try {
            peers[sid].close();
        } catch (err) {
            console.warn("[Call] Error closing peer", sid, err);
        }
        delete peers[sid];
    }

    // Xoá video remote
    document.querySelectorAll('.video-box:not(#local-box)').forEach(el => el.remove());

    hideCallOverlay();

    currentCallId = null;
    currentCallType = null;
    isInCall = false;
}

/**
 * Hàm endCall public – dùng cho nút "Kết thúc"
 */
export function endCall() {
    console.log("[Call] Manually ending call");
    internalEndCall(true);
}

// ================== 2. LOGIC WEBRTC (Mesh) ==================

socket.on('call:all_users', (data) => {
    console.log("[Call] call:all_users", data);
    if (!isInCall || !currentCallId) return;
    (data.users || []).forEach(uid => createPeer(uid, true));
});

socket.on('call:user_joined', (data) => {
    console.log("[Call] call:user_joined", data);
    if (!isInCall || !currentCallId) return;
    createPeer(data.signal_initiator_sid, false);
    if (data.user_info) {
        addVideoBox(data.signal_initiator_sid, data.user_info);
    }
});

socket.on('call:user_left', (data) => {
    console.log("[Call] call:user_left", data);
    removePeer(data.sid);
});

socket.on('webrtc:offer', async (data) => {
    console.log("[Call] webrtc:offer from", data.from);
    const peer = peers[data.from];
    if (!peer) {
        console.warn("[Call] Offer received but peer not found, creating peer first");
        createPeer(data.from, false);
    }
    const actualPeer = peers[data.from];
    if (!actualPeer) return;

    try {
        if (actualPeer.signalingState !== "stable") {
            // rollback để tránh conflict state
            await Promise.all([
                actualPeer.setLocalDescription({ type: "rollback" }),
                actualPeer.setRemoteDescription(new RTCSessionDescription(data.sdp))
            ]);
        } else {
            await actualPeer.setRemoteDescription(new RTCSessionDescription(data.sdp));
        }

        const answer = await actualPeer.createAnswer();
        await actualPeer.setLocalDescription(answer);
        socket.emit('webrtc:answer', { to: data.from, sdp: answer });

        // 🔴 FIX: áp ICE candidate đã queue
        if (pendingCandidates[data.from]) {
            for (const c of pendingCandidates[data.from]) {
                try {
                    await actualPeer.addIceCandidate(new RTCIceCandidate(c));
                } catch (err) {
                    console.error("[Call] Error adding queued ICE candidate (offer side):", err);
                }
            }
            delete pendingCandidates[data.from];
        }

        if (data.user_info) addVideoBox(data.from, data.user_info);
    } catch (err) {
        console.error("[Call] Error handling offer:", err);
    }
});

socket.on('webrtc:answer', async (data) => {
    console.log("[Call] webrtc:answer from", data.from);
    const peer = peers[data.from];
    if (!peer) {
        console.warn("[Call] Answer received but peer not found");
        return;
    }
    try {
        // LUÔN setRemoteDescription, không check signalingState !== 'stable'
        await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));

        // 🔴 FIX: áp ICE candidate đã queue phía gửi offer
        if (pendingCandidates[data.from]) {
            for (const c of pendingCandidates[data.from]) {
                try {
                    await peer.addIceCandidate(new RTCIceCandidate(c));
                } catch (err) {
                    console.error("[Call] Error adding queued ICE candidate (answer side):", err);
                }
            }
            delete pendingCandidates[data.from];
        }
    } catch (err) {
        console.error("[Call] Error setting remote description (answer):", err);
    }
});

socket.on('webrtc:candidate', async (data) => {
    const peer = peers[data.from];
    if (!peer) {
        console.warn("[Call] Candidate received but peer not found");
        return;
    }
    if (!data.candidate) return;

    try {
        // 🔴 FIX: Nếu chưa có remoteDescription thì queue, không add ngay để tránh lỗi "remote description was null"
        if (peer.remoteDescription && peer.remoteDescription.type) {
            await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
        } else {
            if (!pendingCandidates[data.from]) pendingCandidates[data.from] = [];
            pendingCandidates[data.from].push(data.candidate);
        }
    } catch (e) {
        console.error("[Call] Error adding ICE candidate:", e);
    }
});

function createPeer(targetSid, initiator) {
    if (peers[targetSid]) return peers[targetSid];

    const peer = new RTCPeerConnection(rtcConfig);
    peers[targetSid] = peer;

    // Add local tracks
    if (localStream) {
        localStream.getTracks().forEach(t => peer.addTrack(t, localStream));
    }

    peer.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit('webrtc:candidate', { to: targetSid, candidate: e.candidate });
        }
    };

    peer.ontrack = (e) => {
        const div = document.getElementById(`c-${targetSid}`) || createVideoDiv(targetSid);
        const vid = div.querySelector('video');
        if (vid) {
            vid.srcObject = e.streams[0] || e.streams[0];

            // 🔴 FIX: đảm bảo không muted + cố gắng play (audio remote)
            vid.muted = false;
            const playPromise = vid.play();
            if (playPromise !== undefined) {
                playPromise.catch(err => {
                    console.warn("[Call] Autoplay blocked for remote video:", err);
                });
            }
        }
    };

    if (initiator) {
        peer.createOffer()
            .then(offer => {
                return peer.setLocalDescription(offer).then(() => offer);
            })
            .then(offer => {
                socket.emit('webrtc:offer', { to: targetSid, sdp: offer });
            })
            .catch(err => {
                console.error("[Call] Error creating offer:", err);
            });
    }
    return peer;
}

function removePeer(sid) {
    if (peers[sid]) {
        try {
            peers[sid].close();
        } catch (err) {
            console.warn("[Call] Error closing peer", sid, err);
        }
        delete peers[sid];
    }
    document.getElementById(`c-${sid}`)?.remove();
}

// ================== 3. UI VIDEO & REACTION ==================

function addVideoBox(sid, info = {}) {
    let div = document.getElementById(`c-${sid}`);
    if (!div) div = createVideoDiv(sid);
    const avatar = info.avatar || '/static/img/default-avatar.png';
    const username = info.username || 'Đang kết nối...';
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
        <div class="user-label">Đang kết nối...</div>
        <div class="reaction-container"></div>
    `;
    const grid = document.getElementById('video-grid');
    if (grid) grid.appendChild(div);
    return div;
}

// Gửi Reaction
window.sendReaction = function (emoji) {
    if (!currentCallId) return;
    socket.emit('call:send_reaction', {
        conversation_id: currentCallId,
        emoji: emoji
    });
};

// Nhận Reaction (Bong bóng bay)
socket.on('call:receive_reaction', (data) => {
    // data: { from_sid, emoji }
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

// ================== 4. CONTROLS (Mic/Cam/Flip) ==================

window.toggleMic = () => {
    isMicOn = !isMicOn;
    if (localStream) {
        const track = localStream.getAudioTracks()[0];
        if (track) track.enabled = isMicOn;
    }
    const btn = document.getElementById('btn-mic');
    if (btn) {
        btn.classList.toggle('btn-off', !isMicOn);
        btn.innerHTML = isMicOn
            ? '<i class="fas fa-microphone"></i>'
            : '<i class="fas fa-microphone-slash"></i>';
    }
};

window.toggleCam = () => {
    isCamOn = !isCamOn;
    if (localStream) {
        const track = localStream.getVideoTracks()[0];
        if (track) track.enabled = isCamOn;
    }
    const btn = document.getElementById('btn-cam');
    if (btn) {
        btn.classList.toggle('btn-off', !isCamOn);
        btn.innerHTML = isCamOn
            ? '<i class="fas fa-video"></i>'
            : '<i class="fas fa-video-slash"></i>';
    }
};

window.flipCamera = async () => {
    currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
    try {
        await getMedia(currentFacingMode);
    } catch (err) {
        console.error("[Call] Error flipping camera:", err);
    }
};

socket.on('call:declined', (data) => {
    console.log("[Call] call:declined", data);

    const name = data.decliner?.username || 'Người kia';

    // Nếu mình đang gọi đúng cuộc trò chuyện đó thì thông báo + tắt cuộc gọi
    if (currentCallId === data.conversation_id && isInCall) {
        alert(`${name} đã từ chối cuộc gọi`);
        endCall();
    }
});


window.startGroupCall = startGroupCall;
window.endCall = endCall;

// ================== 5. INCOMING CALL (Phân biệt 1vs1 và Group) ==================

socket.on('call:incoming_notification', (data) => {
    console.log("[Call] incoming_notification:", data);

    const popup = document.getElementById('incoming-call-popup');
    const avatar = document.getElementById('incoming-avatar');
    const name = document.getElementById('incoming-name');
    const desc = popup ? popup.querySelector('p') : null;
    const ringtone = document.getElementById('ringtone-audio');

    if (!popup || !avatar || !name) {
        console.warn("[Call] Incoming call popup DOM not found");
        return;
    }

    // Avatar + text
    avatar.src = (data.caller && data.caller.avatar) || '/static/img/default-avatar.png';

    if (data.conversation_type === 'private') {
        name.textContent = data.caller?.username || 'Người dùng';
        if (desc) desc.textContent = 'đang gọi video cho bạn...';
    } else {
        // Group call
        name.textContent = data.room_name || 'Nhóm';
        if (desc) {
            const callerName = data.caller?.username || 'Một thành viên';
            desc.textContent = `${callerName} đang bắt đầu cuộc gọi nhóm...`;
        }
    }

    popup.style.display = 'block';

    // Phát chuông (🔴 Bây giờ call.html sẽ có thẻ audio thật)
    if (ringtone) {
        ringtone.currentTime = 0;
        ringtone.play().catch(e => console.log("Autoplay blocked:", e));
    }

    const btnAccept = document.getElementById('btn-accept-call');
    const btnDecline = document.getElementById('btn-decline-call');

    if (!btnAccept || !btnDecline) return;

    // Clear event cũ bằng clone node
    const newAccept = btnAccept.cloneNode(true);
    const newDecline = btnDecline.cloneNode(true);
    btnAccept.parentNode.replaceChild(newAccept, btnAccept);
    btnDecline.parentNode.replaceChild(newDecline, btnDecline);

    newAccept.onclick = () => {
        popup.style.display = 'none';
        if (ringtone) ringtone.pause();
        // Bắt đầu call – truyền cả loại conversation để lưu lại
        startGroupCall(data.conversation_id, data.conversation_type);
    };

    newDecline.onclick = () => {
        popup.style.display = 'none';
        if (ringtone) ringtone.pause();
        if (data.conversation_id) {
            socket.emit('call:decline', {
                conversation_id: data.conversation_id,
                conversation_type: data.conversation_type
            });
        }
    };
});
