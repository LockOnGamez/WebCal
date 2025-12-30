const express = require("express");
const router = express.Router();
const Item = require("../models/Item");
const Event = require("../models/Event");
const redisClient = require("../config/redis");

const CACHE_KEY = "cache:inventory";

// 1. 재고 목록 조회 (Redis 우선)
router.get("/", async (req, res) => {
  try {
    let cachedData = await redisClient.get(CACHE_KEY);
    if (cachedData) {
      try {
        const parsed = JSON.parse(cachedData);
        console.log("⚡ Redis 캐시 조회 성공");
        return res.json(parsed);
      } catch (parseErr) {
        console.error("❌ 캐시 데이터 파싱 에러");
      }
    }
    const items = await Item.find().sort({ updatedAt: -1 });
    await redisClient.set(CACHE_KEY, JSON.stringify(items));
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. 재고 추가
router.post("/", async (req, res) => {
  try {
    const { name, size, length, quantity, category, username } = req.body;
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

// 3. 수정 (수량 및 알림 설정 업데이트)
router.put("/:id", async (req, res) => {
  try {
    const { quantity, alertEnabled, alertThreshold, username } = req.body;
    const updateData = { lastUpdatedBy: username, updatedAt: Date.now() };

    if (quantity !== undefined) updateData.quantity = quantity;
    if (alertEnabled !== undefined) updateData.alertEnabled = alertEnabled;
    if (alertThreshold !== undefined) updateData.alertThreshold = alertThreshold;

    const updatedItem = await Item.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );
    await redisClient.del(CACHE_KEY);
    res.json({ message: "수정됨", item: updatedItem });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. 삭제
router.delete("/:id", async (req, res) => {
  try {
    await Item.findByIdAndDelete(req.params.id);
    await redisClient.del(CACHE_KEY);
    res.json({ message: "삭제됨" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. 생산 기록 등록 (핵심 수정 부분)
router.post("/produce", async (req, res) => {
  try {
    const {
      materialId,
      materialName,
      category,
      width,
      size,
      quantity,
      tubeName,
    } = req.body;
    const nickname = req.session.user ? req.session.user.nickname : "작업자";
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    // 1. 기초 데이터 준비
    const rawMaterial = await Item.findById(materialId);
    if (!rawMaterial) throw new Error("원자재 정보를 찾을 수 없습니다.");

    const productName = rawMaterial.name; // 완제품 이름 (예: 투명(38))
    const productSize = width;
    const productLength = size;
    const TUBE_NAME = tubeName || "종이지관(6)";
    const TUBE_SIZE = "1560";

    // 2. 실제 재고 반영 (DB 연산)
    await Item.findByIdAndUpdate(materialId, { $inc: { quantity: -1 } });
    await Item.findOneAndUpdate(
      { name: productName, size: productSize, length: productLength },
      {
        $inc: { quantity: quantity },
        $set: {
          category: "완제품",
          updatedAt: Date.now(),
          lastUpdatedBy: nickname,
        },
      },
      { upsert: true }
    );
    await Item.findOneAndUpdate(
      { name: TUBE_NAME, size: TUBE_SIZE },
      { $inc: { quantity: -quantity } }
    );

    // 3. 통합 일정(Event) 처리 (그날의 첫 생산 일정 찾기)
    let existingEvent = await Event.findOne({
      start: {
        $gte: new Date(today),
        $lt: new Date(new Date(today).getTime() + 24 * 60 * 60 * 1000),
      },
      type: "생산",
    });

    if (existingEvent) {
      // --- 통합 합산 로직 ---
      let hasProduct = false;
      let hasMaterial = false;
      let hasTube = false;

      existingEvent.items.forEach((item) => {
        // 동일한 완제품(이름/폭/길이 일치)이 이미 목록에 있으면 수량 합산
        if (
          item.role === "product" &&
          item.name === productName &&
          item.size === productSize &&
          item.length === productLength
        ) {
          item.quantity += quantity;
          hasProduct = true;
        }
        // 동일한 원단이 이미 목록에 있으면 합산
        else if (item.role === "material" && item.name === rawMaterial.name) {
          item.quantity += 1;
          hasMaterial = true;
        }
        // 동일한 지관이 이미 목록에 있으면 합산
        else if (item.role === "material" && item.name === TUBE_NAME) {
          item.quantity += quantity;
          hasTube = true;
        }
      });

      // 목록에 없는 새로운 항목들이면 push
      if (!hasProduct) {
        existingEvent.items.push({
          name: productName,
          size: productSize,
          length: productLength,
          quantity: quantity,
          role: "product",
        });
      }
      if (!hasMaterial) {
        existingEvent.items.push({
          name: rawMaterial.name,
          size: rawMaterial.size || "-",
          length: rawMaterial.length || "-",
          quantity: 1,
          role: "material",
        });
      }
      if (!hasTube) {
        existingEvent.items.push({
          name: TUBE_NAME,
          size: TUBE_SIZE,
          length: "-",
          quantity: quantity,
          role: "material",
        });
      }

      // 제목 업데이트 (첫 품목 이름 외 X건)
      const prodItems = existingEvent.items.filter((i) => i.role === "product");
      existingEvent.title = `[생산] ${prodItems[0].name}${
        prodItems.length > 1 ? " 외 " + (prodItems.length - 1) + "건" : ""
      }`;

      existingEvent.markModified("items");
      await existingEvent.save();
    } else {
      // --- 그날의 첫 생산 기록 생성 ---
      const newEvent = new Event({
        title: `[생산] ${productName} ${productSize}/${productLength}m - ${quantity}개`,
        start: new Date(today),
        type: "생산",
        items: [
          {
            name: productName,
            size: productSize,
            length: productLength,
            quantity: quantity,
            role: "product",
          },
          {
            name: rawMaterial.name,
            size: rawMaterial.size || "-",
            length: rawMaterial.length || "-",
            quantity: 1,
            role: "material",
          },
          {
            name: TUBE_NAME,
            size: TUBE_SIZE,
            length: "-",
            quantity: quantity,
            role: "material",
          },
        ],
        createdBy: nickname,
      });
      await newEvent.save();
    }

    await redisClient.del("cache:inventory");
    res.json({ success: true });
  } catch (err) {
    console.error("❌ 통합 생산 기록 에러:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
