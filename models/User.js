const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  nickname: { type: String },

  // 관리자/유저 구분 (기본값: user)
  role: { type: String, enum: ["user", "admin"], default: "user" },

  // 승인 여부 (기본값: false -> 로그인 불가)
  isApproved: { type: Boolean, default: false },

  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("User", userSchema);
