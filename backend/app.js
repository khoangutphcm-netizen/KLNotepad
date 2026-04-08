const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const path = require('path');
require("dotenv").config({ path: path.join(__dirname, '.env') });
const http = require('http');
const { Server } = require("socket.io");

const app = express();
app.use(express.static(__dirname)); // This tells Express to serve index.html, style.css, etc.
app.use(express.static(path.join(__dirname, '../frontend/')));  // Serve from parent directory to access frontend files
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Debug: Check if .env loaded
console.log("=== ENVIRONMENT VARIABLES CHECK ===");
console.log("EMAIL_USER exists:", !!process.env.EMAIL_USER);
console.log("EMAIL_PASS exists:", !!process.env.EMAIL_PASS);
if (process.env.EMAIL_USER) {
  console.log("EMAIL_USER value:", process.env.EMAIL_USER);
  console.log("EMAIL_PASS length:", process.env.EMAIL_PASS ? process.env.EMAIL_PASS.length : 0);
} else {
  console.log("❌ .env file not loaded or missing variables");
  console.log("Current directory:", __dirname);
}

app.use(cors({ // Allow all origins for development; adjust in production
  origin: [
    "http://127.0.0.1:5500", // Added for testing with
    "http://localhost:5500", // Added for testing with live server extension
    "http://192.168.1.156:5500", // Added for testing on local network
    "http://localhost:3000", // Original allowed origin
    "http://192.168.1.156:3000", // Added for testing on local network with original port
    " ", // Placeholder for future frontend URL
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true, // Allow cookies if needed
}));
app.options("*", cors());
app.use(express.json({ limit: '100mb' }));
// Check for email credentials
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
  console.error("❌ EMAIL CREDENTIALS MISSING!");
  console.error("Please create .env file with:");
  console.error("EMAIL_USER=your-email@gmail.com");
  console.error("EMAIL_PASS=your-app-password");
}

// Gmail SMTP transporter
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // App password
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
});
// Verify transporter on startup
transporter.verify((error, success) => {
  if (error) {
    console.error("❌ Email transporter error:", error);
  } else {
    console.log("✅ Email transporter ready to send");
  }
});
// ================= DB =================
const dbConfig = {
  host: process.env.DB_HOST || 'db',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || 'root_password', // Khớp với docker-compose.yml
  database: process.env.DB_NAME || 'notepad_final',
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// Tạo một "hồ chứa" kết nối (Pool)
const pool = mysql.createPool(dbConfig);

// Chuyển đối tượng db thành pool để không phải sửa các câu lệnh db.query bên dưới
const db = pool; 

// Kiểm tra kết nối ban đầu
pool.getConnection((err, connection) => {
  if (err) {
    console.error("❌ Lỗi kết nối MySQL:", err.message);
  } else {
    console.log("✅ Đã kết nối MySQL thành công qua Docker (Sử dụng Pool)");
    connection.release(); // Trả lại kết nối vào hồ chứa
  }
});

// Chống sập server khi có lỗi DB bất ngờ
process.on('uncaughtException', (err) => {
    console.error('Có lỗi hệ thống chưa được xử lý:', err);
});

let dbdisconnected;

function handleDisconnect() {
  dbdisconnected = mysql.createConnection(dbConfig);

  dbdisconnected.connect((err) => {
    if (err) {
      console.error("❌ Lỗi kết nối DB (Đang thử lại sau 2 giây...):", err.message);
      setTimeout(handleDisconnect, 2000); // Nếu lỗi, đợi 2 giây rồi thử lại
    } else {
      console.log("✅ Đã kết nối MySQL thành công qua Docker");
    }
  });

  dbdisconnected.on('error', (err) => {
    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
      handleDisconnect();
    } else {
      throw err;
    }
  });
}

handleDisconnect(); // Gọi hàm khởi động kết nối
 

// ================= AUTH =================
app.post("/register", async (req, res) => {
  const { email, display_name, password } = req.body; // Added display_name from ai_studio_code
  if (!email || !password || !display_name) {
    return res.status(400).json({ error: "Thiếu dữ liệu" });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const activationToken = crypto.randomBytes(32).toString("hex");

    db.query(
      "INSERT INTO users (email, password_hash, activation_token, is_verified, display_name) VALUES (?, ?, ?, 0, ?)",
      [email, hashedPassword, activationToken, display_name],
      async (err, result) => {
        if (err) {
          console.error("REGISTER ERROR:", err);
          return res.status(400).json({ error: "Email đã tồn tại hoặc lỗi DB" });
        }

        const newUserId = result.insertId;
        const activationLink = `${req.protocol}://${req.get("host")}/activate?token=${activationToken}`;
        console.log("REGISTER OK - Activation link:", activationLink);

        try {
          await transporter.sendMail({
            from: `"NoteApp" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: "Kích hoạt tài khoản",
            html: `
              <h2>Kích hoạt tài khoản</h2>
              <p>Click link bên dưới để kích hoạt tài khoản của bạn:</p>
              <a href="${activationLink}">${activationLink}</a>
            `,
          });
          // Trả về ID luôn để FE tự động đăng nhập
          res.json({ 
            message: "Đăng ký thành công! Đang tự động đăng nhập...",
            user_id: newUserId,
            is_verified: 0 
          });
        } catch (mailErr) {
          console.error("SEND MAIL ERROR:", mailErr);
          res.status(500).json({ error: "Đăng ký thành công nhưng gửi email lỗi." });
        }
      }
    );
  } catch (e) {
    console.error("REGISTER FATAL:", e);
    res.status(500).json({ error: "Lỗi server" });
  }
});

// Login route
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Thiếu email hoặc mật khẩu" });
  }

  db.query("SELECT * FROM users WHERE email = ?", [email], async (err, results) => {
    if (err) {
      console.error("LOGIN DB ERROR:", err);
      return res.status(500).json({ error: "Lỗi server" });
    }
    if (results.length === 0) {
      return res.status(401).json({ error: "Sai email hoặc mật khẩu" });
    }

    const user = results[0];
    
    // BỎ CHẶN KIỂM TRA is_verified ĐỂ CHO PHÉP TRUY CẬP TOÀN BỘ TÍNH NĂNG
    // if (user.is_verified !== 1) {
    //   return res.status(403).json({ error: "Tài khoản chưa được kích hoạt." });
    // }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: "Sai mật khẩu" });
    }

    console.log("LOGIN OK:", user.id, user.email);
    res.json({ 
      user_id: user.id, 
      is_verified: user.is_verified 
    });   
  });
});

// Account activation route
app.get("/activate", (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send("Thiếu token");

  db.query(
    "UPDATE users SET is_verified = 1, activation_token = NULL WHERE activation_token = ?",
    [token],
    (err, result) => {
      if (err) {
        console.error("ACTIVATE ERROR:", err);
        return res.status(500).send("Lỗi server");
      }
      if (result.affectedRows === 0) {
        return res.status(400).send("Token không hợp lệ hoặc đã dùng");
      }
      console.log("ACTIVATE OK:", token);
      // Đổi thành redirect về trang web kèm theo query báo thành công
      res.redirect("/index.html?activated=true");
    }
  );
});

// Resend activation email
app.post("/resend-activation", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Thiếu email" });

  db.query(
    "SELECT id, activation_token FROM users WHERE email = ? AND is_verified = 0",
    [email],
    async (err, results) => {
      if (err) {
        console.error("RESEND DB ERROR:", err);
        return res.status(500).json({ error: "Lỗi server" });
      }
      if (results.length === 0) {
        return res.status(404).json({ error: "Email không tồn tại hoặc đã kích hoạt" });
      }

      const user = results[0];
      let token = user.activation_token;
      if (!token) {
        token = crypto.randomBytes(32).toString("hex");
        db.query("UPDATE users SET activation_token = ? WHERE id = ?", [token, user.id]);
      }

      const activationLink = `${req.protocol}://${req.get("host")}/activate?token=${token}`;
      try {
        await transporter.sendMail({
          from: `"NoteApp" <${process.env.EMAIL_USER}>`,
          to: email,
          subject: "Kích hoạt tài khoản (gửi lại)",
          html: `<a href="${activationLink}">${activationLink}</a>`,
        });
        res.json({ message: "Đã gửi lại email kích hoạt." });
      } catch (mailErr) {
        console.error("RESEND MAIL ERROR:", mailErr);
        res.status(500).json({ error: "Gửi email thất bại." });
      }
    }
  );
});

// ================= USER PROFILE =================
app.get("/user-profile/:id", (req, res) => {
  db.query("SELECT id, email, display_name, profile_image, is_verified FROM users WHERE id = ?", [req.params.id], (err, results) => {
    if (err) return res.status(500).json({ error: "Lỗi server" });
    if (results.length === 0) return res.status(404).json({ error: "Không tìm thấy user" });
    res.json(results[0]);
  });
});

app.put("/user-profile/:id", (req, res) => {
  const { display_name, profile_image } = req.body;
  db.query("UPDATE users SET display_name = ?, profile_image = ? WHERE id = ?", 
    [display_name, profile_image, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: "Lỗi cập nhật profile" });
      res.json({ message: "Đã cập nhật hồ sơ thành công!" });
  });
});

// ================= CHANGE PASSWORD (from ai_studio_code) =================
app.post("/change-password", async (req, res) => {
  const { user_id, oldPassword, newPassword } = req.body;
  db.query("SELECT password_hash FROM users WHERE id = ?", [user_id], async (err, results) => {
    if (err || results.length === 0) return res.status(500).json({ error: "Lỗi server" });
    const match = await bcrypt.compare(oldPassword, results[0].password_hash);
    if (!match) return res.status(400).json({error: "Mật khẩu cũ không chính xác"});
    const hash = await bcrypt.hash(newPassword, 10);
    db.query("UPDATE users SET password_hash = ? WHERE id = ?", [hash, user_id], () => res.json({message: "Đổi mật khẩu thành công"}));
  });
});

// Real-time Collaboration Logic
io.on("connection", (socket) => {
  socket.on("join-note", (noteId) => {
    socket.join(`note-${noteId}`);
  });

  socket.on("edit-note", (data) => {
    socket.to(`note-${data.noteId}`).emit("note-updated", data);
  });
});


// ================= NOTES =================
app.post("/add-note", (req, res) => {
  const { user_id, title, content, attachments, note_color } = req.body;
  if (!user_id) return res.status(400).json({ error: "Thiếu user_id" });
  db.query(
    "INSERT INTO notes (user_id, title, content, attachments, note_color, pinned, pinned_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, NULL, NOW())",
    [user_id, title || "", content || "", attachments || null, note_color || "#ffffff"],
    (err, result) => {
      if (err) { console.error("ADD NOTE ERROR:", err); return res.status(500).json({ error: "Lỗi thêm ghi chú" }); }
      res.json({ note_id: result.insertId });
    }
  );
});

app.get("/notes/:user_id", (req, res) => {
  const { user_id } = req.params;
  db.query(
    `SELECT id, user_id, title, content, attachments, note_color, password_hash, pinned, pinned_at, updated_at
     FROM notes WHERE user_id = ? ORDER BY pinned DESC, pinned_at DESC, updated_at DESC`,
    [user_id],
    (err, result) => {
      if (err) { console.error("LOAD NOTES ERROR:", err); return res.status(500).json({ error: "Lỗi tải ghi chú" }); }
      res.json(result);
    }
  );
});

app.get("/note/:id", (req, res) => {
  db.query(
    "SELECT id, user_id, title, content, attachments, note_color, password_hash, pinned, pinned_at, updated_at FROM notes WHERE id = ?",
    [req.params.id],
    (err, result) => {
      if (err) return res.status(500).json({ error: "Lỗi server" });
      if (result.length === 0) return res.status(404).json({ error: "Không tìm thấy" });
      res.json(result[0]);
    }
  );
});

app.put("/update-note/:id", (req, res) => {
  const { title, content, attachments, note_color } = req.body;
  // attachments ở đây là JSON.stringify(currentAttachments)
  const sql = "UPDATE notes SET title = ?, content = ?, attachments = ?, note_color = ?, updated_at = NOW() WHERE id = ?";
  db.query(sql, [title, content, attachments, note_color, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Đã cập nhật" });
  });
});

app.put("/pin-note/:id", (req, res) => {
  const { pinned } = req.body;
  const isPinned = pinned ? 1 : 0;
  const pinnedAt = isPinned ? new Date() : null;
  db.query(
    "UPDATE notes SET pinned = ?, pinned_at = ? WHERE id = ?",
    [isPinned, pinnedAt, req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: "Lỗi pin" });
      res.json({ message: "Đã cập nhật pin", pinned: isPinned, pinned_at: pinnedAt });
    }
  );
});

app.delete("/notes/:note_id/labels/:label_id", (req, res) => {
  const { note_id, label_id } = req.params;
  db.query(
    "DELETE FROM note_labels WHERE note_id = ? AND label_id = ?",
    [note_id, label_id],
    (err) => {
      if (err) return res.status(500).json({ error: "Lỗi xoá nhãn khỏi ghi chú" });
      res.json({ message: "Đã gỡ nhãn" });
    }
  );
});

// ================= LABELS =================
app.get("/labels/:user_id", (req, res) => {
  db.query("SELECT id, name, color FROM labels WHERE user_id = ? ORDER BY name", [req.params.user_id], (err, results) => {
    if (err) return res.status(500).json({ error: "Lỗi DB" });
    res.json(results);
  });
});

app.post("/labels", (req, res) => {
  const { user_id, name, color } = req.body;
  db.query("INSERT INTO labels (user_id, name, color) VALUES (?, ?, ?)", [user_id, name, color], (err, result) => {
    if (err) return res.status(500).json({ error: "Lỗi thêm nhãn" });
    res.json({ id: result.insertId });
  });
});


app.put("/labels/:id", (req, res) => {
  const { name, color } = req.body;
  db.query("UPDATE labels SET name = ?, color = ? WHERE id = ?", [name, color, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: "Lỗi cập nhật" });
    res.json({ success: true });
  });
});

app.delete("/labels/:id", (req, res) => {
  db.query("DELETE FROM labels WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: "Lỗi xóa nhãn" });
    res.json({ message: "Đã xóa" });
  });
});

app.get("/notes/:note_id/labels", (req, res) => {
  const { note_id } = req.params;
  db.query(
    `SELECT l.id, l.name FROM labels l
     JOIN note_labels nl ON l.id = nl.label_id
     WHERE nl.note_id = ?`,
    [note_id],
    (err, results) => {
      if (err) return res.status(500).json({ error: "Lỗi lấy nhãn của ghi chú" });
      res.json(results);
    }
  );
});

app.put("/notes/:note_id/labels", (req, res) => {
  const { note_id } = req.params;
  const { label_ids } = req.body;
  db.query("DELETE FROM note_labels WHERE note_id = ?", [note_id], (err) => {
    if (err) return res.status(500).json({ error: "Lỗi cập nhật nhãn" });
    if (!label_ids || label_ids.length === 0) return res.json({ message: "Đã cập nhật" });
    const values = label_ids.map(label_id => [note_id, label_id]);
    db.query("INSERT INTO note_labels (note_id, label_id) VALUES ?", [values], (err2) => {
      if (err2) return res.status(500).json({ error: "Lỗi thêm nhãn" });
      res.json({ message: "Đã cập nhật nhãn" });
    });
  });
});

// ================= PREFERENCES =================
app.get("/preferences/:user_id", (req, res) => {
  const { user_id } = req.params;
  db.query(
    "SELECT font_size, theme, note_bg_color FROM user_preferences WHERE user_id = ?",
    [user_id],
    (err, results) => {
      if (err) return res.status(500).json({ error: "Lỗi DB" });
      if (results.length === 0) {
        const defaults = { font_size: 16, theme: "light", note_bg_color: "#ffffff" };
        db.query(
          "INSERT INTO user_preferences (user_id, font_size, theme, note_bg_color) VALUES (?, ?, ?, ?)",
          [user_id, defaults.font_size, defaults.theme, defaults.note_bg_color],
          (err2) => {
            if (err2) return res.status(500).json({ error: "Lỗi tạo preferences" });
            res.json(defaults);
          }
        );
      } else {
        res.json(results[0]);
      }
    }
  );
});

app.post("/preferences/:user_id", (req, res) => {
  const { user_id } = req.params;
  const { font_size, theme, note_bg_color } = req.body;
  db.query(
    `INSERT INTO user_preferences (user_id, font_size, theme, note_bg_color)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE font_size = VALUES(font_size), theme = VALUES(theme), note_bg_color = VALUES(note_bg_color)`,
    [user_id, font_size, theme, note_bg_color],
    (err) => {
      if (err) return res.status(500).json({ error: "Lỗi lưu preferences" });
      res.json({ message: "Đã lưu cài đặt" });
    }
  );
});

// ================= NOTE PASSWORDS =================
app.post("/verify-note-password", (req, res) => {
  const { note_id, password } = req.body;
  db.query("SELECT password_hash FROM notes WHERE id = ?", [note_id], async (err, results) => {
    if (err || results.length === 0) return res.json({ valid: false });
    const match = await bcrypt.compare(password, results[0].password_hash);
    res.json({ valid: match });
  });
});

app.post("/toggle-note-lock", async (req, res) => {
  const { note_id, password } = req.body;
  const hash = password ? await bcrypt.hash(password, 10) : null;
  db.query("UPDATE notes SET password_hash = ? WHERE id = ?", [hash, note_id], (err) => {
    if (err) return res.status(500).json({ error: "Lỗi cập nhật khoá" });
    res.json({ success: true });
  });
});

// ================= HEALTH CHECK =================
app.get("/", (req, res) => {
  res.send("Backend is running");
});

app.delete("/delete-note/:id", (req, res) => {
  db.query("DELETE FROM notes WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: "Lỗi xóa ghi chú" });
    res.json({ message: "Xóa thành công" });
  });
});

// Test email route
app.get("/test-email", async (req, res) => {
  try {
    const info = await transporter.sendMail({
      from: `"Test" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER || "524h0101@student.tdtu.edu.vn",
      subject: "Test Gmail SMTP",
      html: "<h1>OK - Gmail SMTP works</h1>",
    });
    res.json(info);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- AUTH: Password Reset (from both files, combined) ---
app.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  const token = crypto.randomBytes(20).toString('hex');
  const expires = new Date(Date.now() + 3600000); // 1 hour

  db.query("UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE email = ?", 
    [token, expires, email], async (err, result) => {
      if (err) return res.status(500).json({ error: "Lỗi server" });
      if (result.affectedRows === 0) return res.status(404).json({error: "Email không tồn tại"});
      
      const link = `http://127.0.0.1:3000/index.html?resetToken=${token}`; // Adjust to your frontend URL
      try {
        await transporter.sendMail({
          to: email,
          subject: "Khôi phục mật khẩu",
          html: `<p>Click vào link để đổi mật khẩu: <a href="${link}">${link}</a></p>`
        });
        res.json({message: "Đã gửi email khôi phục"});
      } catch (mailErr) {
        console.error("FORGOT PASSWORD MAIL ERROR:", mailErr);
        res.status(500).json({ error: "Gửi email thất bại." });
      }
  });
});

// Reset password route
app.post("/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;
  const hashed = await bcrypt.hash(newPassword, 10);
  db.query("UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE reset_token = ? AND reset_token_expires > NOW()",
    [hashed, token], (err, result) => {
      if (err) return res.status(500).json({ error: "Lỗi server" });
      if (result.affectedRows === 0) return res.status(400).json({error: "Token hết hạn hoặc không hợp lệ"});
      res.json({message: "Đổi mật khẩu thành công"});
  });
});

// --- ADVANCED NOTE MGMT: Passwords (unified) ---
app.put("/note-lock/:id", async (req, res) => {
  const { password } = req.body; // if empty, unlock
  const hash = password ? await bcrypt.hash(password, 10) : null;
  db.query("UPDATE notes SET password_hash = ? WHERE id = ?", [hash, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: "Lỗi cập nhật khoá" });
    res.json({ message: "Updated lock status", success: true });
  });
});

app.post("/note-verify-password/:id", (req, res) => {
  const { password } = req.body;
  db.query("SELECT password_hash FROM notes WHERE id = ?", [req.params.id], async (err, results) => {
    if (err || results.length === 0) return res.status(404).json({ error: "Note not found" });
    const match = await bcrypt.compare(password, results[0].password_hash);
    if (match) res.json({ success: true });
    else res.status(401).json({ error: "Sai mật khẩu" });
  });
});

// --- SHARING (Enhanced from ai_studio_code) ---
app.post("/share-note", (req, res) => {
  const { note_id, email, permission } = req.body;
  db.query("SELECT id FROM users WHERE email = ?", [email], (err, users) => {
    if (err) return res.status(500).json({error: "Lỗi server"});
    if (users.length === 0) return res.status(404).json({error: "Email không tồn tại trong hệ thống!"});
    const recipientId = users[0].id;
    
    db.query("INSERT INTO note_shares (note_id, shared_with_user_id, permission, shared_at) VALUES (?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE permission = ?",
      [note_id, recipientId, permission, permission], async (err) => {
        if(err) return res.status(500).json({error: "Lỗi lưu DB"});
        try {
          await transporter.sendMail({
            from: `"NoteApp" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: "Ai đó đã chia sẻ ghi chú với bạn",
            html: `<p>Bạn vừa được chia sẻ một ghi chú trên NoteApp với quyền: <b>${permission}</b>.</p><p>Hãy đăng nhập để xem chi tiết.</p>`
          });
        } catch(e) { console.log("Lỗi gửi mail share", e); }
        res.json({success: true, message: "Đã chia sẻ thành công và gửi Email thông báo!"});
    });
  });
});

app.get("/shared-with-me/:user_id", (req, res) => {
  db.query(`
    SELECT n.*, ns.permission, ns.shared_at, u.email as owner_email, u.profile_image as owner_image
    FROM notes n 
    JOIN note_shares ns ON n.id = ns.note_id 
    JOIN users u ON n.user_id = u.id
    WHERE ns.shared_with_user_id = ?`, 
    [req.params.user_id], 
    (err, results) => {
      if (err) return res.status(500).json({ error: "Lỗi server" });
      res.json(results);
  });
});

// Lấy danh sách những người đang được share (dành cho Owner)
app.get("/note-shares/:note_id", (req, res) => {
  db.query(`SELECT ns.shared_with_user_id as user_id, u.email, ns.permission, ns.shared_at 
            FROM note_shares ns 
            JOIN users u ON ns.shared_with_user_id = u.id 
            WHERE ns.note_id = ?`, 
    [req.params.note_id], 
    (err, results) => {
      if (err) return res.status(500).json({ error: "Lỗi server" });
      res.json(results || []);
  });
});
// Catch-all route to serve index.html for any non-API request (for SPA routing)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Chủ sở hữu xóa quyền truy cập
app.delete("/revoke-share/:note_id/:user_id", (req, res) => {
  db.query("DELETE FROM note_shares WHERE note_id = ? AND shared_with_user_id = ?", 
    [req.params.note_id, req.params.user_id], 
    (err) => {
      if (err) return res.status(500).json({ error: "Lỗi xóa quyền chia sẻ" });
      res.json({success: true, message: "Đã thu hồi quyền truy cập"});
  });
});

const PORT = process.env.PORT || 3000; // Sử dụng biến môi trường PORT nếu có, mặc định là 3000
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

