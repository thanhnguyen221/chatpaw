// static/js/socket/screenShare.js
import { socket } from "./index.js";
import {
    getLocalStream,
    replaceVideoTrackInPeers,
    setLocalPreviewStream
} from "./call.js";

let isScreenSharing = false;
let screenStream = null;
let currentPresenter = null; // Lưu socket.id của người đang trình chiếu

// Gắn sự kiện cho nút share sau khi DOM sẵn sàng
window.addEventListener("DOMContentLoaded", () => {
    const btnShare = document.getElementById("btn-screen-share");  // 🔥 ĐÚNG ID
    if (!btnShare) {
        console.warn("[ScreenShare] #btn-screen-share not found");
        return;
    }

    console.log("[ScreenShare] Attached click handler to #btn-screen-share");

    btnShare.addEventListener("click", () => {
        // Kiểm tra nếu đã có người đang trình chiếu
        if (currentPresenter && currentPresenter !== socket.id) {
            alert("Đã có người đang trình chiếu màn hình. Vui lòng chờ họ dừng lại.");
            return;
        }
        
        if (!isScreenSharing) {
            startScreenShare();
        } else {
            stopScreenShare();
        }
    });
});

async function startScreenShare() {
    if (isScreenSharing) return;
    
    // Kiểm tra lại trước khi bắt đầu
    if (currentPresenter && currentPresenter !== socket.id) {
        alert("Đã có người đang trình chiếu màn hình. Vui lòng chờ họ dừng lại.");
        return;
    }

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
        currentPresenter = socket.id; // Đánh dấu mình là người trình chiếu

        // ✅ Preview màn hình lên local video – KHÔNG mirror
        setLocalPreviewStream(displayStream, { isScreenShare: true });

        // Gửi track màn hình tới tất cả peers
        replaceVideoTrackInPeers(screenTrack);

        // Thông báo cho mọi người biết mình đang trình chiếu
        socket.emit("screen_share:started", {
            conversation_id: window.currentCallId,
            presenter_sid: socket.id,
            presenter_name: window.currentUser?.username || "Người dùng"
        });

        // Phóng to màn hình của chính mình (local)
        enlargePresenterVideo(socket.id);

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

    // Thông báo cho mọi người biết mình đã dừng trình chiếu
    socket.emit("screen_share:stopped", {
        conversation_id: window.currentCallId,
        presenter_sid: socket.id
    });

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

    // Reset kích thước video về bình thường
    resetVideoSizes();

    isScreenSharing = false;
    currentPresenter = null;
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

// Lắng nghe sự kiện từ server
try {
    // Người khác bắt đầu trình chiếu
    socket.on("screen_share:started", (data) => {
        console.log("[ScreenShare] Người dùng bắt đầu trình chiếu:", data);
        
        if (data.presenter_sid === socket.id) return; // Bỏ qua nếu là chính mình
        
        currentPresenter = data.presenter_sid;
        
        // Phóng to màn hình của người trình chiếu
        enlargePresenterVideo(data.presenter_sid);
        
        // Hiển thị thông báo
        showPresenterNotification(data.presenter_name + " đang trình chiếu màn hình");
    });

    // Người khác dừng trình chiếu
    socket.on("screen_share:stopped", (data) => {
        console.log("[ScreenShare] Người dùng dừng trình chiếu:", data);
        
        if (data.presenter_sid === socket.id) return; // Bỏ qua nếu là chính mình
        
        if (currentPresenter === data.presenter_sid) {
            currentPresenter = null;
        }
        
        // Reset kích thước video về bình thường
        resetVideoSizes();
    });
} catch (e) {
    console.error("[ScreenShare] Error setting up socket listeners:", e);
}

// Phóng to màn hình của người trình chiếu
function enlargePresenterVideo(presenterSid) {
    // Reset tất cả video về kích thước bình thường trước
    resetVideoSizes();
    
    const videoGrid = document.getElementById("video-grid");
    if (!videoGrid) return;
    
    // Thêm class để đánh dấu đang có người trình chiếu
    videoGrid.classList.add("has-presenter");
    
    // Tìm video box của người trình chiếu
    let presenterBox;
    if (presenterSid === socket.id) {
        // Nếu là mình, tìm local-box
        presenterBox = document.getElementById("local-box");
    } else {
        // Nếu là người khác, tìm theo sid
        presenterBox = document.getElementById(`c-${presenterSid}`);
    }
    
    if (presenterBox) {
        presenterBox.classList.add("presenter-mode");
        presenterBox.style.gridColumn = "1 / -1";
        presenterBox.style.gridRow = "1";
        presenterBox.style.height = "calc(100vh - 200px)";
        presenterBox.style.maxHeight = "none";
    }
    
    // Thu nhỏ các video khác
    const allBoxes = videoGrid.querySelectorAll(".video-box, #local-box");
    allBoxes.forEach(box => {
        if (box !== presenterBox) {
            box.classList.add("non-presenter");
            box.style.height = "150px";
        }
    });
}

// Reset kích thước tất cả video về bình thường
function resetVideoSizes() {
    const videoGrid = document.getElementById("video-grid");
    if (!videoGrid) return;
    
    videoGrid.classList.remove("has-presenter");
    
    const allBoxes = videoGrid.querySelectorAll(".video-box, #local-box");
    allBoxes.forEach(box => {
        box.classList.remove("presenter-mode", "non-presenter");
        box.style.gridColumn = "";
        box.style.gridRow = "";
        box.style.height = "";
        box.style.maxHeight = "";
    });
}

// Hiển thị thông báo người đang trình chiếu
function showPresenterNotification(message) {
    // Tạo hoặc cập nhật thông báo
    let notif = document.getElementById("presenter-notification");
    if (!notif) {
        notif = document.createElement("div");
        notif.id = "presenter-notification";
        notif.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 10px 20px;
            border-radius: 20px;
            z-index: 10000;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 8px;
        `;
        document.body.appendChild(notif);
    }
    
    notif.innerHTML = `<i class="fas fa-desktop"></i> ${message}`;
    notif.style.display = "flex";
    
    // Ẩn sau 5 giây
    setTimeout(() => {
        notif.style.display = "none";
    }, 5000);
}

// Cho call.js gọi được nếu muốn dừng share khi endCall
if (typeof window !== "undefined") {
    window.stopScreenShare = stopScreenShare;
}
