const express = require("express");
const router = express.Router();
const Option = require("../models/Option");
const redisClient = require("../config/redis"); // ★ Redis 추가

const OPTIONS_CACHE_KEY = "cache:options"; // 옵션 전용 캐시 키

// 1. 모든 옵션 조회 (일반 유저/관리자 공용)
router.get("/", async (req, res) => {
  try {
    // Redis 확인
    let cachedOptions = await redisClient.get(OPTIONS_CACHE_KEY);

    if (cachedOptions) {
      console.log("⚡ Redis에서 옵션 리스트 반환");
      return res.json(JSON.parse(cachedOptions));
    }

    // 캐시에 없으면 DB에서 가져오기
    console.log("🐢 캐시 없음: DB에서 옵션 직접 조회");
    const options = await Option.find();

    // 다음을 위해 캐시에 저장
    await redisClient.set(OPTIONS_CACHE_KEY, JSON.stringify(options));

    res.json(options);
  } catch (err) {
    console.error("옵션 조회 에러:", err);
    res.status(500).json({ error: err.message });
  }
});

// 2. 옵션 추가 (관리자용 - 세션 체크는 server.js에서 수행)
router.post("/", async (req, res) => {
  try {
    const { type, value } = req.body;
    const exists = await Option.findOne({ type, value });
    if (exists) return res.status(400).json({ message: "이미 존재함" });

    const newOption = new Option({ type, value });
    await newOption.save();

    // ★ 관리자가 추가하면 즉시 캐시 삭제 (다음 조회 때 갱신되도록)
    await redisClient.del(OPTIONS_CACHE_KEY);
    console.log("♻️ 옵션 업데이트: 캐시 삭제됨");

    res.status(201).json(newOption);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. 옵션 삭제 (관리자용)
router.delete("/:id", async (req, res) => {
  try {
    await Option.findByIdAndDelete(req.params.id);

    // ★ 중요: 옵션이 삭제되었으므로 기존 캐시 삭제
    await redisClient.del(OPTIONS_CACHE_KEY);
    console.log("♻️ 옵션 삭제로 인한 캐시 초기화");

    res.json({ message: "삭제되었습니다." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
