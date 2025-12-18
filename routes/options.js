const express = require("express");
const router = express.Router();
const Option = require("../models/Option");

// 1. 모든 옵션 조회 (프론트엔드 드롭다운용)
router.get("/", async (req, res) => {
  try {
    const options = await Option.find();
    res.json(options);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. 옵션 추가 (관리자용)
router.post("/", async (req, res) => {
  try {
    const { type, value } = req.body;
    // 중복 체크
    const exists = await Option.findOne({ type, value });
    if (exists)
      return res.status(400).json({ message: "이미 존재하는 항목입니다." });

    const newOption = new Option({ type, value });
    await newOption.save();
    res.status(201).json(newOption);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. 옵션 삭제
router.delete("/:id", async (req, res) => {
  try {
    await Option.findByIdAndDelete(req.params.id);
    res.json({ message: "삭제되었습니다." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
