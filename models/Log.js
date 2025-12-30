const mongoose = require("mongoose");

const logSchema = new mongoose.Schema({
    user: { type: String, required: true }, // 작업자 (username 또는 nickname)
    action: { type: String, required: true }, // 동작 (추가, 삭제, 수정 등)
    category: { type: String, required: true }, // 분류 (Inventory, Attendance, Auth, System)
    targetId: { type: String }, // 대상 ID (Optional)
    details: { type: String }, // 세부 내용
    timestamp: { type: Date, default: Date.now }
});

// [Retention Policy] 로그 비대화 방지를 위한 TTL 인덱스 (180일 후 자동 삭제)
logSchema.index({ timestamp: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });

// 카테고리 필터링 성능 최적화
logSchema.index({ category: 1 });

module.exports = mongoose.model("Log", logSchema);
