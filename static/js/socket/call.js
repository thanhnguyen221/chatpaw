// static/js/socket/call.js
import { socket } from "./index.js";

// --- BIẾN TOÀN CỤC CHO CALL ---
const peers = {};                 // Lưu nhiều RTCPeerConnection theo sid
let localStream = null;
let currentCallId = null;         // id cuộc trò chuyện (group_id hoặc conversation_id 1-1)
let currentCallType = null;       // 'private' | 'group'
let currentCallMode = 'video';    // 'video' | 'audio' - chế độ cuộc gọi hiện tại
let currentFacingMode = "user";   // 'user' (cam trước) | 'environment' (cam sau)
let isMicOn = true;
let isCamOn = true;
let isInCall = false;             // Đang ở trong cuộc gọi nào đó hay không
const pendingCandidates = {};     // Hàng đợi ICE cho từng peer

// 🔹 NEW: Quản lý trạng thái mời / từ chối / host
const declinedConversations = new Set();           // Những cuộc gọi mình đã bấm Từ chối
const handledIncomingConversations = new Set();    // Những incoming popup mình đã xử lý (accept/decline)
let isCurrentUserCallInitiator = false;            // Có phải người bắt đầu cuộc gọi hiện tại không
let currentDbCallId = null;

// --- BIẾN CHO TÍNH NĂNG VẼ & REACTION ---
let isDrawingMode = false;
let isDrawing = false;
let drawColor = "#ff0000";
let drawWidth = 4;
let currentBrushType = "pen";     // 'pen' | 'marker' | 'neon'
let isReactionVisible = false;

let drawingInitialized = false;
let drawingCanvas = null;
let drawingCtx = null;

// Cấu hình TURN/STUN (Để chạy qua tunnel/4G/NAT)
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

// ==================================================
// 0. HÀM HELPER EXPORT CHO SCREEN SHARE
// ==================================================

// Cho screen_share.js lấy stream hiện tại
export function getLocalStream() {
    return localStream;
}

// Cho screen_share.js set lại preview cho video local
export function setLocalPreviewStream(stream, options = {}) {
    const videoEl = document.getElementById("local-video");
    if (!videoEl) return;

    const isScreenShare = !!options.isScreenShare;

    if (!stream) {
        videoEl.srcObject = null;
        // Clear mirror để không giữ style cũ
        videoEl.classList.remove("mirror-video");
        return;
    }

    videoEl.srcObject = stream;

    // 🔁 Camera: soi gương, Screen share: không soi gương
    if (isScreenShare) {
        videoEl.classList.remove("mirror-video");
    } else {
        videoEl.classList.add("mirror-video");
    }
}

// Cho screen_share.js (và nội bộ) thay video track gửi đi cho TẤT CẢ peer
export function replaceVideoTrackInPeers(newVideoTrack) {
    if (!newVideoTrack) return;
    for (let sid in peers) {
        const sender = peers[sid]
            .getSenders()
            .find((s) => s.track && s.track.kind === "video");
        if (sender) {
            sender.replaceTrack(newVideoTrack).catch((err) => {
                console.error("[Call] Error replacing video track for peer", sid, err);
            });
        }
    }
}

// ==================================================
// 0.1 HÀM KHỞI TẠO CANVAS VẼ
// ==================================================

function initDrawingCanvas() {
    if (drawingInitialized) return;

    const localBox = document.getElementById("local-box");
    if (!localBox) return;

    drawingCanvas = localBox.querySelector(".drawing-canvas");
    if (!drawingCanvas) return;

    drawingCtx = drawingCanvas.getContext("2d");

    const resizeCanvas = () => {
        if (!drawingCanvas) return;
        const rect = drawingCanvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        // Kích thước thực của canvas = đúng kích thước hiển thị
        drawingCanvas.width  = Math.round(rect.width);
        drawingCanvas.height = Math.round(rect.height);

        drawingCtx.lineCap = "round";
        drawingCtx.lineJoin = "round";
        drawingCtx.lineWidth = drawWidth;
        drawingCtx.strokeStyle = drawColor;
    };

    // Gọi 1 lần khi overlay hiển thị
    resizeCanvas();

    // 🔍 Khi kích thước video-box thay đổi (do layout đổi vì thêm người vào), canvas tự resize theo
    if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => resizeCanvas());
        ro.observe(localBox);
    } else {
        window.addEventListener("resize", resizeCanvas);
    }

    attachDrawingEvents();
    setupBrushControls();

    // Mặc định chưa bật vẽ → không nhận pointer
    drawingCanvas.style.pointerEvents = "none";

    drawingInitialized = true;
}

function setupBrushControls() {
    // Màu vẽ
    const colorInput = document.getElementById("draw-color");
    if (colorInput) {
        colorInput.addEventListener("change", (e) => {
            drawColor = e.target.value || "#ff0000";
        });
    }

    // Độ dày nét
    const widthInput = document.getElementById("draw-width");
    if (widthInput) {
        widthInput.addEventListener("input", (e) => {
            const val = parseInt(e.target.value, 10);
            if (!Number.isNaN(val)) {
                drawWidth = val;
            }
        });
    }

    // Chọn loại bút
    const brushButtons = document.querySelectorAll(".brush-options .tool-icon");
    if (brushButtons && brushButtons.length > 0) {
        brushButtons.forEach((btn) => {
            btn.addEventListener("click", () => {
                brushButtons.forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                const type = btn.getAttribute("data-brush") || "pen";
                currentBrushType = type;
            });
        });
    }

    // Nút xóa canvas
    const clearBtn = document.getElementById("btn-clear-draw");
    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            // Nếu không có cuộc gọi, chỉ xoá local
            if (!currentCallId) {
                clearAllDrawingCanvas();
                return;
            }

            // Gửi lệnh clear cho cả phòng
            socket.emit("call:clear_board", {
                conversation_id: currentCallId
            });

            // Clear local ngay lập tức
            clearAllDrawingCanvas();
        });
    }
}

function attachDrawingEvents() {
    if (!drawingCanvas) return;

    let lastX = null;
    let lastY = null;

    const getPos = (evt) => {
        // Mobile (touch)
        if (evt.touches && evt.touches[0]) {
            const rect = drawingCanvas.getBoundingClientRect();
            return {
                x: evt.touches[0].clientX - rect.left,
                y: evt.touches[0].clientY - rect.top
            };
        }

        // Desktop (mouse) → ưu tiên offsetX/offsetY
        if (typeof evt.offsetX === "number" && typeof evt.offsetY === "number") {
            return {
                x: evt.offsetX,
                y: evt.offsetY
            };
        }

        // Fallback
        const rect = drawingCanvas.getBoundingClientRect();
        return {
            x: evt.clientX - rect.left,
            y: evt.clientY - rect.top
        };
    };

    const applyBrushStyle = () => {
        if (!drawingCtx) return;
        drawingCtx.strokeStyle = drawColor;
        drawingCtx.lineWidth = drawWidth;
        drawingCtx.globalAlpha = 1;
        drawingCtx.shadowBlur = 0;
        drawingCtx.shadowColor = "transparent";

        if (currentBrushType === "marker") {
            drawingCtx.lineCap = "square";
            drawingCtx.lineJoin = "miter";
        } else {
            drawingCtx.lineCap = "round";
            drawingCtx.lineJoin = "round";
        }

        if (currentBrushType === "neon") {
            drawingCtx.globalAlpha = 0.8;
            drawingCtx.shadowBlur = 10;
            drawingCtx.shadowColor = drawColor;
        }
    };

    const handlePointerDown = (e) => {
        if (!isDrawingMode || !drawingCtx) return;
        e.preventDefault();
        isDrawing = true;
        applyBrushStyle();
        const { x, y } = getPos(e);
        lastX = x;
        lastY = y;
    };

    const handlePointerMove = (e) => {
        if (!isDrawing || !isDrawingMode || !drawingCtx) return;
        e.preventDefault();
        const { x, y } = getPos(e);

        if (lastX == null || lastY == null) {
            lastX = x;
            lastY = y;
            return;
        }

        // Vẽ local
        drawingCtx.beginPath();
        drawingCtx.moveTo(lastX, lastY);
        drawingCtx.lineTo(x, y);
        drawingCtx.stroke();
        drawingCtx.closePath();

        // Gửi đoạn nét vẽ cho người khác
        emitDrawSegment(lastX, lastY, x, y);

        lastX = x;
        lastY = y;
    };

    const handlePointerUp = (e) => {
        if (!drawingCtx) return;
        e.preventDefault();
        isDrawing = false;
        lastX = null;
        lastY = null;
    };

    drawingCanvas.addEventListener("mousedown", handlePointerDown);
    drawingCanvas.addEventListener("mousemove", handlePointerMove);
    drawingCanvas.addEventListener("mouseup", handlePointerUp);
    drawingCanvas.addEventListener("mouseleave", handlePointerUp);

    drawingCanvas.addEventListener("touchstart", handlePointerDown, { passive: false });
    drawingCanvas.addEventListener("touchmove", handlePointerMove, { passive: false });
    drawingCanvas.addEventListener("touchend", handlePointerUp);
}

function emitDrawSegment(x0, y0, x1, y1) {
    if (!currentCallId || !drawingCanvas) return;

    socket.emit("call:draw", {
        conversation_id: currentCallId,
        // Gửi tọa độ tương đối để bên kia scale theo kích thước video-box của họ
        x0: x0 / drawingCanvas.width,
        y0: y0 / drawingCanvas.height,
        x1: x1 / drawingCanvas.width,
        y1: y1 / drawingCanvas.height,
        color: drawColor,
        width: drawWidth,
        brush: currentBrushType
    });
}

// ==================================================
// 1. LOGIC KHỞI TẠO & ĐIỀU KHIỂN (Giao diện Overlay)
// ==================================================

export async function startGroupCall(conversationId, conversationType = "group", options = {}) {
    console.log("[Call] Starting call for:", conversationId, "type:", conversationType, "options:", options);

    const { isInitiator = true, ignoreDecline = false, call_id = null, callMode = 'video' } = options;

    // 🔹 Nếu trước đó mình đã bấm "Từ chối" cuộc gọi này và chưa kết thúc,
    // thì không cho join lại (tránh bug decline xong vẫn join được).
    if (declinedConversations.has(conversationId) && !ignoreDecline) {
        console.log("[Call] This call was declined by current user, skip join.");
        // Có thể show toast ở đây nếu muốn
        return;
    }

    // Khi bắt đầu một call mới → clear flag cũ cho conversation này
    declinedConversations.delete(conversationId);
    handledIncomingConversations.delete(conversationId);

    isCurrentUserCallInitiator = !!isInitiator;
    currentCallMode = callMode; // 'video' | 'audio'

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
    if(call_id) currentDbCallId = call_id;
    isInCall = true;

    const overlay = document.getElementById("call-overlay");
    if (overlay) overlay.style.display = "flex";

    // Cập nhật UI cho call audio - ẩn video elements
    updateCallUIForMode(callMode);

    // Mobile: hiện nút flip (chỉ cho video call)
    if (callMode === 'video' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        const btnFlip = document.getElementById("btn-flip");
        if (btnFlip) btnFlip.style.display = "inline-block";
    }

    // Khởi tạo canvas vẽ (nếu chưa có và là video call)
    if (callMode === 'video') {
        initDrawingCanvas();
    }

    // 🔹 Cập nhật nút gọi nhóm ở header (nếu là call nhóm)
    if (conversationType === "group" && typeof window.updateCallButtonState === "function") {
        window.updateCallButtonState(true);
    }

    try {
        if (callMode === 'video') {
            await getMedia("user");
        } else {
            await getAudioOnlyMedia();
        }

        // 🔥 MAC STYLE: Bắt đầu timer và audio visualizer sau khi có media
        startCallTimer();
        initAudioVisualizer();

        // 🔥 Cập nhật header với thông tin cuộc gọi
        const callName = conversationType === 'group' ? 'Nhóm call' : 'Cuộc gọi';
        updateCallHeader(callName, null, 'Đang kết nối...');

        socket.emit("call:join", { conversation_id: conversationId, call_id: currentDbCallId });
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

    // Lưu lại mode hiện tại (để flipCamera còn biết)
    currentFacingMode = facingMode;

    // 🔍 Preview camera (không phải screen share)
    setLocalPreviewStream(localStream, { isScreenShare: false });

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
    // Dùng helper export chung
    replaceVideoTrackInPeers(newVideoTrack);
}

// Hàm lấy chỉ Audio (cho call thoại)
async function getAudioOnlyMedia() {
    // Nếu đang có stream cũ thì dừng các track
    if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
        localStream = null;
    }

    console.log("[Call] Getting audio only media");

    localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
    });

    // Preview - ẩn video, chỉ hiện avatar
    const videoEl = document.getElementById("local-video");
    if (videoEl) {
        videoEl.style.display = "none";
    }

    // Đồng bộ trạng thái Mic
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) audioTrack.enabled = isMicOn;

    // Cập nhật track cho peers
    if (Object.keys(peers).length > 0) {
        replaceTrackInPeers();
    }
}

// Cập nhật UI theo chế độ call
function updateCallUIForMode(callMode) {
    const localVideo = document.getElementById("local-video");
    const localBox = document.getElementById("local-box");
    const btnCam = document.getElementById("btn-cam");
    const btnFlip = document.getElementById("btn-flip");
    const btnDraw = document.getElementById("btn-draw-toggle");
    const btnScreen = document.getElementById("btn-screen-share");
    const drawingToolbar = document.getElementById("drawing-toolbar");

    if (callMode === 'audio') {
        // Audio call - ẩn video elements
        if (localVideo) localVideo.style.display = "none";
        if (btnCam) btnCam.style.display = "none";
        if (btnFlip) btnFlip.style.display = "none";
        if (btnDraw) btnDraw.style.display = "none";
        if (btnScreen) btnScreen.style.display = "none";
        if (drawingToolbar) drawingToolbar.style.display = "none";

        // Hiện avatar thay vì video
        if (localBox) {
            let avatarEl = localBox.querySelector(".audio-call-avatar");
            if (!avatarEl) {
                avatarEl = document.createElement("div");
                avatarEl.className = "audio-call-avatar";
                avatarEl.innerHTML = `
                    <div style="
                        width: 120px; height: 120px; border-radius: 50%;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        display: flex; align-items: center; justify-content: center;
                        font-size: 48px; color: white;
                    ">
                        <i class="fas fa-user"></i>
                    </div>
                    <div style="text-align: center; margin-top: 10px; color: white; font-size: 16px;">
                        Cuộc gọi thoại
                    </div>
                `;
                localBox.appendChild(avatarEl);
            }
            avatarEl.style.display = "flex";
        }
    } else {
        // Video call - hiện video elements
        if (localVideo) localVideo.style.display = "block";
        if (btnCam) btnCam.style.display = "inline-flex";
        if (btnFlip && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
            btnFlip.style.display = "inline-flex";
        }
        if (btnDraw) btnDraw.style.display = "inline-flex";
        if (btnScreen) btnScreen.style.display = "inline-flex";

        // Ẩn avatar audio call nếu có
        if (localBox) {
            const avatarEl = localBox.querySelector(".audio-call-avatar");
            if (avatarEl) avatarEl.style.display = "none";
        }
    }
}

// Hàm kết thúc gọi (Dọn dẹp)
export function endCall() {
    console.log("[Call] Ending call...");

    // Nếu đang share màn hình thì tắt luôn (nếu screen_share.js đã gắn)
    if (typeof window !== "undefined" && typeof window.stopScreenShare === "function") {
        try {
            window.stopScreenShare();
        } catch (e) {
            console.warn("[Call] stopScreenShare error:", e);
        }
    }

    const convId = currentCallId;
    const convType = currentCallType;   // LƯU LẠI để biết có phải call nhóm không
    const callMode = currentCallMode;   // Lưu lại mode để reset UI

    // Reset state trước, tránh race
    currentCallId = null;
    currentCallType = null;
    currentCallMode = 'video';
    isInCall = false;
    isCurrentUserCallInitiator = false;

    if (convId) {
        socket.emit("call:leave", { conversation_id: convId, call_id: currentDbCallId });

        // Clear flag declined/handled cho cuộc trò chuyện này
        declinedConversations.delete(convId);
        handledIncomingConversations.delete(convId);
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

    // Reset vẽ & reaction UI
    isDrawingMode = false;
    isReactionVisible = false;

    const toolbar = document.getElementById("drawing-toolbar");
    if (toolbar) toolbar.style.display = "none";

    const reactionBar = document.getElementById("reaction-bar");
    if (reactionBar) reactionBar.style.display = "none";

    const btnDraw = document.getElementById("btn-draw-toggle");
    if (btnDraw) btnDraw.classList.remove("active");

    const btnReact = document.getElementById("btn-reaction-toggle");
    if (btnReact) btnReact.classList.remove("active");

    if (drawingCanvas && drawingCtx) {
        drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    }

    // Reset UI về mặc định (hiện lại các nút video call)
    const localVideo = document.getElementById("local-video");
    const localBox = document.getElementById("local-box");
    const btnCam = document.getElementById("btn-cam");
    const btnFlip = document.getElementById("btn-flip");
    const btnDrawToggle = document.getElementById("btn-draw-toggle");
    const btnScreen = document.getElementById("btn-screen-share");

    if (localVideo) localVideo.style.display = "block";
    if (btnCam) btnCam.style.display = "inline-flex";
    if (btnFlip) btnFlip.style.display = "none"; // Ẩn flip mặc định
    if (btnDrawToggle) btnDrawToggle.style.display = "inline-flex";
    if (btnScreen) btnScreen.style.display = "inline-flex";

    // Xóa avatar audio call nếu có
    if (localBox) {
        const avatarEl = localBox.querySelector(".audio-call-avatar");
        if (avatarEl) avatarEl.remove();
    }

    // 🔹 Nếu vừa kết thúc call nhóm → reset lại nút gọi nhóm
    if (convType === "group" && typeof window.updateCallButtonState === "function") {
        window.updateCallButtonState(false);
    }

    // 🔥 MAC STYLE: Dừng timer và audio visualizer
    stopCallTimer();
    stopAudioVisualizer();

    // Reset minimize state
    isMinimized = false;
    const overlay = document.getElementById("call-overlay");
    if (overlay) overlay.classList.remove('call-minimized');

    // Ẩn Overlay
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
    if (data.user_info) {
        addVideoBox(data.signal_initiator_sid, data.user_info);

        // 🔥 MAC STYLE: Cập nhật header với tên người tham gia
        if (currentCallType === 'private') {
            updateCallHeader(
                data.user_info.username || 'Người dùng',
                data.user_info.avatar,
                'Đang gọi...'
            );
        }
    }
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

        // Sau khi đã có remoteDescription + localDescription, add các ICE pending (nếu có)
        if (pendingCandidates[data.from] && peer.remoteDescription) {
            for (const c of pendingCandidates[data.from]) {
                try {
                    await peer.addIceCandidate(new RTCIceCandidate(c));
                } catch (err) {
                    console.warn("[Call] Error adding pending ICE candidate (offer side):", err);
                }
            }
            delete pendingCandidates[data.from];
        }

        if (data.user_info) addVideoBox(data.from, data.user_info);

    } catch (err) {
        console.error("[Call] Error handling offer:", err);
    }
});

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
        } else {
            await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));
        }

        // Flush ICE pending (nếu có)
        if (pendingCandidates[data.from] && peer.remoteDescription) {
            for (const c of pendingCandidates[data.from]) {
                try {
                    await peer.addIceCandidate(new RTCIceCandidate(c));
                } catch (err) {
                    console.warn("[Call] Error adding pending ICE candidate (answer side):", err);
                }
            }
            delete pendingCandidates[data.from];
        }
    } catch (err) {
        console.error("[Call] Error setting remote description (answer):", err);
    }
});

socket.on("webrtc:candidate", async (data) => {
    if (!isInCall || !currentCallId) return;

    const peer = peers[data.from];
    if (!peer) {
        console.warn("[Call] Candidate received but peer not found");
        return;
    }

    try {
        if (!data.candidate) return;

        // Nếu chưa có remoteDescription -> cho vào hàng đợi
        if (!peer.remoteDescription || !peer.remoteDescription.type) {
            if (!pendingCandidates[data.from]) pendingCandidates[data.from] = [];
            pendingCandidates[data.from].push(data.candidate);
            return;
        }

        await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (e) {
        console.error("[Call] Error adding ICE candidate:", e);
    }
});

// F. Người khác rời đi
socket.on("call:user_left", (data) => {
    console.log("[Call] call:user_left", data);
    removePeer(data.sid);
});

socket.on("call:initiated", (data) => {
    if (data.call_id) {
        currentDbCallId = data.call_id;
    }
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

// Bật/Tắt chế độ Vẽ
window.toggleDrawingMode = () => {
    if (!drawingInitialized) {
        initDrawingCanvas();
    }
    isDrawingMode = !isDrawingMode;

    const toolbar = document.getElementById("drawing-toolbar");
    const btn = document.getElementById("btn-draw-toggle");

    if (toolbar) toolbar.style.display = isDrawingMode ? "flex" : "none";
    if (btn) btn.classList.toggle("active", isDrawingMode);

    if (drawingCanvas) {
        drawingCanvas.style.pointerEvents = isDrawingMode ? "auto" : "none";
    }
};

// Bật/Tắt thanh Reaction
window.toggleReactionBar = () => {
    isReactionVisible = !isReactionVisible;

    const bar = document.getElementById("reaction-bar");
    const btn = document.getElementById("btn-reaction-toggle");

    if (bar) bar.style.display = isReactionVisible ? "flex" : "none";
    if (btn) btn.classList.toggle("active", isReactionVisible);
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

// 🔥 [NEW] Set initiator flag when user makes a call (without immediately joining)
window.setCallInitiator = function(convId, callMode = 'video') {
    isCurrentUserCallInitiator = true;
    currentCallId = convId;
    currentCallMode = callMode;
    console.log(`[Call] Set as initiator for ${convId}, mode: ${callMode}`);
};

function clearAllDrawingCanvas() {
    // Xoá canvas local
    if (drawingCanvas && drawingCtx) {
        drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    }

    // Xoá toàn bộ canvas remote
    const remoteCanvases = document.querySelectorAll("canvas.remote-draw");
    remoteCanvases.forEach((c) => {
        const ctx = c.getContext("2d");
        if (ctx) {
            ctx.clearRect(0, 0, c.width, c.height);
        }
    });
}

// ==================================================
// 5. XỬ LÝ LỜI MỜI & REACTION
// ==================================================

function getOrCreateRemoteCanvasForBox(videoBox) {
    let canvas = videoBox.querySelector("canvas.remote-draw");
    if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.className = "drawing-canvas remote-draw";
        canvas.style.position = "absolute";
        canvas.style.top = "0";
        canvas.style.left = "0";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.pointerEvents = "none";
        videoBox.appendChild(canvas);
    }

    const rect = videoBox.getBoundingClientRect();
    const newWidth  = Math.round(rect.width);
    const newHeight = Math.round(rect.height);

    // Chỉ resize khi thực sự thay đổi, và dùng số nguyên để tránh clear liên tục
    if (canvas.width !== newWidth || canvas.height !== newHeight) {
        canvas.width = newWidth;
        canvas.height = newHeight;
    }
    return canvas;
}

socket.on("call:draw", (data) => {
    if (!data || !currentCallId || data.conversation_id !== currentCallId) return;

    const fromSid = data.from_sid;
    // Không vẽ lại nét của chính mình (phòng khi server gửi include_self=true)
    if (!fromSid || fromSid === socket.id) return;

    const videoBox = document.getElementById(`c-${fromSid}`);
    if (!videoBox) return;

    const canvas = getOrCreateRemoteCanvasForBox(videoBox);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { x0, y0, x1, y1, color, width, brush } = data;

    ctx.strokeStyle = color || "#ff0000";
    ctx.lineWidth = width || 4;
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";

    if (brush === "marker") {
        ctx.lineCap = "square";
        ctx.lineJoin = "miter";
    } else {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
    }

    if (brush === "neon") {
        ctx.globalAlpha = 0.8;
        ctx.shadowBlur = 10;
        ctx.shadowColor = color || "#ff0000";
    }

    ctx.beginPath();
    ctx.moveTo((x0 || 0) * canvas.width, (y0 || 0) * canvas.height);
    ctx.lineTo((x1 || 0) * canvas.width, (y1 || 0) * canvas.height);
    ctx.stroke();
    ctx.closePath();
});

socket.on("call:clear_board", (data = {}) => {
    // Nếu server có gửi kèm conversation_id thì check, không thì cứ clear
    if (data.conversation_id && currentCallId && data.conversation_id !== currentCallId) {
        return;
    }
    clearAllDrawingCanvas();
});

// Nhận lời mời gọi (INCOMING CALL)
socket.on("call:incoming_notification", (data) => {
    console.log("[Call] Received call:incoming_notification:", data);
    if (!data || !data.conversation_id) {
        console.log("[Call] Missing data, returning");
        return;
    }

    // Nếu mình đang ở trong cuộc gọi này rồi → bỏ qua (tránh spam khi có người join thêm)
    if (isInCall && currentCallId === data.conversation_id) {
        console.log("[Call] Already in this call, returning");
        return;
    }

    // Nếu đã xử lý popup cho cuộc gọi này (accept/decline) → bỏ qua
    if (handledIncomingConversations.has(data.conversation_id)) {
        console.log("[Call] Already handled this conversation, returning");
        return;
    }

    // Nếu đã bấm từ chối cuộc gọi này → bỏ qua luôn
    if (declinedConversations.has(data.conversation_id)) {
        console.log("[Call] Already declined this conversation, returning");
        return;
    }

    const popup = document.getElementById("incoming-call-popup");
    const avatar = document.getElementById("incoming-avatar");
    const name = document.getElementById("incoming-name");
    const desc = document.getElementById("incoming-desc");
    const callTypeBadge = document.getElementById("incoming-call-type");
    const btnAccept = document.getElementById("btn-accept-call");
    const btnDecline = document.getElementById("btn-decline-call");
    const ringtone = document.getElementById("ringtone-audio");

    console.log("[Call] DOM elements:", {popup, avatar, name, btnAccept, btnDecline});

    // Xác định loại call: audio hay video
    const callMode = data.call_mode || 'video';
    const callTypeText = callMode === 'audio' ? 'Cuộc gọi thoại' : 'Cuộc gọi video';
    const callIcon = callMode === 'audio' ? 'fa-phone' : 'fa-video';

    if (popup && avatar && name && btnAccept && btnDecline) {
        avatar.src = data.caller?.avatar || "/static/img/default-avatar.png";
        currentDbCallId = data.call_id;

        const isGroup = data.conversation_type === 'group';
        const title = isGroup
            ? (data.room_name || 'Cuộc gọi đến')
            : (data.caller?.username || 'Cuộc gọi đến');
        const message = isGroup
            ? `${data.caller?.username || 'Ai đó'} đang gọi...`
            : 'đang gọi cho bạn...';

        if (data.conversation_type === "group") {
            name.textContent = title;
            if (desc) desc.textContent = message;
        } else {
            // 1v1 - hiển thị đúng ngữ cảnh
            name.textContent = data.caller?.username || "Người dùng";
            if (desc) desc.textContent = `đang gọi ${callMode === 'audio' ? 'thoại' : 'video'} cho bạn...`;
        }
        
        // Hiển thị badge loại call
        if (callTypeBadge) {
            callTypeBadge.innerHTML = `<i class="fas ${callIcon}"></i> ${callTypeText}`;
            callTypeBadge.style.display = 'inline-flex';
        }

        popup.style.display = "block";
        // [FIX] Đảm bảo incoming popup luôn trên outgoing popup
        popup.style.zIndex = "20000";
        
        console.log("[Call] Popup displayed");

        if (ringtone) {
            ringtone.currentTime = 0;
            ringtone.play().catch(() => console.log("Autoplay blocked"));
        }

        btnAccept.onclick = () => {
            popup.style.display = "none";
            if (ringtone) ringtone.pause();

            // Đã xử lý popup này
            handledIncomingConversations.add(data.conversation_id);
            declinedConversations.delete(data.conversation_id);

            // [1v1] Báo cho server là đã accept để caller tự động join
            socket.emit("call:accept", {
                conversation_id: data.conversation_id,
                conversation_type: data.conversation_type,
                call_id: currentDbCallId,
                call_mode: callMode
            });

            // Truyền luôn conversation_type để lưu lại, và đánh dấu mình KHÔNG phải initiator
            // Truyền callMode để vào đúng chế độ call
            startGroupCall(data.conversation_id, data.conversation_type, {
                isInitiator: false,
                ignoreDecline: true,
                call_id: currentDbCallId,
                callMode: callMode  // Truyền chế độ gọi
            });
        };

        btnDecline.onclick = () => {
            popup.style.display = "none";
            if (ringtone) ringtone.pause();

            // Ghi lại trạng thái đã từ chối cuộc gọi này
            declinedConversations.add(data.conversation_id);
            handledIncomingConversations.add(data.conversation_id);

            socket.emit("call:decline", {
                conversation_id: data.conversation_id,
                conversation_type: data.conversation_type
            });
        };
    }
});

// Backward compatibility - also listen to old event name
socket.on("call:incoming", (data) => {
    console.log("[Call] Received call:incoming (legacy):", data);
    // Forward to new handler
    socket.emit("call:incoming_notification", data);
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

    // Chỉ người KHỞI TẠO cuộc gọi hiện tại mới xử lý thông báo này
    if (!isCurrentUserCallInitiator) {
        return;
    }

    // Nếu server có gửi conversation_id thì check khớp
    if (data?.conversation_id && currentCallId && data.conversation_id !== currentCallId) {
        return;
    }

    const name = data?.decliner?.username || "Người dùng";

    // Đóng popup "đang gọi..." nếu có
    const outgoingPopup = document.getElementById('outgoing-call-popup');
    if (outgoingPopup) {
        outgoingPopup.remove();
    }

    // Tạm thời dùng alert cho dễ debug
    alert(`❌ ${name} đã từ chối cuộc gọi.`);
});

// 🔥 BÙNG NỔ: Người gọi hủy lời mời - đóng popup incoming
socket.on("call:cancelled", (data) => {
    console.log("[Call] call:cancelled:", data);
    
    // Nếu đang hiển thị popup incoming cho cuộc gọi này thì đóng lại
    if (data?.conversation_id && currentCallId === data.conversation_id) {
        const popup = document.getElementById("incoming-call-popup");
        const ringtone = document.getElementById("ringtone-audio");
        
        if (popup) {
            popup.style.display = "none";
        }
        if (ringtone) {
            ringtone.pause();
        }
        
        // Đánh dấu đã xử lý
        handledIncomingConversations.add(data.conversation_id);
        console.log("[Call] Incoming call cancelled by caller, popup closed");
    }
});

// [1v1] Người nhận đã accept - caller tự động join
socket.on("call:accepted", (data) => {
    console.log("[Call] call:accepted:", data);

    // Chỉ người KHỞI TẠO (caller) mới xử lý - tự động join
    if (!isCurrentUserCallInitiator) {
        return;
    }

    // Đóng popup "đang gọi..."
    const outgoingPopup = document.getElementById('outgoing-call-popup');
    if (outgoingPopup) {
        outgoingPopup.remove();
    }

    // Tự động vào cuộc gọi
    const callMode = data.call_mode || 'video';
    startGroupCall(data.conversation_id, data.conversation_type, {
        isInitiator: true,
        ignoreDecline: true,
        call_id: data.call_id,
        callMode: callMode
    });
});

socket.on("call:ended", (data) => {
    console.log("[Call] call:ended", data);

    if (data && data.conversation_id) {
        declinedConversations.delete(data.conversation_id);
        handledIncomingConversations.delete(data.conversation_id);
    }
    isCurrentUserCallInitiator = false;

    // Nếu mình đang trong call đó mà server báo phòng hết người -> đóng UI
    if (isInCall && currentCallId && data && data.conversation_id === currentCallId) {
        endCall();   // endCall sẽ tự ẩn overlay, dọn peer, dọn canvas
    }

    // Dù mình có trong call hay không, nếu là group thì reset nút header về "Gọi video"
    if (data && data.conversation_type === "group" && typeof window.updateCallButtonState === "function") {
        window.updateCallButtonState(false);
    }
});
// ============================================================
// HÀM HIỂN THỊ GIAO DIỆN "ĐANG GỌI..." (OUTGOING CALL)
// ============================================================
window.showOutgoingCallUI = function(name, avatar) {
    console.log("[UI] Showing outgoing call UI for:", name);

    // 1. Xóa popup cũ nếu còn sót lại
    const old = document.getElementById('outgoing-call-popup');
    if (old) old.remove();

    // 2. Tạo HTML Popup (Style cứng luôn để đảm bảo hiện đẹp)
    const div = document.createElement('div');
    div.id = 'outgoing-call-popup';
    div.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0, 0, 0, 0.85); z-index: 10000;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        color: white; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        backdrop-filter: blur(5px);
    `;

    // Avatar mặc định nếu thiếu
    const avatarSrc = avatar || '/static/img/default-avatar.png';

    div.innerHTML = `
        <div style="text-align: center; animation: fadeIn 0.5s ease;">
            <div style="position: relative; margin-bottom: 25px;">
                <img src="${avatarSrc}" style="
                    width: 120px; height: 120px; border-radius: 50%; 
                    border: 4px solid rgba(255,255,255,0.2); object-fit: cover;
                    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
                ">
                <div class="ripple-effect"></div>
            </div>
            
            <h2 style="font-size: 24px; font-weight: 600; margin-bottom: 8px;">${name}</h2>
            <p style="font-size: 16px; color: #ccc; margin-bottom: 50px;">Đang gọi...</p>
            
            <div style="display: flex; justify-content: center; gap: 40px;">
                <button style="background: rgba(255,255,255,0.1); border:none; width:50px; height:50px; border-radius:50%; color:white; cursor:pointer;">
                    <i class="fas fa-microphone-slash"></i>
                </button>

                <button id="btn-cancel-outgoing" style="
                    background: #ff3b30; border: none; width: 70px; height: 70px;
                    border-radius: 50%; color: white; font-size: 28px; cursor: pointer;
                    display: flex; align-items: center; justify-content: center;
                    box-shadow: 0 4px 15px rgba(255, 59, 48, 0.4);
                    transition: transform 0.2s;
                " onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">
                    <i class="fas fa-phone-slash"></i>
                </button>

                <button style="background: rgba(255,255,255,0.1); border:none; width:50px; height:50px; border-radius:50%; color:white; cursor:pointer;">
                    <i class="fas fa-video-slash"></i>
                </button>
            </div>
        </div>
        
        <style>
            @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
            .ripple-effect {
                position: absolute; top: 0; left: 0; width: 100%; height: 100%;
                border-radius: 50%; border: 2px solid rgba(255,255,255,0.5);
                animation: ripple 1.5s infinite; opacity: 0;
            }
            @keyframes ripple { 0% { transform: scale(1); opacity: 0.8; } 100% { transform: scale(1.5); opacity: 0; } }
        </style>
    `;

    document.body.appendChild(div);

    // 3. (Tùy chọn) Phát nhạc chờ "Tút tút"
    // const ringtone = new Audio('/static/sounds/calling_tone.mp3');
    // ringtone.loop = true;
    // ringtone.play().catch(() => {}); 

    // 4. Xử lý sự kiện nút Hủy - GỬI CANCEL ĐẾN SERVER
    document.getElementById('btn-cancel-outgoing').addEventListener('click', () => {
        // Xóa giao diện
        div.remove();
        
        // 🔥 BÙNG NỔ: Gửi socket báo hủy cuộc gọi để người nhận mất popup
        if (socket && currentCallId) {
            socket.emit('call:cancel', {
                conversation_id: currentCallId,
                conversation_type: currentCallType,
                call_id: currentDbCallId
            });
            console.log("[UI] Outgoing call cancelled and notified server");
        } else {
            console.log("[UI] Outgoing call cancelled by user (no active call)");
        }
        
        // Reset trạng thái
        isCurrentUserCallInitiator = false;
        currentCallId = null;
        currentDbCallId = null;
    });
};

// 🔥 [NEW] Safety wrapper cho showOutgoingCallUI
window.safeShowOutgoingCallUI = function(name, avatar, callMode = 'video') {
    try {
        console.log("[safeShowOutgoingCallUI] Showing UI for:", name, "mode:", callMode);
        if (typeof window.showOutgoingCallUI === 'function') {
            window.showOutgoingCallUI(name, avatar, callMode);
        } else {
            console.error("[safeShowOutgoingCallUI] showOutgoingCallUI không tồn tại!");
        }
    } catch (e) {
        console.error("[safeShowOutgoingCallUI] Lỗi:", e);
    }
};
// ==================== MAC-STYLE CALL FEATURES ====================

// Minimize/Expand call window
let isMinimized = false;
let callTimerInterval = null;
let callStartTime = null;

window.toggleMinimize = function() {
    const overlay = document.getElementById('call-overlay');
    const btnMinimize = document.getElementById('btn-minimize');
    const btnExpand = document.getElementById('btn-expand');
    
    if (!overlay) return;
    
    isMinimized = !isMinimized;
    
    if (isMinimized) {
        overlay.classList.add('call-minimized');
        if (btnMinimize) {
            btnMinimize.innerHTML = '<i class="fas fa-expand"></i>';
            btnMinimize.title = 'Phóng to';
        }
        // Ẩn toolbar vẽ và reaction khi minimize
        const toolbar = document.getElementById('drawing-toolbar');
        const reactionBar = document.getElementById('reaction-bar');
        if (toolbar) toolbar.style.display = 'none';
        if (reactionBar) reactionBar.style.display = 'none';
    } else {
        overlay.classList.remove('call-minimized');
        if (btnMinimize) {
            btnMinimize.innerHTML = '<i class="fas fa-compress"></i>';
            btnMinimize.title = 'Thu gọn';
        }
    }
    console.log('[Call] Minimize toggled:', isMinimized);
};

// Cập nhật thông tin header (tên, avatar)
window.updateCallHeader = function(name, avatar, status = 'Đang gọi...') {
    const callName = document.getElementById('call-name');
    const callAvatar = document.getElementById('call-avatar');
    const callStatus = document.querySelector('.call-header .status');

    if (callName) callName.textContent = name || 'Cuộc gọi';
    if (callAvatar && avatar) callAvatar.src = avatar;

    // Cập nhật status nếu có
    if (callStatus && status) {
        const statusText = callStatus.querySelector('.call-timer');
        if (statusText) statusText.textContent = status;
    }
};

// Bắt đầu đếm thời gian cuộc gọi
function startCallTimer() {
    callStartTime = Date.now();
    const timerEl = document.getElementById('call-duration');

    if (callTimerInterval) clearInterval(callTimerInterval);

    callTimerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const seconds = (elapsed % 60).toString().padStart(2, '0');
        if (timerEl) timerEl.textContent = `${minutes}:${seconds}`;
    }, 1000);
}

function stopCallTimer() {
    if (callTimerInterval) {
        clearInterval(callTimerInterval);
        callTimerInterval = null;
    }
    callStartTime = null;
    const timerEl = document.getElementById('call-duration');
    if (timerEl) timerEl.textContent = '00:00';
}

// Audio Visualizer - Mac style audio frequency bars
let audioContext = null;
let analyser = null;
let dataArray = null;
let visualizerInterval = null;

function initAudioVisualizer() {
    const localVideo = document.getElementById('local-video');
    if (!localVideo || !localVideo.srcObject) return;
    
    try {
        // Đóng audio context cũ nếu có
        if (audioContext) {
            audioContext.close();
        }

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 32;
        
        const source = audioContext.createMediaStreamSource(localVideo.srcObject);
        source.connect(analyser);
        
        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
        
        const bars = document.querySelectorAll('.audio-bar');
        
        visualizerInterval = setInterval(() => {
            if (!analyser) return;
            analyser.getByteFrequencyData(dataArray);
            
            bars.forEach((bar, index) => {
                const dataIndex = Math.floor(index * (bufferLength / bars.length));
                const value = dataArray[dataIndex] || 0;
                // Thêm random nhẹ để có hiệu ứng động ngay cả khi không có âm thanh
                const randomOffset = Math.random() * 3;
                const height = Math.max(4, ((value + randomOffset) / 255) * 18);
                bar.style.height = `${height}px`;
            });
        }, 80);
    } catch (err) {
        console.log('[AudioVisualizer] Init error:', err);
    }
}

function stopAudioVisualizer() {
    if (visualizerInterval) {
        clearInterval(visualizerInterval);
        visualizerInterval = null;
    }
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    // Reset bars về mặc định
    const bars = document.querySelectorAll('.audio-bar');
    const defaultHeights = [4, 8, 6, 12, 6, 8, 4];
    bars.forEach((bar, index) => {
        bar.style.height = `${defaultHeights[index]}px`;
    });
}

// Auto-end 1v1 call when other person leaves
socket.on('call:user_left', (data) => {
    console.log('[Call] User left:', data);
    
    // If 1v1 call and not group call, end the call
    if (currentCallType === 'private' && data.user_id !== currentUserId) {
        console.log('[Call] Other person left 1v1 call, ending...');
        showNotification('Người kia đã rời cuộc gọi');
        setTimeout(() => {
            endCall();
        }, 1500);
    }
});

// Make functions available globally
window.stopAudioVisualizer = stopAudioVisualizer;
window.initAudioVisualizer = initAudioVisualizer;
window.startCallTimer = startCallTimer;
window.stopCallTimer = stopCallTimer;
window.updateCallHeader = updateCallHeader;
