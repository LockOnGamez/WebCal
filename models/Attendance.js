const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  username: { type: String, required: true },
  nickname: { type: String },
  date: { type: String, required: true }, // 관리 편의를 위한 YYYY-MM-DD (문자열)
  clockIn: { type: Date, required: true },
  clockOut: { type: Date },
  duration: { type: Number, default: 0 }, // 근무 시간 (초 단위)
  createdAt: { type: Date, default: Date.now },
});

// 특정 유저의 날짜별 기록 조회 최적화
attendanceSchema.index({ userId: 1, date: -1 });

module.exports = mongoose.model("Attendance", attendanceSchema);
