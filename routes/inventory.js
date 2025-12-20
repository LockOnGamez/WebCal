const express = require("express");
const router = express.Router();
const Item = require("../models/Item");
const redisClient = require("../config/redis"); // Redis 불러오기

const CACHE_KEY = "cache:inventory";

// 1. 재고 목록 조회 (Redis 우선)
router.get("/", async (req, res) => {
  try {
    // 1) Redis 확인
    let cachedData = await redisClient.get("cache:inventory");

    if (cachedData) {
      // 캐시 데이터가 유효한 JSON인지 확인 후 반환
      try {
        const parsed = JSON.parse(cachedData);
        console.log("⚡ Redis 캐시 조회 성공");
        return res.json(parsed);
      } catch (parseErr) {
        console.error("❌ 캐시 데이터 파싱 에러, DB로 전환");
      }
    }

    // 2) 캐시가 없거나 오류 시 DB 조회
    console.log("🐢 DB 직접 조회 중...");
    const items = await Item.find().sort({ updatedAt: -1 });

    // 3) 조회한 데이터를 다시 캐싱 (복구 작업)
    await redisClient.set("cache:inventory", JSON.stringify(items));

    res.json(items);
  } catch (err) {
    console.error("재고 조회 에러:", err);
    res.status(500).json({ error: err.message });
  }
});

// 2. 재고 추가 (쓰기 발생 -> 캐시 삭제)
router.post("/", async (req, res) => {
  try {
    const { name, size, length, quantity, category, username } = req.body;

    // 정규화: 달력 로직과 동일하게 공백 제거 및 기본값 설정
    const newItem = new Item({
      name: name.trim(),
      size: size ? size.toString().trim() : "-",
      length: length ? length.toString().trim() : "-",
      quantity,
      category,
      lastUpdatedBy: username,
    });

    await newItem.save();
    await redisClient.del(CACHE_KEY);
    res.status(201).json({ message: "등록됨", item: newItem });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. 수정 (쓰기 발생 -> 캐시 삭제)
router.put("/:id", async (req, res) => {
  try {
    const { quantity, username } = req.body;
    const updatedItem = await Item.findByIdAndUpdate(
      req.params.id,
      { quantity, lastUpdatedBy: username, updatedAt: Date.now() },
      { new: true }
    );

    // ★ 캐시 삭제
    await redisClient.del(CACHE_KEY);

    res.json({ message: "수정됨", item: updatedItem });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. 삭제 (쓰기 발생 -> 캐시 삭제)
router.delete("/:id", async (req, res) => {
  try {
    await Item.findByIdAndDelete(req.params.id);

    // ★ 캐시 삭제
    await redisClient.del(CACHE_KEY);

    res.json({ message: "삭제됨" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
