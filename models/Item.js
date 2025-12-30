const mongoose = require("mongoose");

const itemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  size: { type: String }, // [추가] 예: XL, 100mm
  length: { type: String }, // [추가] 예: 10m
  quantity: { type: Number, default: 0 },
  category: { type: String, default: "기타" },
  lastUpdatedBy: { type: String },
  alertEnabled: { type: Boolean, default: true },
  alertThreshold: { type: Number, default: 10 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Item", itemSchema);
