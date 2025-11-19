import { socket } from "./index.js";

// --- BIẾN TOÀN CỤC ---
const peers = {}; // QUAN TRỌNG: Lưu nhiều kết nối thay vì 1 biến pc
let localStream = null;
let currentCallId = null;
let currentFacingMode = 'user'; // 'user' (trước) | 'environment' (sau)
let isMicOn = true;
let isCamOn = true;

// Cấu hình TURN/STUN (Để chạy qua Ngrok/4G)
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelay', credential: 'openrelay' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelay', credential: 'openrelay' }
    ]
};

// ==================================================
// 1. LOGIC KHỞI TẠO & ĐIỀU KHIỂN (Giao diện Overlay)
// ==================================================

// Hàm này được gọi từ group.js (khi bấm nút gọi) hoặc từ Popup lời mời
export async function startGroupCall(conversationId) {
    console.log("[Call] Starting call for:", conversationId);
    currentCallId = conversationId;
    
    // 1. Hiển thị Overlay (Khung gọi đè lên trang)
    const overlay = document.getElementById('call-overlay');
    if(overlay) overlay.style.display = 'flex';
    
    // 2. Kiểm tra Mobile để hiện nút Lật Cam
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        const btnFlip = document.getElementById('btn-flip');
        if(btnFlip) btnFlip.style.display = 'inline-block';
    }

    try {
        // 3. Lấy stream (mặc định cam trước)
        await getMedia('user');
        
        // 4. Join room socket
        socket.emit('call:join', { conversation_id: conversationId });
        
    } catch (e) {
        console.error("Lỗi lấy Media:", e);
        alert('Không thể truy cập Camera/Mic. Hãy kiểm tra quyền truy cập.');
        endCall();
    }
}

// Hàm lấy Media (Hỗ trợ lật cam)
async function getMedia(facingMode) {
    // Nếu đang có stream cũ thì dừng các track
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
    }

    console.log("[Call] Getting media with mode:", facingMode);

    localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: facingMode }
    });

    // Gắn vào video của mình
    const videoEl = document.getElementById('local-video');
    if(videoEl) {
        videoEl.srcObject = localStream;
        // Xử lý gương: Cam trước thì lật, Cam sau không lật
        if (facingMode === 'user') {
            videoEl.classList.remove('env-mode'); // Class CSS xử lý gương
            videoEl.style.transform = 'scaleX(-1)';
        } else {
            videoEl.classList.add('env-mode');
            videoEl.style.transform = 'none';
        }
    }

    // Đồng bộ trạng thái Mic/Cam với nút bấm hiện tại
    localStream.getAudioTracks()[0].enabled = isMicOn;
    localStream.getVideoTracks()[0].enabled = isCamOn;

    // Nếu đang trong cuộc gọi (tức là đang lật cam giữa chừng), cần cập nhật track cho đối phương
    if (Object.keys(peers).length > 0) {
        replaceTrackInPeers();
    }
}

// Thay thế video track gửi đi (khi lật cam) cho TẤT CẢ kết nối
function replaceTrackInPeers() {
    const newVideoTrack = localStream.getVideoTracks()[0];
    for (let sid in peers) {
        const sender = peers[sid].getSenders().find(s => s.track.kind === 'video');
        if (sender) {
            sender.replaceTrack(newVideoTrack);
        }
    }
}

// Hàm kết thúc gọi (Dọn dẹp)
export function endCall() {
    console.log("[Call] Ending call...");
    
    if (currentCallId) {
        socket.emit('call:leave', { conversation_id: currentCallId });
    }
    
    // Dừng Camera/Mic
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    
    // Đóng kết nối WebRTC
    for (let sid in peers) {
        peers[sid].close();
        delete peers[sid];
    }
    
    // Xóa video của người khác trên màn hình
    document.querySelectorAll('.video-box:not(#local-box)').forEach(el => el.remove());
    
    // Ẩn Overlay
    const overlay = document.getElementById('call-overlay');
    if(overlay) overlay.style.display = 'none';
    
    currentCallId = null;
}

// ==================================================
// 2. LOGIC SOCKET WEBRTC (MESH TOPOLOGY - Sửa lỗi InvalidStateError)
// ==================================================

// A. Vào phòng -> Nhận danh sách người đang có mặt -> Gọi cho họ
socket.on('call:all_users', data => {
    console.log("[Call] Users in room:", data.users);
    data.users.forEach(uid => createPeer(uid, true)); // true = mình là người gọi (Initiator)
});

// B. Có người mới vào -> Chuẩn bị nhận cuộc gọi
socket.on('call:user_joined', data => {
    console.log("[Call] User joined:", data.user_info);
    createPeer(data.signal_initiator_sid, false); // false = mình là người nhận
    addVideoBox(data.signal_initiator_sid, data.user_info);
});

// C. Tín hiệu OFFER
socket.on('webrtc:offer', async data => {
    const peer = peers[data.from];
    if (peer) {
        // FIX LỖI: Kiểm tra trạng thái trước khi set remote
        if (peer.signalingState !== "stable") {
             // Nếu đang bận, rollback hoặc ignore để tránh lỗi
             await Promise.all([
                peer.setLocalDescription({type: "rollback"}),
                peer.setRemoteDescription(new RTCSessionDescription(data.sdp))
            ]);
        } else {
            await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));
        }
        
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit('webrtc:answer', { to: data.from, sdp: answer });
        
        if(data.user_info) addVideoBox(data.from, data.user_info);
    }
});

// D. Tín hiệu ANSWER (FIX LỖI InvalidStateError tại đây)
socket.on('webrtc:answer', async data => {
    const peer = peers[data.from];
    if (peer) {
        // FIX LỖI: Nếu đã stable rồi thì không set answer nữa
        if (peer.signalingState === 'stable') {
            console.warn("[Call] Ignored answer because state is stable");
            return;
        }
        await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));
    }
});

// E. Tín hiệu CANDIDATE
socket.on('webrtc:candidate', async data => {
    const peer = peers[data.from];
    if (peer) {
        try { 
            await peer.addIceCandidate(new RTCIceCandidate(data.candidate)); 
        } catch(e) { console.error(e); }
    }
});

// F. Người khác rời đi
socket.on('call:user_left', data => {
    removePeer(data.sid);
});


// ==================================================
// 3. CÁC HÀM HỖ TRỢ WEBRTC & UI
// ==================================================

function createPeer(targetSid, initiator) {
    // Nếu đã tồn tại kết nối, dùng lại (tránh tạo trùng)
    if (peers[targetSid]) return peers[targetSid];

    const peer = new RTCPeerConnection(rtcConfig);
    peers[targetSid] = peer;

    // Thêm track của mình vào kết nối
    if (localStream) {
        localStream.getTracks().forEach(t => peer.addTrack(t, localStream));
    }

    // Gửi ICE Candidate
    peer.onicecandidate = e => {
        if (e.candidate) socket.emit('webrtc:candidate', { to: targetSid, candidate: e.candidate });
    };

    // Khi nhận được Stream của đối phương
    peer.ontrack = e => {
        const div = document.getElementById(`c-${targetSid}`) || createVideoDiv(targetSid);
        const vid = div.querySelector('video');
        if(vid && vid.srcObject !== e.streams[0]) {
            vid.srcObject = e.streams[0];
        }
    };

    // Tạo Offer nếu là người chủ động
    if (initiator) {
        peer.createOffer().then(offer => {
            peer.setLocalDescription(offer);
            socket.emit('webrtc:offer', { to: targetSid, sdp: offer });
        });
    }
    return peer;
}

// Tạo khung video cho người khác
function addVideoBox(sid, info) {
    let div = document.getElementById(`c-${sid}`);
    if (!div) div = createVideoDiv(sid);
    
    const avatar = info.avatar || '/static/img/default-avatar.png';
    const name = info.username || 'User';
    
    // Cập nhật label và thêm container Reaction nếu chưa có
    div.querySelector('.user-label').innerHTML = `<img src="${avatar}" style="width:20px;height:20px;border-radius:50%"> ${name}`;
    
    if (!div.querySelector('.reaction-container')) {
        const rc = document.createElement('div');
        rc.className = 'reaction-container';
        div.appendChild(rc);
    }
}

function createVideoDiv(sid) {
    const div = document.createElement('div');
    div.className = 'video-box'; // Class trùng với CSS mới
    div.id = `c-${sid}`;
    div.innerHTML = `
        <video autoplay playsinline></video>
        <div class="user-label">Đang kết nối...</div>
        <div class="reaction-container"></div>
    `;
    document.getElementById('video-grid').appendChild(div);
    return div;
}

function removePeer(sid) {
    if (peers[sid]) { peers[sid].close(); delete peers[sid]; }
    document.getElementById(`c-${sid}`)?.remove();
}

// ==================================================
// 4. GẮN SỰ KIỆN VÀO WINDOW (Để HTML gọi được)
// ==================================================

// Bật/Tắt Mic
window.toggleMic = () => {
    isMicOn = !isMicOn;
    if (localStream) localStream.getAudioTracks()[0].enabled = isMicOn;
    
    const btn = document.getElementById('btn-mic');
    btn.classList.toggle('btn-off', !isMicOn);
    btn.innerHTML = isMicOn ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
};

// Bật/Tắt Camera
window.toggleCam = () => {
    isCamOn = !isCamOn;
    if (localStream) localStream.getVideoTracks()[0].enabled = isCamOn;
    
    const btn = document.getElementById('btn-cam');
    btn.classList.toggle('btn-off', !isCamOn);
    btn.innerHTML = isCamOn ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
};

// Lật Camera (Cam trước/sau)
window.flipCamera = async () => {
    currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
    await getMedia(currentFacingMode);
};

// Gửi Reaction
window.sendReaction = function(emoji) {
    if (!currentCallId) return;
    socket.emit('call:send_reaction', {
        conversation_id: currentCallId,
        emoji: emoji
    });
};

// Kết thúc gọi
window.endCall = endCall;

// Expose startGroupCall để file group.js gọi
window.startGroupCall = startGroupCall;

// ==================================================
// 5. XỬ LÝ LỜI MỜI & REACTION
// ==================================================

socket.on('call:incoming_notification', (data) => {
    const popup = document.getElementById('incoming-call-popup');
    const avatar = document.getElementById('incoming-avatar');
    const name = document.getElementById('incoming-name');
    const btnAccept = document.getElementById('btn-accept-call');
    const btnDecline = document.getElementById('btn-decline-call');
    const ringtone = document.getElementById('ringtone-audio');

    if (popup && avatar && name) {
        avatar.src = data.caller.avatar || '/static/img/default-avatar.png';
        name.textContent = data.caller.username;
        popup.style.display = 'block';

        if(ringtone) {
            ringtone.currentTime = 0;
            ringtone.play().catch(e => console.log("Autoplay blocked"));
        }

        btnAccept.onclick = () => {
            popup.style.display = 'none';
            if(ringtone) ringtone.pause();
            startGroupCall(data.conversation_id);
        };

        btnDecline.onclick = () => {
            popup.style.display = 'none';
            if(ringtone) ringtone.pause();
            socket.emit('call:decline', { conversation_id: data.conversation_id });
        };
    }
});

// Nhận Reaction bong bóng
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
        
        // Tạo hiệu ứng bong bóng
        const count = Math.floor(Math.random() * 5) + 10; 
        for (let i = 0; i < count; i++) {
            const span = document.createElement('span');
            span.className = 'floating-emoji';
            span.textContent = data.emoji;
            span.style.left = `${Math.random() * 100}%`;
            span.style.animationDelay = `${Math.random() * 0.5}s`;
            span.style.animationDuration = `${1.5 + Math.random()}s`;
            rc.appendChild(span);
            setTimeout(() => span.remove(), 2000);
        }
    }
});