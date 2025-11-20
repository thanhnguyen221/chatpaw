import { socket } from "./index.js"; // Đảm bảo import socket

const peers = {};
let localStream = null;
let currentCallId = null;
let currentFacingMode = 'user'; // 'user' (trước) hoặc 'environment' (sau)
let isMicOn = true;
let isCamOn = true;

// Cấu hình TURN/STUN
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelay', credential: 'openrelay' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelay', credential: 'openrelay' }
    ]
};

// --- 1. LOGIC KHỞI TẠO & GIAO DIỆN ---

// Hàm này được gọi khi bấm nút Gọi hoặc Chấp nhận
export async function startGroupCall(conversationId) {
    currentCallId = conversationId;
    
    // Hiển thị Overlay
    document.getElementById('call-overlay').style.display = 'flex';
    
    // Kiểm tra Mobile để hiện nút Lật Cam
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        document.getElementById('btn-flip').style.display = 'inline-block';
    }

    try {
        // Lấy stream (mặc định cam trước)
        await getMedia('user');
        
        // Join room
        socket.emit('call:join', { conversation_id: conversationId });
        
    } catch (e) {
        console.error(e);
        alert('Không thể truy cập Camera/Mic');
        endCall();
    }
}

async function getMedia(facingMode) {
    // Nếu đang có stream thì dừng track cũ
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
    }

    localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: facingMode } // 'user' hoặc 'environment'
    });

    const videoEl = document.getElementById('local-video');
    videoEl.srcObject = localStream;

    // Xử lý gương: Cam trước thì lật, Cam sau không lật
    if (facingMode === 'user') {
        videoEl.classList.remove('env-mode');
    } else {
        videoEl.classList.add('env-mode');
    }

    // Đồng bộ trạng thái Mic/Cam với nút bấm
    localStream.getAudioTracks()[0].enabled = isMicOn;
    localStream.getVideoTracks()[0].enabled = isCamOn;

    // Nếu đang trong cuộc gọi (Flip cam), cần thay thế track cho Peer
    if (currentCallId) {
        replaceTrackInPeers();
    }
}

// Thay thế video track cho tất cả kết nối (Khi lật cam)
function replaceTrackInPeers() {
    const newVideoTrack = localStream.getVideoTracks()[0];
    for (let sid in peers) {
        const sender = peers[sid].getSenders().find(s => s.track.kind === 'video');
        if (sender) sender.replaceTrack(newVideoTrack);
    }
}

// Hàm kết thúc gọi
export function endCall() {
    if (currentCallId) {
        socket.emit('call:leave', { conversation_id: currentCallId });
    }
    
    // Dọn dẹp
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    
    // Đóng hết peer
    for (let sid in peers) {
        peers[sid].close();
        delete peers[sid];
    }
    
    // Xóa hết video remote
    document.querySelectorAll('.video-box:not(#local-box)').forEach(el => el.remove());
    
    // Ẩn Overlay
    document.getElementById('call-overlay').style.display = 'none';
    currentCallId = null;
}

// --- 2. LOGIC WEBRTC ---

// (Giữ nguyên logic socket WebRTC Mesh như bài trước, chỉ thay đổi cách add UI)

socket.on('call:all_users', data => data.users.forEach(uid => createPeer(uid, true)));
socket.on('call:user_joined', data => {
    createPeer(data.signal_initiator_sid, false);
    addVideoBox(data.signal_initiator_sid, data.user_info);
});
socket.on('webrtc:offer', async data => {
    const peer = peers[data.from];
    if (peer) {
        await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit('webrtc:answer', { to: data.from, sdp: answer });
        if(data.user_info) addVideoBox(data.from, data.user_info);
    }
});
socket.on('webrtc:answer', async data => {
    if (peers[data.from]) await peers[data.from].setRemoteDescription(new RTCSessionDescription(data.sdp));
});
socket.on('webrtc:candidate', async data => {
    if (peers[data.from]) try { await peers[data.from].addIceCandidate(new RTCIceCandidate(data.candidate)); } catch(e){}
});
socket.on('call:user_left', data => removePeer(data.sid));


function createPeer(targetSid, initiator) {
    const peer = new RTCPeerConnection(rtcConfig);
    peers[targetSid] = peer;
    localStream.getTracks().forEach(t => peer.addTrack(t, localStream));

    peer.onicecandidate = e => {
        if (e.candidate) socket.emit('webrtc:candidate', { to: targetSid, candidate: e.candidate });
    };

    peer.ontrack = e => {
        const div = document.getElementById(`c-${targetSid}`) || createVideoDiv(targetSid);
        div.querySelector('video').srcObject = e.streams[0];
    };

    if (initiator) {
        peer.createOffer().then(offer => {
            peer.setLocalDescription(offer);
            socket.emit('webrtc:offer', { to: targetSid, sdp: offer });
        });
    }
    return peer;
}

// --- 3. XỬ LÝ UI VIDEO ---

function addVideoBox(sid, info) {
    let div = document.getElementById(`c-${sid}`);
    if (!div) div = createVideoDiv(sid);
    const avatar = info.avatar || '/static/img/default-avatar.png';
    div.querySelector('.user-label').innerHTML = `<img src="${avatar}"> ${info.username}`;
}

function createVideoDiv(sid) {
    const div = document.createElement('div');
    div.className = 'video-box';
    div.id = `c-${sid}`;
    div.innerHTML = `<video autoplay playsinline></video><div class="user-label">Kết nối...</div>`;
    document.getElementById('video-grid').appendChild(div);
    return div;
}

function removePeer(sid) {
    if (peers[sid]) { peers[sid].close(); delete peers[sid]; }
    document.getElementById(`c-${sid}`)?.remove();
}

// --- 4. XỬ LÝ NÚT BẤM (Gán vào window để HTML gọi được) ---

window.toggleMic = () => {
    isMicOn = !isMicOn;
    if (localStream) localStream.getAudioTracks()[0].enabled = isMicOn;
    document.getElementById('btn-mic').classList.toggle('btn-off', !isMicOn);
};

window.toggleCam = () => {
    isCamOn = !isCamOn;
    if (localStream) localStream.getVideoTracks()[0].enabled = isCamOn;
    document.getElementById('btn-cam').classList.toggle('btn-off', !isCamOn);
};

// Lật Camera (Logic mới)
window.flipCamera = async () => {
    currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
    await getMedia(currentFacingMode);
};

window.endCall = endCall;

// --- 5. XỬ LÝ LỜI MỜI (INCOMING) ---

socket.on('call:incoming_notification', (data) => {
    // data: { caller, conversation_id, conversation_type }
    
    // Hiển thị Popup
    const popup = document.getElementById('incoming-call-popup');
    const avatar = document.getElementById('incoming-avatar');
    const name = document.getElementById('incoming-name');
    const btnAccept = document.getElementById('btn-accept-call');
    const btnDecline = document.getElementById('btn-decline-call');

    avatar.src = data.caller.avatar || '/static/img/default-avatar.png';
    name.textContent = data.caller.username;
    popup.style.display = 'block';

    // Xử lý nút Chấp nhận
    btnAccept.onclick = () => {
        popup.style.display = 'none';
        startGroupCall(data.conversation_id);
    };

    // Xử lý nút Từ chối
    btnDecline.onclick = () => {
        popup.style.display = 'none';
        // Có thể emit sự kiện từ chối nếu muốn
    };
});
window.startGroupCall = startGroupCall;