const mongoose = require("mongoose");

// 하위 문서(배열 내부 아이템) 스키마
const subItemSchema = new mongoose.Schema({
  name: String,
  size: String,
  length: String,
  quantity: Number,
  role: String, // 'product'(산출물/입출고대상) 또는 'material'(소모된 원자재)
});

const eventSchema = new mongoose.Schema({
  title: { type: String },
  start: { type: Date, required: true },
  allDay: { type: Boolean, default: true },
  type: { type: String, enum: ["입고", "출고", "생산"], required: true },

  // [변경] 기존 단일 필드들 대신 배열 사용
  items: [subItemSchema],

  createdBy: { type: String },
  createdAt: { type: Date, default: Date.now },
});

// 날짜 및 타입별 필터링 최적화
eventSchema.index({ start: -1, type: 1 });

module.exports = mongoose.model("Event", eventSchema);
