// static/js/call.js
import { socket } from "./index.js";

// --- BIẾN TOÀN CỤC ---
const peers = {};                 // Lưu nhiều RTCPeerConnection theo sid
let localStream = null;
let currentCallId = null;         // id cuộc trò chuyện (group_id hoặc conversation_id 1-1)
let currentCallType = null;       // 'private' | 'group'
let currentFacingMode = 'user';   // 'user' (cam trước) | 'environment' (cam sau)
let isMicOn = true;
let isCamOn = true;
let isInCall = false;             // Đang ở trong cuộc gọi nào đó hay không

// Cấu hình TURN/STUN (Để chạy qua Ngrok/4G)
const rtcConfig = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "turn:openrelay.metered.ca:80", username: "openrelay", credential: "openrelay" },
        { urls: "turn:openrelay.metered.ca:443", username: "openrelay", credential: "openrelay" }
    ]
};

// ==================================================
// 1. LOGIC KHỞI TẠO & ĐIỀU KHIỂN (Giao diện Overlay)
// ==================================================

export async function startGroupCall(conversationId, conversationType = "group") {
    console.log("[Call] Starting call for:", conversationId, "type:", conversationType);

    // Nếu đang ở trong 1 cuộc gọi khác
    if (isInCall && currentCallId && currentCallId !== conversationId) {
        console.log("[Call] Already in another call, ending old call first...");
        endCall();
    }

    // Nếu đang gọi đúng cuộc trò chuyện đó rồi → chỉ hiện lại overlay
    if (isInCall && currentCallId === conversationId) {
        const overlayExist = document.getElementById("call-overlay");
        if (overlayExist) overlayExist.style.display = "flex";
        return;
    }

    currentCallId = conversationId;
    currentCallType = conversationType;
    isInCall = true;

    const overlay = document.getElementById("call-overlay");
    if (overlay) overlay.style.display = "flex";

    // Mobile: hiện nút flip
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        const btnFlip = document.getElementById("btn-flip");
        if (btnFlip) btnFlip.style.display = "inline-block";
    }

    try {
        await getMedia("user");
        socket.emit("call:join", { conversation_id: conversationId });
    } catch (e) {
        console.error("[Call] Lỗi lấy Media:", e);
        alert("Không thể truy cập Camera/Mic. Hãy kiểm tra quyền truy cập.");
        endCall();
    }
}

// Hàm lấy Media (Hỗ trợ lật cam)
async function getMedia(facingMode) {
    // Nếu đang có stream cũ thì dừng các track
    if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
        localStream = null;
    }

    console.log("[Call] Getting media with mode:", facingMode);

    localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: facingMode }
    });

    // Gắn vào video của mình
    const videoEl = document.getElementById("local-video");
    if (videoEl) {
        videoEl.srcObject = localStream;
        // Xử lý gương: Cam trước thì lật, Cam sau không lật
        if (facingMode === "user") {
            videoEl.classList.remove("env-mode");
            videoEl.style.transform = "scaleX(-1)";
        } else {
            videoEl.classList.add("env-mode");
            videoEl.style.transform = "none";
        }
    }

    // Đồng bộ trạng thái Mic/Cam với nút bấm hiện tại
    const audioTrack = localStream.getAudioTracks()[0];
    const videoTrack = localStream.getVideoTracks()[0];
    if (audioTrack) audioTrack.enabled = isMicOn;
    if (videoTrack) videoTrack.enabled = isCamOn;

    // Nếu đang trong cuộc gọi (đã có peers), cần cập nhật track cho đối phương
    if (Object.keys(peers).length > 0) {
        replaceTrackInPeers();
    }
}

// Thay thế video track gửi đi (khi lật cam) cho TẤT CẢ kết nối
function replaceTrackInPeers() {
    if (!localStream) return;
    const newVideoTrack = localStream.getVideoTracks()[0];
    if (!newVideoTrack) return;

    for (let sid in peers) {
        const sender = peers[sid]
            .getSenders()
            .find((s) => s.track && s.track.kind === "video");
        if (sender) {
            sender.replaceTrack(newVideoTrack).catch((err) => {
                console.error("[Call] Error replacing track for peer", sid, err);
            });
        }
    }
}

// Hàm kết thúc gọi (Dọn dẹp)
export function endCall() {
    console.log("[Call] Ending call...");

    const convId = currentCallId;

    // Reset state trước, tránh race
    currentCallId = null;
    currentCallType = null;
    isInCall = false;

    if (convId) {
        socket.emit("call:leave", { conversation_id: convId });
    }

    // Dừng Camera/Mic
    if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
        localStream = null;
    }

    // Đóng tất cả RTCPeerConnection
    for (let sid in peers) {
        try {
            peers[sid].close();
        } catch (err) {
            console.warn("[Call] Error closing peer", sid, err);
        }
        delete peers[sid];
    }

    // Xóa video của người khác trên màn hình
    document
        .querySelectorAll(".video-box:not(#local-box)")
        .forEach((el) => el.remove());

    // Ẩn Overlay
    const overlay = document.getElementById("call-overlay");
    if (overlay) overlay.style.display = "none";
}

// ==================================================
// 2. LOGIC SOCKET WEBRTC (MESH TOPOLOGY)
// ==================================================

// A. Vào phòng -> Nhận danh sách người đang có mặt -> Gọi cho họ
socket.on("call:all_users", (data) => {
    if (!isInCall || !currentCallId) return;
    console.log("[Call] Users in room:", data.users);
    (data.users || []).forEach((uid) => createPeer(uid, true)); // true = mình là người gọi (Initiator)
});

// B. Có người mới vào -> Chuẩn bị nhận cuộc gọi
socket.on("call:user_joined", (data) => {
    if (!isInCall || !currentCallId) return;
    console.log("[Call] User joined:", data.user_info);
    createPeer(data.signal_initiator_sid, false); // false = mình là người nhận
    if (data.user_info) addVideoBox(data.signal_initiator_sid, data.user_info);
});

// C. Tín hiệu OFFER
socket.on("webrtc:offer", async (data) => {
    if (!isInCall || !currentCallId) return;

    let peer = peers[data.from];
    if (!peer) {
        console.warn("[Call] Offer received but peer not found, creating peer...");
        peer = createPeer(data.from, false); // false = mình là bên nhận
    }

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
        socket.emit("webrtc:answer", { to: data.from, sdp: answer });

        if (data.user_info) addVideoBox(data.from, data.user_info);
    } catch (err) {
        console.error("[Call] Error handling offer:", err);
    }
});

// D. Tín hiệu ANSWER
socket.on("webrtc:answer", async (data) => {
    if (!isInCall || !currentCallId) return;

    const peer = peers[data.from];
    if (!peer) {
        console.warn("[Call] Answer received but peer not found");
        return;
    }

    try {
        // Nếu đã stable rồi thì không set answer nữa để tránh InvalidStateError
        if (peer.signalingState === "stable") {
            console.warn("[Call] Ignored answer because state is stable");
            return;
        }
        await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } catch (err) {
        console.error("[Call] Error setting remote description (answer):", err);
    }
});

// E. Tín hiệu CANDIDATE
socket.on("webrtc:candidate", async (data) => {
    if (!isInCall || !currentCallId) return;

    const peer = peers[data.from];
    if (!peer) {
        console.warn("[Call] Candidate received but peer not found");
        return;
    }

    try {
        if (data.candidate) {
            await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    } catch (e) {
        console.error("[Call] Error adding ICE candidate:", e);
    }
});

// F. Người khác rời đi
socket.on("call:user_left", (data) => {
    console.log("[Call] call:user_left", data);
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
        localStream.getTracks().forEach((t) => peer.addTrack(t, localStream));
    }

    // Gửi ICE Candidate
    peer.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit("webrtc:candidate", { to: targetSid, candidate: e.candidate });
        }
    };

    // Khi nhận được Stream của đối phương
    peer.ontrack = (e) => {
        const div = document.getElementById(`c-${targetSid}`) || createVideoDiv(targetSid);
        const vid = div.querySelector("video");
        if (vid && vid.srcObject !== e.streams[0]) {
            vid.srcObject = e.streams[0];
        }
    };

    // Tạo Offer nếu là người chủ động
    if (initiator) {
        peer
            .createOffer()
            .then((offer) => {
                return peer.setLocalDescription(offer).then(() => offer);
            })
            .then((offer) => {
                socket.emit("webrtc:offer", { to: targetSid, sdp: offer });
            })
            .catch((err) => {
                console.error("[Call] Error creating offer:", err);
            });
    }

    return peer;
}

// Tạo khung video cho người khác
function addVideoBox(sid, info = {}) {
    let div = document.getElementById(`c-${sid}`);
    if (!div) div = createVideoDiv(sid);

    const avatar = info.avatar || "/static/img/default-avatar.png";
    const name = info.username || "User";

    const label = div.querySelector(".user-label");
    if (label) {
        label.innerHTML = `<img src="${avatar}" style="width:20px;height:20px;border-radius:50%"> ${name}`;
    }

    if (!div.querySelector(".reaction-container")) {
        const rc = document.createElement("div");
        rc.className = "reaction-container";
        div.appendChild(rc);
    }
}

function createVideoDiv(sid) {
    const div = document.createElement("div");
    div.className = "video-box";
    div.id = `c-${sid}`;
    div.innerHTML = `
        <video autoplay playsinline></video>
        <div class="user-label">Đang kết nối...</div>
        <div class="reaction-container"></div>
    `;
    const grid = document.getElementById("video-grid");
    if (grid) grid.appendChild(div);
    return div;
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
    const el = document.getElementById(`c-${sid}`);
    if (el) el.remove();
}

// ==================================================
// 4. GẮN SỰ KIỆN VÀO WINDOW (Để HTML gọi được)
// ==================================================

window.toggleMic = () => {
    isMicOn = !isMicOn;
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) audioTrack.enabled = isMicOn;
    }

    const btn = document.getElementById("btn-mic");
    if (btn) {
        btn.classList.toggle("btn-off", !isMicOn);
        btn.innerHTML = isMicOn
            ? '<i class="fas fa-microphone"></i>'
            : '<i class="fas fa-microphone-slash"></i>';
    }
};

window.toggleCam = () => {
    isCamOn = !isCamOn;
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) videoTrack.enabled = isCamOn;
    }

    const btn = document.getElementById("btn-cam");
    if (btn) {
        btn.classList.toggle("btn-off", !isCamOn);
        btn.innerHTML = isCamOn
            ? '<i class="fas fa-video"></i>'
            : '<i class="fas fa-video-slash"></i>';
    }
};

// Lật Camera (Cam trước/sau)
window.flipCamera = async () => {
    currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
    try {
        await getMedia(currentFacingMode);
    } catch (err) {
        console.error("[Call] Error flipping camera:", err);
    }
};

// Gửi Reaction
window.sendReaction = function (emoji) {
    if (!currentCallId) return;
    socket.emit("call:send_reaction", {
        conversation_id: currentCallId,
        emoji: emoji
    });
};

// Kết thúc gọi
window.endCall = endCall;

// Expose startGroupCall để file khác (group.js / private chat) gọi
window.startGroupCall = startGroupCall;

// ==================================================
// 5. XỬ LÝ LỜI MỜI & REACTION
// ==================================================

socket.on("call:incoming_notification", (data) => {
    const popup = document.getElementById("incoming-call-popup");
    const avatar = document.getElementById("incoming-avatar");
    const name = document.getElementById("incoming-name");
    const desc = popup ? popup.querySelector("p") : null;
    const btnAccept = document.getElementById("btn-accept-call");
    const btnDecline = document.getElementById("btn-decline-call");
    const ringtone = document.getElementById("ringtone-audio");

    if (popup && avatar && name && btnAccept && btnDecline) {
        avatar.src = data.caller?.avatar || "/static/img/default-avatar.png";

        if (data.conversation_type === "group") {
            name.textContent = data.room_name || "Cuộc gọi nhóm";
            if (desc) {
                const callerName = data.caller?.username || "Một thành viên";
                desc.textContent = `${callerName} đang bắt đầu cuộc gọi nhóm...`;
            }
        } else {
            name.textContent = data.caller?.username || "Người dùng";
            if (desc) desc.textContent = "đang gọi video cho bạn...";
        }

        popup.style.display = "block";

        if (ringtone) {
            ringtone.currentTime = 0;
            ringtone.play().catch(() => console.log("Autoplay blocked"));
        }

        btnAccept.onclick = () => {
            popup.style.display = "none";
            if (ringtone) ringtone.pause();
            // Truyền luôn conversation_type để lưu lại
            startGroupCall(data.conversation_id, data.conversation_type);
        };

        btnDecline.onclick = () => {
            popup.style.display = "none";
            if (ringtone) ringtone.pause();
            socket.emit("call:decline", {
                conversation_id: data.conversation_id,
                conversation_type: data.conversation_type
            });
        };
    }
});

// Nhận Reaction bong bóng
socket.on("call:receive_reaction", (data) => {
    let containerId = data.from_sid === socket.id ? "local-box" : `c-${data.from_sid}`;
    const videoBox = document.getElementById(containerId);

    if (videoBox) {
        let rc = videoBox.querySelector(".reaction-container");
        if (!rc) {
            rc = document.createElement("div");
            rc.className = "reaction-container";
            videoBox.appendChild(rc);
        }

        // Tạo hiệu ứng bong bóng
        const count = Math.floor(Math.random() * 5) + 10;
        for (let i = 0; i < count; i++) {
            const span = document.createElement("span");
            span.className = "floating-emoji";
            span.textContent = data.emoji;
            span.style.left = `${Math.random() * 100}%`;
            span.style.animationDelay = `${Math.random() * 0.5}s`;
            span.style.animationDuration = `${1.5 + Math.random()}s`;
            rc.appendChild(span);
            setTimeout(() => span.remove(), 2000);
        }
    }
});

// Người khác từ chối cuộc gọi
socket.on("call:declined", (data) => {
    console.log("[Call] call:declined:", data);
    const name = data.decliner?.username || "Người dùng";

    // Tạm thời dùng alert cho dễ debug
    alert(`❌ ${name} đã từ chối cuộc gọi.`);

    // Nếu là 1-1, bạn có thể thêm logic đóng popup "đang gọi..." tại đây.
});

// (Tuỳ chọn) Nếu sau này bạn dùng 'call:status_update' để update icon call trong danh sách chat,
// có thể handle event ở 1 file khác (vd: chat_sidebar.js) hoặc ngay tại đây.
