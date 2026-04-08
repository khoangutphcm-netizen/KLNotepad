// --- Global State & Config ---
let currentUserId = localStorage.getItem('currentUserId') || null;
let currentNoteId = null;
let currentNotePinned = false;
let saveTimeout = null;
let searchTimeout = null;
let resetTokenGlobal = null;
let currentViewMode = 'grid';
let allNotes = [];
let sharedNotes = [];
let allLabels = [];
let currentNoteLabels = [];
let activeFilterLabelId = null;
let detailNoteObj = null;
let noteLabelsMap = new Map(); 
let isVerified = true;
let socket = null;
let currentAttachments = []; // Lưu mảng các file {name, type, data}
let editingLabelId = null; // Biến tạm để lưu ID nhãn đang sửa
const API_URL = ''; // Để trống để tự động nhận localhost:3000 trên trình duyệt 
const el = (id) => document.getElementById(id);
let currentPrefs = { font_size: 16, theme: 'light', note_bg_color: '#ffffff' };

const DEFAULT_AVATAR = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2UyZThmMCIgc3Ryb2tlPSIjNjQ3NDhiIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTIwIDIxdi0yYTQgNCAwIDAgMC00LTRIOGE0IDQgMCAwIDAtNCA0djIiLz48Y2lyY2xlIGN4PSIxMiIgY3k9IjciIHI9IjQiLz48L3N2Zz4=';

// --- Init & Check Session ---
window.addEventListener('load', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('activated') === 'true') {
    showToast("Kích hoạt tài khoản thành công!");
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  const resetToken = urlParams.get('resetToken');
  if (resetToken) {
     resetTokenGlobal = resetToken;
     el('reset-modal').classList.add('show');
  }

  if (currentUserId) {
    const success = await loadUserProfile();
    if (success) {
      showAppSection();
    } else {
      logout();
    }
  } else {
    showAuthMainMenu();
  }
});

// --- UI Navigation ---
function showAuthMainMenu() {
  el('auth-section').style.display = 'block';
  el('editor-section').style.display = 'none';
  el('auth-main-menu').style.display = 'grid';
  el('auth-login-menu').style.display = 'none';
  el('auth-register-menu').style.display = 'none';
}
function showLoginScreen() {
  el('auth-main-menu').style.display = 'none';
  el('auth-login-menu').style.display = 'block';
  el('login_email').value = ''; el('login_pass').value = '';
}
function showRegisterScreen() {
  el('auth-main-menu').style.display = 'none';
  el('auth-register-menu').style.display = 'block';
  el('reg_email').value = ''; el('reg_pass').value = '';
}

// ĐÃ SỬA: Hàm này giờ là async và dùng await để ép code chạy tuần tự, khắc phục triệt để lỗi POST /labels 500
async function showAppSection() {
  el('auth-section').style.display = 'none';
  el('editor-section').style.display = 'block';
  el('unverified-banner').style.display = isVerified ? 'none' : 'block';
  
  await loadPreferences();
  await loadAllData(); // Đợi tải xong hết danh sách nhãn hiện tại
  await checkLabelPresets(); // Lúc này biến allLabels đã có dữ liệu, sẽ không bị tạo trùng nhãn nữa
}

function logout() {
  localStorage.removeItem('currentUserId');
  currentUserId = null;
  document.body.classList.remove('dark-mode'); // Tắt Dark Mode khi đăng xuất
  showAuthMainMenu();
}

// --- User Profile ---
async function loadUserProfile() {
  try {
    const res = await fetch(`${API_URL}/user-profile/${currentUserId}`);
    if (!res.ok) return false;
    const user = await res.json();
    isVerified = user.is_verified === 1;
    
    el('header-user-name').innerText = user.display_name || user.email.split('@')[0];
    
    if(user.profile_image) {
      el('header-user-avatar').src = user.profile_image;
      el('profile-preview-img').src = user.profile_image;
    } else {
      el('header-user-avatar').src = DEFAULT_AVATAR;
      el('profile-preview-img').src = DEFAULT_AVATAR;
    }
    
    el('profile_name').value = user.display_name || '';
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

function toggleProfileModal() { el('profile-modal').classList.toggle('show'); }

el('profile_image_upload').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const result = await compressImage(file, 400, 0.8);
    el('profile-preview-img').src = result.base64;
    el('profile-preview-img').setAttribute('data-base64', result.base64);
  } catch (err) { showToast("Lỗi xử lý ảnh hồ sơ"); }
});

async function saveProfile() {
  const display_name = el('profile_name').value.trim();
  const profile_image = el('profile-preview-img').getAttribute('data-base64');
  
  try {
    const res = await fetch(`${API_URL}/user-profile/${currentUserId}`, {
      method: 'PUT', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ display_name, profile_image })
    });
    if (res.ok) {
      showToast("Lưu hồ sơ thành công!");
      await loadUserProfile();
      toggleProfileModal();
    } else showToast("Lỗi khi lưu hồ sơ.");
  } catch(e) { showToast("Lỗi kết nối."); }
}

// --- Helpers ---
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));
}

function getTextColorForBg(hexColor) {
  if (!hexColor || hexColor === 'transparent') return '#172033';
  const r = parseInt(hexColor.slice(1,3), 16), g = parseInt(hexColor.slice(3,5), 16), b = parseInt(hexColor.slice(5,7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) < 128 ? '#ffffff' : '#172033';
}

function showMessage(msg, isError = true, target = 'auth-message') {
  const div = el(target);
  if (!div) { showToast(msg); return; }
  div.innerText = msg;
  div.className = `message ${isError ? 'error' : 'success'}`;
  div.style.display = 'block';
  setTimeout(() => div.style.display = 'none', 5000);
}

function togglePass(inputId) {
  const input = el(inputId);
  const type = input.type === 'password' ? 'text' : 'password';
  input.type = type;
}

// --- Socket.io ---
function initSocket(noteId) {
  if (!window.io) return;
  if (socket) socket.disconnect();
  socket = io(API_URL);
  socket.emit('join-note', noteId);
  socket.on('note-updated', (data) => {
    if(currentNoteId === data.noteId) {
       el('note_title').value = data.title;
       el('note_content').value = data.content;
    }
  });
}
function broadcastEdit() {
  if (socket && currentNoteId) {
    socket.emit('edit-note', { noteId: currentNoteId, title: el('note_title').value, content: el('note_content').value });
  }
}

// --- Image Compression ---
function compressImage(file, maxWidth = 1024, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target.result;
      img.onload = () => {
        let width = img.width, height = img.height;
        if (width > maxWidth) { height = Math.floor(height * (maxWidth / width)); width = maxWidth; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve({ base64: canvas.toDataURL(file.type, quality), size: file.size });
      };
    };
    reader.onerror = reject;
  });
}

el('image_upload').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  for (let file of files) {
    const result = await compressImage(file, 800, 0.7);
    currentAttachments.push({ name: file.name, type: file.type, data: result.base64 });
  }
  renderAttachmentPreviews();
  triggerAutoSave();
});

function renderAttachmentPreviews() {
  const container = el('attachment-list-preview');
  container.innerHTML = currentAttachments.map((file, index) => `
    <div class="attachment-item" style="position:relative; border:1px solid #ddd; padding:5px; border-radius:5px;">
      ${file.type.includes('image') ? `<img src="${file.data}" style="width:60px; height:60px; object-fit:cover;">` : `<span>📄 ${file.name.substring(0,10)}</span>`}
      <button onclick="removeAttachment(${index})" style="position:absolute; top:-5px; right:-5px; background:red; color:white; border-radius:50%; border:none; width:18px; height:18px; cursor:pointer;">×</button>
    </div>
  `).join('');
}

function removeAttachment(index) {
  currentAttachments.splice(index, 1);
  renderAttachmentPreviews();
  triggerAutoSave();
}

function updateEditorImagePreview() {
  const url = el('note_image_url').value.trim();
  const img = el('editor-image-preview');
  const placeholder = el('preview-placeholder');
  if (url) {
    img.src = url; img.style.display = 'block'; placeholder.style.display = 'none';
  } else {
    img.style.display = 'none'; placeholder.style.display = 'block';
  }
}

// --- Authentication ---
async function login() {
  const email = el('login_email').value.trim(), password = el('login_pass').value;
  try {
    const res = await fetch(`${API_URL}/login`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email, password})
    });
    const data = await res.json();
    if (data.user_id) {
      currentUserId = data.user_id;
      localStorage.setItem('currentUserId', currentUserId);
      await loadUserProfile();
      showAppSection();
    } else showMessage(data.error, true, 'login-msg');
  } catch (e) { showMessage('Lỗi kết nối', true, 'login-msg'); }
}

async function register() {
  const email = el('reg_email').value.trim();
  const name = el('reg_name').value.trim();
  const p1 = el('reg_pass').value;
  const p2 = el('reg_pass_confirm').value;
  
  if (!email || !name || !p1) return showMessage('Vui lòng nhập đủ thông tin', true, 'reg-msg');
  if (p1 !== p2) return showMessage('Hai mật khẩu không khớp!', true, 'reg-msg');
  
  try {
    const res = await fetch(`${API_URL}/register`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email, display_name: name, password: p1})
    });
    const data = await res.json();
    if(data.user_id) {
      showToast(data.message);
      currentUserId = data.user_id; localStorage.setItem('currentUserId', currentUserId);
      await loadUserProfile(); showAppSection();
    } else showMessage(data.error, true, 'reg-msg');
  } catch (e) { showMessage('Lỗi kết nối server', true, 'reg-msg'); }
}

async function submitResetPassword() {
   const p1 = el('reset_p1').value, p2 = el('reset_p2').value;
   if(!p1 || p1 !== p2) return showToast("Mật khẩu không khớp hoặc bị trống!");
   try {
      const res = await fetch(`${API_URL}/reset-password`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ token: resetTokenGlobal, newPassword: p1 }) });
      const data = await res.json();
      if(res.ok) { showToast("Đổi thành công. Vui lòng đăng nhập lại."); window.location.href = window.location.pathname; }
      else showToast(data.error);
   } catch(e) { showToast("Lỗi kết nối"); }
}

async function submitChangePassword() {
  const oldP = el('cp_old').value, n1 = el('cp_new1').value, n2 = el('cp_new2').value;
  if(!oldP || !n1) return showToast("Nhập đủ thông tin");
  if(n1 !== n2) return showToast("Mật khẩu mới không khớp!");
  try {
     const res = await fetch(`${API_URL}/change-password`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({user_id: currentUserId, oldPassword: oldP, newPassword: n1})});
     const data = await res.json();
     if(res.ok) { showToast(data.message); el('cp_old').value=''; el('cp_new1').value=''; el('cp_new2').value=''; toggleProfileModal(); }
     else showToast(data.error);
  } catch(e) { showToast("Lỗi kết nối") }
}

async function resendActivation() {
  const email = el('reg_email').value.trim();
  if (!email) return showToast('Vui lòng nhập email ở trên để gửi lại');
  try {
    const res = await fetch(`${API_URL}/resend-activation`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email})
    });
    const data = await res.json();
    showToast(data.message || data.error);
  } catch (e) { showToast('Lỗi kết nối'); }
}

async function requestReset() {
  const email = el('login_email').value.trim();
  if (!email) return showToast('Vui lòng nhập email vào ô trước khi nhấn Quên mật khẩu');
  try {
    const res = await fetch(`${API_URL}/forgot-password`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (res.ok) showToast('Yêu cầu thành công! Vui lòng kiểm tra email của bạn để nhận link đổi mật khẩu.');
    else showToast(data.error || 'Gửi yêu cầu thất bại');
  } catch (e) { showToast('Lỗi kết nối server'); }
}

async function handleResetPassword(token, newPassword) {
    try {
      const res = await fetch(`${API_URL}/reset-password`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ token, newPassword })
      });
      const data = await res.json();
      if (res.ok) {
        showToast("Đổi mật khẩu thành công! Bây giờ bạn có thể đăng nhập.");
        window.location.href = window.location.pathname; 
      } else showToast(data.error || "Token không hợp lệ hoặc đã hết hạn.");
    } catch (e) { showToast("Lỗi kết nối server"); }
}

// --- Label Presets & Preferences ---
async function checkLabelPresets() {
  if (!currentUserId) return;
  // Use .find to check names
  const hasImportant = allLabels.some(l => l.name.toLowerCase() === 'important');
  const hasMisc = allLabels.some(l => l.name.toLowerCase() === 'misc');
  
  if (!hasImportant) {
    await fetch(`${API_URL}/labels`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ user_id: currentUserId, name: 'Important', color: '#3b82f6' }) // Blue
    });
  }
  if (!hasMisc) {
    await fetch(`${API_URL}/labels`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ user_id: currentUserId, name: 'Misc', color: '#9ca3af' }) // Grey
    });
  }
  await loadAllData();
}

async function loadPreferences() {
  try {
    const res = await fetch(`${API_URL}/preferences/${currentUserId}`);
    const prefs = await res.json();
    if (prefs && !prefs.error) { currentPrefs = prefs; applyPrefs(prefs); }
  } catch (e) { console.error("Load preferences error:", e); }
}
function applyPrefs(prefs) {
  currentPrefs = prefs;
  document.body.style.fontSize = prefs.font_size + 'px';
  el('font-size-slider').value = prefs.font_size;
  el('font-size-value').innerText = prefs.font_size + 'px';
  if (prefs.theme === 'dark') document.body.classList.add('dark-mode');
  else document.body.classList.remove('dark-mode');
  el('theme-select').value = prefs.theme;
}

function previewFontSize() {
  const newSize = parseInt(el('font-size-slider').value);
  el('font-size-value').innerText = newSize + 'px';
  document.body.style.fontSize = newSize + 'px';
}
function previewTheme() {
  const newTheme = el('theme-select').value;
  if (newTheme === 'dark') document.body.classList.add('dark-mode');
  else document.body.classList.remove('dark-mode');
}

async function savePreferences() {
  const prefs = {
    font_size: parseInt(el('font-size-slider').value),
    theme: el('theme-select').value,
    note_bg_color: '#ffffff' // Giữ màu mặc định của DB để không lỗi API
  };
  try {
    const res = await fetch(`${API_URL}/preferences/${currentUserId}`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(prefs)
    });
    if (res.ok) {
      currentPrefs = prefs; toggleSettings(); renderNotes();
      showToast('Đã lưu cài đặt!');
    } else showToast('Không lưu được cài đặt');
  } catch (e) { showToast('Lỗi kết nối server'); }
}
function toggleSettings() { el('settings-panel').classList.toggle('show'); }

// --- Data Loading & UI ---
async function loadAllData() {
  showSkeletons(); // Hiển thị skeleton loading trong lúc chờ dữ liệu
  if (!currentUserId) return;
  try {
    const notesRes = await fetch(`${API_URL}/notes/${currentUserId}`);
    if (!notesRes.ok) throw new Error(`HTTP ${notesRes.status}`);
    allNotes = await notesRes.json();
    if (!Array.isArray(allNotes)) allNotes = [];

    const sharedRes = await fetch(`${API_URL}/shared-with-me/${currentUserId}`);
    if (sharedRes.ok) {
      const shared = await sharedRes.json();
      if (Array.isArray(shared)) {
        sharedNotes = shared;
        allNotes = allNotes.concat(shared.map(s => ({ ...s, shared: true })));
      }
    }

    renderSharedNotes();

    const labelsRes = await fetch(`${API_URL}/labels/${currentUserId}`);
    if (!labelsRes.ok) throw new Error(`HTTP ${labelsRes.status}`);
    allLabels = await labelsRes.json();
    if (!Array.isArray(allLabels)) allLabels = [];

    noteLabelsMap.clear();
    for (const n of allNotes) {
      try {
        const res = await fetch(`${API_URL}/notes/${n.id}/labels`);
        if (res.ok) noteLabelsMap.set(n.id, await res.json());
        else noteLabelsMap.set(n.id, []);
      } catch (e) { noteLabelsMap.set(n.id, []); }
    }
    
    renderNotes();
    renderLabelSelect();
    renderFilterLabels();
    renderAllLabelsList();
  } catch (e) {
    const container = document.getElementById('note_list');
    if (container) container.innerHTML = `<div style="color: red; text-align: center;">Lỗi tải dữ liệu: ${e.message}</div>`;
  }
}

function renderLabelSelect() {
  el('label-select').innerHTML = '<option value="">-- Chọn nhãn --</option>' + 
    allLabels.map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('');
}
function renderFilterLabels() {
  let html = `<span class="filter-badge ${!activeFilterLabelId ? 'active' : ''}" 
                style="${!activeFilterLabelId ? 'background: var(--primary); color: white;' : 'background: #e2e8f0;'}" 
                onclick="filterByLabel(null)">Tất cả</span>`;
  
  html += allLabels.map(l => {
    const isActive = activeFilterLabelId == l.id;
    const color = l.color || '#9ca3af';
    const textColor = getTextColorForBg(color);
    
    // Nếu active thì hiện màu đậm, nếu không thì hiện màu nhạt (mờ)
    const style = isActive 
      ? `background: ${color}; color: ${textColor}; border-color: ${color};` 
      : `background: ${color}22; color: var(--text); border: 1px solid ${color}44;`;

    return `<span class="filter-badge ${isActive ? 'active' : ''}" 
                  style="${style}" 
                  onclick="filterByLabel(${l.id})">${escapeHtml(l.name)}</span>`;
  }).join('');
  
  el('filter-labels').innerHTML = html;
}
function filterByLabel(id) { activeFilterLabelId = id; renderNotes(); renderFilterLabels(); }

// Tính năng đổi tên nhãn
async function editLabel(id, oldName) {
  const newName = prompt("Nhập tên mới cho nhãn:", oldName);
  if(!newName || newName === oldName) return;
  await fetch(`${API_URL}/labels/${id}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: newName}) });
  await loadAllData();
}

// Render danh sách nhãn trong Modal quản lý
function renderAllLabelsList() {
  const container = el('all-labels-list-container');
  if (allLabels.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:var(--muted); padding:20px;">Chưa có nhãn nào.</p>';
    return;
  }

  container.innerHTML = allLabels.map(l => `
    <div class="manage-label-item" style="display:flex; align-items:center; justify-content:space-between; padding:10px; border-bottom:1px solid var(--border); gap:10px;">
      <div style="display:flex; align-items:center; gap:10px; flex:1;">
        <div style="width:16px; height:16px; border-radius:50%; background:${l.color};"></div>
        <span style="font-weight:600;">${escapeHtml(l.name)}</span>
      </div>
      <div style="display:flex; gap:5px;">
        <button onclick="editLabelAction(${l.id}, '${l.name}', '${l.color}')" class="ghost" style="padding:5px 8px; font-size:12px;">✏️ Sửa</button>
        <button onclick="deleteLabelAction(${l.id})" class="ghost" style="padding:5px 8px; font-size:12px; color:var(--danger); border-color:var(--danger);">🗑️ Xóa</button>
      </div>
    </div>
  `).join('');
}

// Tính năng delay 300ms khi gõ tìm kiếm
function handleSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => { renderNotes(); }, 300);
}

// Thêm nhãn mới
async function addNewLabel() {
  const name = el('new-label-name').value.trim();
  const color = el('new-label-color').value;
  if (!name) return showToast("Vui lòng nhập tên nhãn");

  try {
    const res = await fetch(`${API_URL}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: currentUserId, name, color })
    });
    if (res.ok) {
      el('new-label-name').value = '';
      await loadAllData(); // Tải lại toàn bộ dữ liệu để đồng bộ
    }
  } catch (e) { showToast("Lỗi khi thêm nhãn"); }
}

// Sửa nhãn (Đổi tên và màu)
function editLabelAction(id, oldName, oldColor) {
  editingLabelId = id;
  el('edit-label-name').value = oldName;
  el('edit-label-color').value = oldColor || '#9ca3af'; // Gán màu cũ vào Color Picker
  el('edit-label-modal').classList.add('show');
}

// Khi nhấn "Lưu thay đổi" trong Modal sửa
async function submitEditLabel() {
  const newName = el('edit-label-name').value.trim();
  const newColor = el('edit-label-color').value;

  if (!newName) return showToast("Tên nhãn không được để trống!");

  try {
    const res = await fetch(`${API_URL}/labels/${editingLabelId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName, color: newColor })
    });

    if (res.ok) {
      el('edit-label-modal').classList.remove('show');
      await loadAllData(); // Tải lại dữ liệu để cập nhật thanh lọc và ghi chú
      renderAllLabelsList(); // Vẽ lại danh sách trong quản lý nhãn
    }
  } catch (e) {
    showToast("Lỗi khi cập nhật nhãn");
  }
}
async function addLabelToCurrentNote() {
  if (!currentNoteId) return showToast('Hãy lưu ghi chú trước khi gán nhãn');
  const labelId = document.getElementById('label-select').value;
  if (!labelId) return;
  const current = currentNoteLabels.map(l => l.id);
  if (current.includes(Number(labelId))) return showToast('Nhãn này đã được gán rồi');
  const newLabelIds = [...current, Number(labelId)];
  try {
    await fetch(`${API_URL}/notes/${currentNoteId}/labels`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label_ids: newLabelIds }) });
    await loadLabelsForCurrentNote(); await loadAllData();
  } catch (e) { showToast('Lỗi gán nhãn'); }
}
async function loadLabelsForCurrentNote() {
  if (!currentNoteId) { currentNoteLabels = []; renderCurrentNoteLabels(); return; }
  const res = await fetch(`${API_URL}/notes/${currentNoteId}/labels`);
  currentNoteLabels = await res.json();
  noteLabelsMap.set(currentNoteId, currentNoteLabels);
  renderCurrentNoteLabels(); renderNotes();
}
// Xóa nhãn (Có hộp thoại xác nhận - Tiêu chuẩn Better Approach)
async function deleteLabelAction(id) {
  if (!confirm("Xóa nhãn này sẽ gỡ nó khỏi tất cả ghi chú liên quan. Bạn có chắc chắn?")) return;

  try {
    const res = await fetch(`${API_URL}/labels/${id}`, { method: 'DELETE' });
    if (res.ok) {
      await loadAllData();
    }
  } catch (e) { showToast("Lỗi khi xóa nhãn"); }
}
function renderCurrentNoteLabels() { el('current-note-labels').innerHTML = currentNoteLabels.map(l => `<span class="label-item">${escapeHtml(l.name)} <button onclick="removeLabelFromNote(${l.id})">×</button></span>`).join(''); }
async function removeLabelFromNote(labelId) {
  if (!currentNoteId) return;
  const newLabelIds = currentNoteLabels.filter(l => l.id !== labelId).map(l => l.id);
  try { await fetch(`${API_URL}/notes/${currentNoteId}/labels`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label_ids: newLabelIds }) }); await loadLabelsForCurrentNote(); await loadAllData(); } catch (e) { showToast('Lỗi gỡ nhãn'); }
}
// Mở modal và render danh sách ngay lập tức
function showManageLabelsModal() {
  renderAllLabelsList();
  el('labels-modal').classList.add('show');
}
function closeLabelsModal() { el('labels-modal').classList.remove('show'); }

function setViewMode(mode) {
  currentViewMode = mode;
  el('grid-btn').className = mode === 'grid' ? 'active' : 'ghost';
  el('list-btn').className = mode === 'list' ? 'active' : 'ghost';
  renderNotes();
}

function renderNotes() {
  const query = el('notes-search').value.toLowerCase();
  const container = el('note_list');
  container.className = `notes-grid ${currentViewMode}-view`;
  
  let filtered = allNotes.filter(n => n.title.toLowerCase().includes(query) || n.content.toLowerCase().includes(query));
  if (activeFilterLabelId) {
    filtered = filtered.filter(n => { const labels = noteLabelsMap.get(n.id) || []; return labels.some(l => l.id == activeFilterLabelId); });
  }
  // Sắp xếp: Ưu tiên Pinned (1 > 0), sau đó đến updated_at (mới hơn đứng trước)
  filtered.sort((a, b) => {
    if (b.pinned !== a.pinned) return b.pinned - a.pinned;
    return new Date(b.updated_at) - new Date(a.updated_at);
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--muted); padding: 40px;">Không tìm thấy ghi chú nào.</div>`;
    return;
  }
  container.innerHTML = filtered.map(n => {
    const bg = n.note_color || currentPrefs.note_bg_color || '#ffffff';
    
    // XỬ LÝ AN TOÀN: Kiểm tra xem có đính kèm không
    let hasAttachments = false;
    try {
        if (n.attachments) {
            const parsed = JSON.parse(n.attachments);
            hasAttachments = Array.isArray(parsed) && parsed.length > 0;
        }
    } catch (e) {
        // Nếu không phải JSON (dữ liệu cũ), kiểm tra xem có phải chuỗi data:image không
        hasAttachments = n.attachments && n.attachments.startsWith('data:');
    }

    const statusIcons = `${n.pinned ? '📌' : ''} ${n.password_hash ? '🔒' : ''} ${n.shared ? '👥' : ''} ${hasAttachments ? '📎' : ''}`;
    return `
      <div class="note-card ${n.pinned ? 'pinned' : ''}" style="background: ${bg}; color: ${getTextColorForBg(bg)};" onclick="handleNoteClick(${n.id})">
        <div style="float:right">${statusIcons}</div>
        <h4 class="note-title">${escapeHtml(n.title)}</h4>
        <div class="note-snippet">${n.password_hash ? '🔒 Nội dung đã bị khóa...' : escapeHtml(n.content.substring(0, 50)) + '...'}</div>
        ${n.shared ? `<div class="shared-by">Chia sẻ bởi: ${escapeHtml(n.owner_email || 'Unknown')}</div>` : ''}
      </div>
    `;
  }).join('');
}

function renderSharedNotes() {
  const container = el('shared_note_list');
  if (sharedNotes.length === 0) {
    container.innerHTML = '<div style="text-align: center; color: var(--muted); padding: 20px;">Chưa có ghi chú được chia sẻ.</div>';
    return;
  }
  container.innerHTML = sharedNotes.map(n => {
    const bg = n.note_color || '#ffffff';
    const avatar = n.owner_image || DEFAULT_AVATAR; // Lấy ảnh của chủ sở hữu
    
    return `
      <div class="note-card" style="background: ${bg}; color: ${getTextColorForBg(bg)};" onclick="handleNoteClick(${n.id})">
        <div style="float:right">👥</div>
        <h4 class="note-title">${escapeHtml(n.title)}</h4>
        <div class="note-snippet">${n.password_hash ? '🔒 Đã khóa' : escapeHtml(n.content.substring(0, 50)) + '...'}</div>
        
        <div class="shared-by" style="font-size:0.8rem; margin-top:8px; border-top:1px solid rgba(0,0,0,0.1); padding-top:8px; display:flex; align-items:center; gap:8px;">
          <img src="${avatar}" style="width:24px; height:24px; border-radius:50%; object-fit:cover; border: 1px solid var(--border);">
          <div>
            Chia sẻ bởi: <b>${escapeHtml(n.owner_email)}</b><br>
            Quyền: ${n.permission} | Ngày: ${new Date(n.shared_at).toLocaleDateString()}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function showNoteDetail(id) {
  const note = allNotes.find(n => n.id === id);
  if (!note) return;
  detailNoteObj = note; 
  
  el('detail-title').innerText = note.title || 'Ghi chú';
  el('detail-content').innerText = note.password_hash ? '🔒 Nội dung đã bị khóa...' : note.content;

  // XỬ LÝ AN TOÀN CHO ẢNH/FILE
  let attachData = [];
  try {
      if (note.attachments && !note.password_hash) {
          attachData = JSON.parse(note.attachments);
          if (!Array.isArray(attachData)) attachData = [];
      }
  } catch (e) {
      // FALLBACK: Nếu là dữ liệu cũ (chỉ có 1 ảnh Base64)
      if (note.attachments && note.attachments.startsWith('data:')) {
          attachData = [{ name: 'Ảnh cũ', type: 'image/png', data: note.attachments }];
      }
  }

  el('detail-image-container').innerHTML = attachData.map(file => {
    if (file.type && file.type.includes('image')) {
      return `<img src="${file.data}" style="max-width:100%; border-radius:10px; margin-bottom:10px; display:block;">`;
    } else {
      return `<div style="padding:10px; background:rgba(0,0,0,0.05); border-radius:10px; margin-bottom:5px;">📄 <a href="${file.data}" download="${file.name}">${file.name}</a></div>`;
    }
  }).join('');
  
  // ... (giữ nguyên phần còn lại)

  el('detail-pin-btn').innerText = note.pinned ? '📌 Bỏ ghim' : '📍 Ghim';
  
  const lockBtn = el('lock-btn');
  if(lockBtn) {
    lockBtn.innerText = note.password_hash ? '🔓 Mở khóa hoàn toàn' : '🔒 Khóa ghi chú';
    lockBtn.className = note.password_hash ? 'ghost danger-text' : 'ghost';
  }
  
  const labels = noteLabelsMap.get(id) || [];
  el('detail-labels').innerHTML = labels.map(l => `<span class="note-label-tag">${escapeHtml(l.name)}</span>`).join('');
  
  // Quản lý quyền cho Share
  if(!note.shared) { // Nếu mình là chủ sở hữu
     el('share-btn').style.display = 'block';
     el('manage-shares-section').style.display = 'block';
     loadSharesList(note.id); // Tải danh sách những ai đang được share
  } else { // Nếu mình là người được nhận share
     el('share-btn').style.display = 'none';
     el('manage-shares-section').style.display = 'none';
  }
  el('note-detail-modal').classList.add('show');
}

function closeNoteDetailModal() { el('note-detail-modal').classList.remove('show'); }

function openEditorModal() { el('editor-modal').classList.add('show'); }
function closeEditorModal() { 
    el('editor-modal').classList.remove('show');
    currentNoteId = null; // Reset để tránh nhầm lẫn khi nhấn "Ghi chú mới" sau khi sửa
}

async function handleNoteClick(noteId) {
  const note = allNotes.find(n => n.id === noteId);
  if (!note) return;
  
  if (note.password_hash) {
    const password = prompt('Ghi chú này đã khóa. Nhập mật khẩu để xem:');
    if (!password) return;
    try {
      const res = await fetch(`${API_URL}/verify-note-password`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ note_id: noteId, password })
      });
      const data = await res.json();
      if (!data.valid) return showToast('Mật khẩu sai!');
    } catch (e) { return showToast('Lỗi xác thực'); }
  }
  
  showNoteDetail(noteId);
}


function editFromDetail() {
  if (!detailNoteObj) return;
  const n = detailNoteObj;
  currentNoteId = n.id;
  currentNotePinned = n.pinned;
  el('note_title').value = n.title;
  el('note_content').value = n.content;
  el('note_color').value = n.note_color || '#ffffff';
  
  // XỬ LÝ AN TOÀN CHO ATTACHMENTS KHI SỬA
  try {
      currentAttachments = n.attachments ? JSON.parse(n.attachments) : [];
      if(!Array.isArray(currentAttachments)) throw new Error();
  } catch (e) {
      if (n.attachments && n.attachments.startsWith('data:')) {
          currentAttachments = [{ name: 'Ảnh cũ', type: 'image/png', data: n.attachments }];
      } else {
          currentAttachments = [];
      }
  }
  renderAttachmentPreviews();

  el('editor-title').innerText = 'Chỉnh sửa ghi chú';
  el('pin-current-btn').disabled = false;
  el('pin-current-btn').innerText = n.pinned ? '📌 Bỏ ghim' : 'Ghim';
  
  loadLabelsForCurrentNote();
  initSocket(currentNoteId);
  closeNoteDetailModal();
  openEditorModal(); // Mở modal editor
}

async function deleteFromDetail() {
  if (!detailNoteObj || !confirm('Xoá ghi chú này?')) return;
  try {
    await fetch(`${API_URL}/delete-note/${detailNoteObj.id}`, { method: 'DELETE' });
    if (currentNoteId === detailNoteObj.id) newNote();
    loadAllData();
    closeNoteDetailModal();
  } catch (e) { showToast('Lỗi xoá ghi chú'); }
}

async function togglePinFromDetail() {
  if (!detailNoteObj) return;
  const newStatus = !detailNoteObj.pinned;
  try {
    await fetch(`${API_URL}/pin-note/${detailNoteObj.id}`, {
      method: 'PUT', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({pinned: newStatus})
    });
    detailNoteObj.pinned = newStatus;
    if (currentNoteId === detailNoteObj.id) {
      currentNotePinned = newStatus;
      el('pin-current-btn').innerText = newStatus ? '📌 Bỏ ghim' : 'Ghim';
    }
    el('detail-pin-btn').innerText = newStatus ? '📌 Bỏ ghim' : '📍 Ghim';
    await loadAllData();
  } catch (e) { showToast('Lỗi ghim'); }
}

// --- Save Logic ---
function triggerAutoSave() {
  el('status').innerText = '⏳ Đang nhập...';
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(manualSave, 2000);
}

// --- KHÓA GHI CHÚ BẰNG MODAL ---
function openLockModal() {
  if(!detailNoteObj) return;
  const isLocked = !!detailNoteObj.password_hash;
  el('lock-modal').classList.add('show');
  el('lock_pass1').value = ''; el('lock_pass2').value = ''; el('lock_pass_old').value = '';
  
  if(isLocked) {
     el('lock-modal-title').innerText = "Gỡ Khóa Ghi Chú";
     el('lock-modal-desc').innerText = "Nhập mật khẩu hiện tại để gỡ khóa bảo vệ.";
     el('lock-inputs-new').style.display = 'none';
     el('lock-inputs-old').style.display = 'block';
  } else {
     el('lock-modal-title').innerText = "Khóa Ghi Chú";
     el('lock-modal-desc').innerText = "Nhập mật khẩu (2 lần) để bảo vệ ghi chú này.";
     el('lock-inputs-old').style.display = 'none';
     el('lock-inputs-new').style.display = 'grid';
  }
}

async function submitLockAction() {
  const isLocked = !!detailNoteObj.password_hash;
  const p1 = el('lock_pass1').value;
  const p2 = el('lock_pass2').value;
  const oldP = el('lock_pass_old').value;

  // 1. Nếu đang có khóa -> Bắt buộc nhập mật khẩu cũ
  if (isLocked) {
    if (!oldP) return showToast("Bạn phải nhập mật khẩu hiện tại!");
    const verify = await fetch(`${API_URL}/verify-note-password`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({note_id: detailNoteObj.id, password: oldP})
    });
    if (!(await verify.json()).valid) return showToast("Mật khẩu hiện tại không đúng!");
  }

  // 2. Nếu muốn cài mật khẩu mới (hoặc đổi) -> Phải nhập 2 lần giống nhau
  if (p1 || p2) {
    if (p1 !== p2) return showToast("Mật khẩu mới không khớp nhau!");
    updateLockStatus(p1); // Khóa hoặc Đổi
  } else {
    // Nếu cả 2 để trống và đã qua bước verify mật khẩu cũ -> Gỡ khóa
    if (confirm("Bạn có chắc muốn gỡ bỏ mật khẩu?")) updateLockStatus("");
  }
}

async function updateLockStatus(password) {
  try {
    const res = await fetch(`${API_URL}/toggle-note-lock`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ note_id: detailNoteObj.id, password }) });
    if ((await res.json()).success) {
      showToast(password ? 'Đã khóa ghi chú thành công!' : 'Đã gỡ khóa ghi chú thành công!');
      el('lock-modal').classList.remove('show'); closeNoteDetailModal(); loadAllData();
    }
  } catch (e) { showToast('Lỗi cập nhật khoá'); }
}

// --- CHIA SẺ GHI CHÚ BẰNG MODAL ---
function openShareModal() { el('share-modal').classList.add('show'); el('share_email').value = ''; }

async function submitShareNote() {
  const email = el('share_email').value, perm = el('share_permission').value;
  if(!email) return showToast("Nhập email!");
  try {
    const res = await fetch(`${API_URL}/share-note`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ note_id: detailNoteObj.id, email, permission: perm }) });
    const data = await res.json();
    showToast(data.message || data.error);
    if(data.success) { 
        el('share-modal').classList.remove('show'); 
        loadSharesList(detailNoteObj.id); 
    }
  } catch (e) { showToast('Lỗi chia sẻ ghi chú'); }
}

// Load danh sách cho Owner xem
async function loadSharesList(noteId) {
  const res = await fetch(`${API_URL}/note-shares/${noteId}`);
  const list = await res.json();
  const box = el('shares-list-container');
  if(list.length === 0) box.innerHTML = "<i>Chưa chia sẻ cho ai</i>";
  else box.innerHTML = list.map(s => `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-bottom:1px solid var(--border); padding-bottom:8px;">
      <div>
        <b>${s.email}</b><br>
        <span style="color:var(--muted)">Quyền: ${s.permission} | ${new Date(s.shared_at).toLocaleDateString()}</span>
      </div>
      <button onclick="revokeShare(${noteId}, ${s.user_id})" class="ghost" style="padding:4px 8px; font-size:12px; color:var(--danger)">Thu hồi</button>
    </div>
  `).join('');
}

async function revokeShare(noteId, userId) {
  if(!confirm("Bạn có chắc chắn muốn thu hồi quyền truy cập của người này?")) return;
  await fetch(`${API_URL}/revoke-share/${noteId}/${userId}`, {method: 'DELETE'});
  loadSharesList(noteId);
}

async function manualSave() {
  if (!currentUserId) return;
  const title = el('note_title').value.trim();
  const content = el('note_content').value.trim();
  if (!title && !content) return;

  const body = {
    user_id: currentUserId,
    title: title || 'Không tiêu đề',
    content: content,
    attachments: JSON.stringify(currentAttachments),
    note_color: el('note_color').value
  };

  el('status').innerText = '💾 Đang lưu...';
  try {
    const url = currentNoteId ? `${API_URL}/update-note/${currentNoteId}` : `${API_URL}/add-note`;
    const method = currentNoteId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method, headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.note_id || data.message) {
      if (!currentNoteId && data.note_id) currentNoteId = data.note_id;
      el('status').innerText = '✅ Đã lưu lúc ' + new Date().toLocaleTimeString();
      el('pin-current-btn').disabled = false;
      await loadAllData();
      broadcastEdit();
    }
  } catch (e) { el('status').innerText = '❌ Lỗi lưu dữ liệu'; }
}

function newNote() {
  currentNoteId = null;
  currentNotePinned = false;
  el('note_title').value = ''; el('note_content').value = '';
  el('note_color').value = '#ffffff';
  currentAttachments = [];
  renderAttachmentPreviews();
  el('editor-title').innerText = 'Ghi chú mới';
  el('pin-current-btn').disabled = true;
  currentNoteLabels = [];
  renderCurrentNoteLabels();
  openEditorModal(); // Mở modal
}

function clearFormOnly() {
  el('note_title').value = ''; el('note_content').value = '';
  el('note_image_url').value = ''; el('note_color').value = currentPrefs.note_bg_color || '#ffffff';
  currentAttachments = [];
  renderAttachmentPreviews();
  updateEditorImagePreview();
}

async function toggleCurrentPin() {
  if (!currentNoteId) return;
  const newStatus = !currentNotePinned;
  try {
    await fetch(`${API_URL}/pin-note/${currentNoteId}`, {
      method: 'PUT', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({pinned: newStatus})
    });
    currentNotePinned = newStatus;
    el('pin-current-btn').innerText = newStatus ? '📌 Bỏ ghim' : 'Ghim';
    await loadAllData();
  } catch (e) { showToast('Lỗi cập nhật ghim'); }
}
// --- Utility Functions ---
function showToast(message, type = 'success') {
  const container = el('toast-container');
  if (!container) return; // Đảm bảo đã có <div id="toast-container"> ở index.html

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  // Màu sắc theo loại
  const colors = {
    success: '#10b981',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6'
  };

  toast.style.backgroundColor = colors[type] || colors.success;
  toast.innerText = message;

  container.appendChild(toast);

  // Tự động xóa sau 3 giây
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-in forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function showSkeletons() {
  const container = el('note_list');
  container.innerHTML = Array(4).fill(0).map(() => `
    <div class="note-card skeleton" style="height: 150px; background: #e2e8f0; opacity: 0.5;">
      <div style="width: 60%; height: 20px; background: #cbd5e1; margin-bottom: 10px;"></div>
      <div style="width: 90%; height: 15px; background: #cbd5e1;"></div>
    </div>
  `).join('');
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .then(() => console.log("Service Worker đã sẵn sàng!"))
    .catch((err) => console.log("Lỗi SW:", err));
}
// --- Offline Support with IndexedDB ---
// Cấu hình IndexedDB
const dbName = "NoteAppOfflineDB";
let db;

const request = indexedDB.open(dbName, 1);
request.onupgradeneeded = (e) => {
  db = e.target.result;
  // Tạo kho chứa ghi chú
  if (!db.objectStoreNames.contains("notes")) {
    db.createObjectStore("notes", { keyPath: "id" });
  }
};
request.onsuccess = (e) => { db = e.target.result; };

// Hàm lưu ghi chú vào máy cục bộ
function saveNoteLocally(note) {
  const transaction = db.transaction(["notes"], "readwrite");
  transaction.objectStore(transaction.objectStoreNames[0]).put(note);
}

// Hàm lấy ghi chú từ máy cục bộ khi mất mạng
function getLocalNotes() {
  return new Promise((resolve) => {
    const transaction = db.transaction(["notes"], "readonly");
    const store = transaction.objectStore("notes");
    store.getAll().onsuccess = (e) => resolve(e.target.result);
  });
}

//  Đồng bộ dữ liệu khi có kết nối trở lại

window.addEventListener('online', () => {
  showToast("Đã có kết nối Internet. Đang đồng bộ dữ liệu...");
  loadAllData();
});

window.addEventListener('offline', () => {
  showToast("Đã mất kết nối Internet. Chế độ ngoại tuyến đã kích hoạt.", "warning");
});

// Kiểm tra trạng thái mạng khi trang được tải
window.addEventListener('load', () => {
  if (!navigator.onLine) {
    showToast("Bạn đang ở chế độ ngoại tuyến. Một số tính năng có thể bị hạn chế.", "warning");
  }
});
// Thêm vào script.js để theo dõi các thay đổi chưa được đồng bộ
let pendingSync = false;
// Khi người dùng thực hiện thao tác lưu, nếu đang offline thì đánh dấu cần đồng bộ
async function manualSave() {
  if (!currentUserId) return;
  
  // Lấy dữ liệu từ giao diện
  const title = el('note_title').value.trim();
  const content = el('note_content').value.trim();
  const note_color = el('note_color').value;

  if (!title && !content) return; // Không lưu nếu trống rỗng

  const body = {
    user_id: currentUserId,
    title: title || 'Không tiêu đề',
    content: content,
    attachments: JSON.stringify(currentAttachments),
    note_color: note_color
  };

  // Xử lý Offline (Tiêu chí 27)
  if (!navigator.onLine) {
    saveNoteLocally({ ...body, id: currentNoteId || Date.now(), syncNeeded: true });
    showToast("Đang offline. Ghi chú đã lưu vào máy.", "warning");
    return;
  }

  el('status').innerText = '💾 Đang lưu...';
  try {
    const url = currentNoteId ? `${API_URL}/update-note/${currentNoteId}` : `${API_URL}/add-note`;
    const method = currentNoteId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method, headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.note_id || data.message) {
      if (!currentNoteId && data.note_id) currentNoteId = data.note_id;
      el('status').innerText = '✅ Đã lưu: ' + new Date().toLocaleTimeString();
      el('pin-current-btn').disabled = false;
      await loadAllData(); // Tải lại để cập nhật danh sách
      broadcastEdit();
    }
  } catch (e) { 
    el('status').innerText = '❌ Lỗi kết nối'; 
    saveNoteLocally({ ...body, id: currentNoteId || Date.now(), syncNeeded: true });
  }
}

// Lắng nghe sự kiện Online để đẩy dữ liệu lên
window.addEventListener('online', async () => {
  showToast("Đã có mạng lại! Đang đồng bộ các thay đổi...");
  
  const localNotes = await getLocalNotes();
  const notesToSync = localNotes.filter(n => n.syncNeeded);

  for (let note of notesToSync) {
    // Gọi API để lưu từng ghi chú chưa đồng bộ
    // Sau đó xóa flag syncNeeded
  }
  
  loadAllData(); // Tải lại toàn bộ dữ liệu mới nhất
});