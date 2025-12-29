const express = require("express");
const router = express.Router();
const Attendance = require("../models/Attendance");
const User = require("../models/User");

// 1. 상태 확인 (오늘 출퇴근 했는지)
router.get("/status/:username", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const user = await User.findOne({ username: req.params.username });
    const record = await Attendance.findOne({ userId: user._id, date: today });
    res.json(record);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 2. 출근 처리
router.post("/check-in", async (req, res) => {
  try {
    const { username, nickname } = req.body;
    const today = new Date().toISOString().split("T")[0];
    const user = await User.findOne({ username });
    const exists = await Attendance.findOne({ userId: user._id, date: today });
    if (exists) return res.status(400).json({ message: "이미 출근했습니다." });

    const newIn = new Attendance({
      userId: user._id,
      username,
      nickname,
      date: today,
      clockIn: new Date(),
    });
    await newIn.save();
    res.json({ time: newIn.clockIn });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 3. 퇴근 처리
router.post("/check-out", async (req, res) => {
  try {
    const { username } = req.body;
    const today = new Date().toISOString().split("T")[0];
    const user = await User.findOne({ username });
    const record = await Attendance.findOne({ userId: user._id, date: today });
    if (!record)
      return res.status(400).json({ message: "출근 기록이 없습니다." });
    if (record.clockOut)
      return res.status(400).json({ message: "이미 퇴근했습니다." });

    record.clockOut = new Date();
    record.duration = Math.floor((record.clockOut - record.clockIn) / 1000);
    await record.save();
    res.json({ time: record.clockOut });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 4. 모든 기록 조회 (달력용)
router.get("/all", async (req, res) => {
  try {
    const records = await Attendance.find().sort({ clockIn: 1 });
    res.json(records);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 5. 근무 기록 수정 (달력용)
router.put("/edit/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { nickname, clockIn, clockOut } = req.body;

    const record = await Attendance.findById(id);
    if (!record)
      return res.status(404).json({ message: "기록을 찾을 수 없습니다." });

    record.nickname = nickname;
    record.clockIn = new Date(clockIn);
    if (clockOut) {
      record.clockOut = new Date(clockOut);
      // 근무 시간 재계산 (초 단위)
      record.duration = Math.floor((record.clockOut - record.clockIn) / 1000);
    }

    await record.save();
    res.json({ message: "수정 완료" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
