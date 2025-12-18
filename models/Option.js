const mongoose = require("mongoose");

const optionSchema = new mongoose.Schema({
  type: { type: String, required: true }, // 'itemName', 'size', 'length' 중 하나
  value: { type: String, required: true }, // 실제 값 (예: '파이프', '100mm')
});

module.exports = mongoose.model("Option", optionSchema);
