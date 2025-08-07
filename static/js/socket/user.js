// Modal và các thành phần
const profileModal = document.getElementById('profile-modal');
const profileToggle = document.querySelector('.user-avatar');
const closeProfileModal = document.getElementById('close-profile-modal');
const cancelProfile = document.getElementById('cancel-profile');
const avatarPreview = document.getElementById('avatar-preview');
const profileForm = document.getElementById('profile-form');
const uploadAvatarBtn = document.getElementById('upload-avatar-btn');
const uploadAvatarInput = document.getElementById('avatar-upload');

// 🟣 Mở modal khi click avatar ở sidebar
if (profileToggle && profileModal) {
  profileToggle.addEventListener('click', () => {
    profileModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  });
}

// 🟣 Đóng modal
function closeModal() {
  profileModal.style.display = 'none';
  document.body.style.overflow = '';
}

if (closeProfileModal) closeProfileModal.addEventListener('click', closeModal);
if (cancelProfile) cancelProfile.addEventListener('click', closeModal);
window.addEventListener('click', (e) => {
  if (e.target === profileModal) closeModal();
});

// 🟣 Tải ảnh từ máy
if (uploadAvatarBtn && uploadAvatarInput) {
  uploadAvatarBtn.addEventListener('click', () => {
    uploadAvatarInput.click();
  });

  uploadAvatarInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const imgSrc = ev.target.result;

      // Cập nhật preview trong modal
      avatarPreview.innerHTML = `<img src="${imgSrc}" alt="Avatar">`;
    };
    reader.readAsDataURL(file);
  });
}
// Thay đổi phần submit form
// Thay đổi phần submit form
if (profileForm) {
  profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const fullName = document.getElementById('full-name').value;
    const username = document.getElementById('username').value;
    const email = document.getElementById('email').value;
    const phone = document.getElementById('phone').value;
    const dob = document.getElementById('dob').value;
    const gender = document.getElementById('gender').value;
    const avatarUrl = avatarPreview.querySelector('img').src;

    try {
      // Gửi yêu cầu cập nhật profile đầy đủ
      const response = await fetch('/update_profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          full_name: fullName,
          username: username,
          email: email,
          phone: phone,
          dob: dob,
          gender: gender,
          avatar: avatarUrl
        })
      });

      if (response.ok) {
        // Cập nhật UI
        document.querySelector('.user-avatar img').src = avatarUrl;
        document.querySelector('.username').textContent = fullName;
        alert('Thông tin hồ sơ đã được cập nhật thành công!');
        closeModal();
      } else {
        alert('Cập nhật thất bại!');
      }
    } catch (error) {
      console.error('Lỗi:', error);
      alert('Đã xảy ra lỗi khi cập nhật!');
    }
  });
}

// 🟣 Khởi tạo ngày sinh đúng định dạng
document.addEventListener('DOMContentLoaded', () => {
  const dobInput = document.getElementById('dob');
  if (dobInput && dobInput.value) {
    const date = new Date(dobInput.value);
    const formattedDate = date.toISOString().split('T')[0];
    dobInput.value = formattedDate;
  }
});

// Thêm hàm điền dữ liệu người dùng
async function loadUserProfile() {
  try {
    const response = await fetch('/get_profile');
    const user = await response.json();
    
    document.getElementById('full-name').value = user.full_name || '';
    document.getElementById('username').value = user.username || '';
    document.getElementById('email').value = user.email || '';
    document.getElementById('phone').value = user.phone || '';
    document.getElementById('dob').value = user.date_of_birth ? user.date_of_birth.split('T')[0] : '';
    document.getElementById('gender').value = user.gender || 'male';
    
    const avatarUrl = user.avatar || 'https://randomuser.me/api/portraits/men/41.jpg';
    avatarPreview.innerHTML = `<img src="${avatarUrl}" alt="Avatar">`;
  } catch (error) {
    console.error('Failed to load profile:', error);
  }
}

// Gọi hàm này khi mở modal
if (profileToggle && profileModal) {
  profileToggle.addEventListener('click', () => {
    profileModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    loadUserProfile(); // Tải dữ liệu người dùng
  });
}
// Thêm sự kiện cho nút thay đổi avatar
const changeAvatarBtn = document.getElementById('change-avatar-btn');
if (changeAvatarBtn && uploadAvatarInput) {
  changeAvatarBtn.addEventListener('click', () => {
    uploadAvatarInput.click();
  });
}
uploadAvatarInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  // Kiểm tra kích thước file (tối đa 2MB)
  if (file.size > 2 * 1024 * 1024) {
    alert('Ảnh không được vượt quá 2MB');
    return;
  }

  // Kiểm tra loại file
  if (!file.type.match('image.*')) {
    alert('Vui lòng chọn file ảnh');
    return;
  }

  const reader = new FileReader();
  reader.onload = (ev) => {
    const imgSrc = ev.target.result;
    avatarPreview.innerHTML = `<img src="${imgSrc}" alt="Avatar">`;
  };
  reader.readAsDataURL(file);
});