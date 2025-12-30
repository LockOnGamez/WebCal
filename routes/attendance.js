const express = require("express");
const router = express.Router();
const Attendance = require("../models/Attendance");
const User = require("../models/User");
const redisClient = require("../config/redis");
const Log = require("../models/Log");

//한국시간 기준 문자열반환
function getKSTDateString(customDate = new Date()) {
  const d = new Date(customDate);
  const kstDate = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kstDate.toISOString().split("T")[0];
}

// 0. 특정 날짜 기록 조회 (대시보드용 - 캐시 적용)
router.get("/", async (req, res) => {
  try {
    const { date } = req.query; // YYYY-MM-DD
    if (!date) return res.json([]);

    // 1. 레디스 캐시 확인
    const cacheKey = `cache:attendance:${date}`;
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        console.log(`⚡ Redis 캐시 히트: ${cacheKey}`);
        return res.json(JSON.parse(cached));
      }
    } catch (cacheErr) {
      console.error("Redis Read Error:", cacheErr);
    }

    // 2. DB 조회
    const records = await Attendance.find({ date });
    
    // 3. 캐시 저장 (5분 TTL)
    try {
      await redisClient.setEx(cacheKey, 300, JSON.stringify(records));
    } catch (cacheErr) {
      console.error("Redis Write Error:", cacheErr);
    }

    res.json(records);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 1. 상태 확인
router.get("/status/:username", async (req, res) => {
  try {
    const today = getKSTDateString(); // KST 기준 날짜
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.json(null); // 유저가 없으면 null 반환

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
    const today = getKSTDateString(); // KST 기준 날짜
    const user = await User.findOne({ username });

    // [Atomic Lock] 레디스를 이용한 중복 요청 방지 (10초간 잠금)
    const lockKey = `lock:attendance:${user._id}:${today}`;
    const acquired = await redisClient.set(lockKey, "locked", { NX: true, EX: 10 });
    if (!acquired) return res.status(429).json({ message: "이미 요청이 진행 중입니다. 잠시 후 다시 시도해주세요." });

    try {
        // 이미 오늘 날짜(KST)로 기록이 있는지 확인
        const exists = await Attendance.findOne({ userId: user._id, date: today });
        if (exists) return res.status(400).json({ message: "이미 출근했습니다." });

        const newIn = new Attendance({
            userId: user._id,
            username,
            nickname,
            date: today,
            clockIn: new Date(), // 시간 자체는 타임스탬프로 저장 (프론트에서 변환)
        });
        await newIn.save();

        // [로그 기록] 출근
        const log = new Log({
            user: nickname || username,
            action: "출근",
            category: "Attendance",
            targetId: newIn._id,
            details: `${nickname} (${username}) 작업자가 출근했습니다.`
        });
        await log.save();

        // 캐시 삭제 (최신 상태 유도)
        await redisClient.del(`cache:attendance:${today}`);

        res.json({ time: newIn.clockIn });
    } finally {
        // 성공하든 실패하든 락 해제 (또는 TTL에 의해 자동 해제)
        await redisClient.del(lockKey);
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 3. 퇴근 처리
router.post("/check-out", async (req, res) => {
  try {
    const { username } = req.body;
    const today = getKSTDateString(); // KST 기준 날짜
    const user = await User.findOne({ username });

    // [Atomic Lock] 레디스를 이용한 중복 요청 방지
    const lockKey = `lock:attendance:out:${user._id}:${today}`;
    const acquired = await redisClient.set(lockKey, "locked", { NX: true, EX: 10 });
    if (!acquired) return res.status(429).json({ message: "이미 요청이 진행 중입니다." });

    try {
        const record = await Attendance.findOne({ userId: user._id, date: today });
        if (!record)
            return res.status(400).json({ message: "출근 기록이 없습니다." });
        if (record.clockOut)
            return res.status(400).json({ message: "이미 퇴근했습니다." });

        record.clockOut = new Date();
        // 근무 시간 계산 (초 단위)
        record.duration = Math.floor((record.clockOut - record.clockIn) / 1000);
        await record.save();

        // 캐시 삭제
        await redisClient.del(`cache:attendance:${today}`);

        res.json({ time: record.clockOut });
    } finally {
        await redisClient.del(lockKey);
    }
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

// [추가] 특정 직원 검색 및 월간 통계 API
router.get("/summary", async (req, res) => {
  try {
    const { nickname, month } = req.query; // nickname: 검색어, month: "2025-12"
    let query = {};

    // 1. 이름/닉네임 검색 (부분 일치 검색 적용)
    if (nickname && nickname.trim() !== "") {
      query.$or = [
        { nickname: { $regex: nickname, $options: "i" } },
        { username: { $regex: nickname, $options: "i" } },
      ];
    }

    // 2. 월별 필터링 (해당 월의 시작일부터 끝일까지)
    if (month && month.trim() !== "") {
      // date 필드가 "2025-12-01" 형식이므로 "2025-12"로 시작하는 모든 데이터를 찾음
      query.date = { $regex: `^${month}` };
    }

    const records = await Attendance.find(query).sort({ date: -1 });

    // 3. 총 근무 시간 계산
    const totalSeconds = records.reduce(
      (acc, rec) => acc + (rec.duration || 0),
      0
    );
    const totalHours = (totalSeconds / 3600).toFixed(1);

    res.json({
      records,
      totalHours,
      count: records.length,
    });
  } catch (err) {
    console.error("검색 에러:", err);
    res.status(500).json({ message: "서버 검색 오류" });
  }
});

module.exports = router;
