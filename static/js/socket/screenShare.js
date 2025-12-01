// static/js/socket/screenShare.js
import {
    getLocalStream,
    replaceVideoTrackInPeers,
    setLocalPreviewStream
} from "./call.js";

let isScreenSharing = false;
let screenStream = null;

// Gắn sự kiện cho nút share sau khi DOM sẵn sàng
window.addEventListener("DOMContentLoaded", () => {
    const btnShare = document.getElementById("btn-screen-share");  // 🔥 ĐÚNG ID
    if (!btnShare) {
        console.warn("[ScreenShare] #btn-screen-share not found");
        return;
    }

    console.log("[ScreenShare] Attached click handler to #btn-screen-share");

    btnShare.addEventListener("click", () => {
        if (!isScreenSharing) {
            startScreenShare();
        } else {
            stopScreenShare();
        }
    });
});

async function startScreenShare() {
    if (isScreenSharing) return;

    try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: "always" },
            audio: false
        });

        const screenTrack = displayStream.getVideoTracks()[0];
        if (!screenTrack) {
            displayStream.getTracks().forEach((t) => t.stop());
            return;
        }

        screenStream = displayStream;
        isScreenSharing = true;

        // ✅ Preview màn hình lên local video – KHÔNG mirror
        setLocalPreviewStream(displayStream, { isScreenShare: true });

        // Gửi track màn hình tới tất cả peers
        replaceVideoTrackInPeers(screenTrack);

        // Khi user bấm "Stop sharing" trên thanh của trình duyệt
        screenTrack.addEventListener("ended", () => {
            stopScreenShare();
        });

        updateShareButton(true);
    } catch (err) {
        console.error("[ScreenShare] getDisplayMedia error:", err);
        updateShareButton(false);
    }
}

function stopScreenShare() {
    if (!isScreenSharing) return;

    // Tắt stream màn hình
    if (screenStream) {
        screenStream.getTracks().forEach((t) => t.stop());
        screenStream = null;
    }

    // Lấy lại camera đang dùng trong call.js
    const localStream = getLocalStream();
    const cameraTrack = localStream ? localStream.getVideoTracks()[0] : null;

    if (cameraTrack) {
        // Gắn lại track camera cho tất cả peers
        replaceVideoTrackInPeers(cameraTrack);

        // ✅ Preview lại camera – CÓ mirror (nếu bạn set trong call.js)
        setLocalPreviewStream(localStream, { isScreenShare: false });
    } else {
        // Không còn stream → clear preview + bỏ mirror luôn
        setLocalPreviewStream(null, { isScreenShare: false });
    }

    isScreenSharing = false;
    updateShareButton(false);
}

function updateShareButton(active) {
    const btn = document.getElementById("btn-screen-share");
    if (!btn) return;

    if (active) {
        btn.classList.add("active");
    } else {
        btn.classList.remove("active");
    }

    // Icon thống nhất theo chat.html (fa-display)
    btn.innerHTML = '<i class="fas fa-display"></i>';
}

// Cho call.js gọi được nếu muốn dừng share khi endCall
if (typeof window !== "undefined") {
    window.stopScreenShare = stopScreenShare;
}
