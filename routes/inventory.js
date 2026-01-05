const express = require("express");
const router = express.Router();
const Item = require("../models/Item");
const Event = require("../models/Event");
const redisClient = require("../config/redis");
const Log = require("../models/Log");

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

    // [Validation] 필수 필드 및 데이터 형식 확인
    if (!name || name.trim() === "") return res.status(400).json({ error: "품목 이름은 필수입니다." });
    if (isNaN(quantity)) return res.status(400).json({ error: "수량은 숫자여야 합니다." });

    const newItem = new Item({
      name: name.trim(),
      size: size ? size.toString().trim() : "-",
      length: length ? length.toString().trim() : "-",
      quantity: parseFloat(quantity) || 0,
      category,
      lastUpdatedBy: username,
    });
    await newItem.save();
    
    // [로그 기록] 재고 등록
    const log = new Log({
        user: req.session.user.nickname || "System",
        action: "재고 등록",
        category: "Inventory",
        targetId: newItem._id,
        details: `${name} (${quantity}개) 등록됨`
    });
    await log.save();

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

    // [Validation] 수량 및 임계값 형식 확인
    if (quantity !== undefined) {
        if (isNaN(quantity)) return res.status(400).json({ error: "수량은 숫자여야 합니다." });
        updateData.quantity = parseFloat(quantity);
    }
    if (alertEnabled !== undefined) updateData.alertEnabled = alertEnabled;
    if (alertThreshold !== undefined) {
        if (isNaN(alertThreshold)) return res.status(400).json({ error: "알림 수량은 숫자여야 합니다." });
        updateData.alertThreshold = parseFloat(alertThreshold);
    }

    const updatedItem = await Item.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    // [로그 기록] 재고 수정
    const log = new Log({
        user: req.session.user.nickname || "System",
        action: "재고 수정",
        category: "Inventory",
        targetId: updatedItem._id,
        details: `${updatedItem.name} ${quantity !== undefined ? `수량: ${quantity}` : ''} ${alertEnabled !== undefined ? `알림: ${alertEnabled}` : ''} 수정됨`
    });
    await log.save();

    await redisClient.del(CACHE_KEY);
    res.json({ message: "수정됨", item: updatedItem });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. 삭제
router.delete("/:id", async (req, res) => {
  try {
    const deletedItem = await Item.findByIdAndDelete(req.params.id);
    
    // [로그 기록] 재고 삭제
    const log = new Log({
        user: req.session.user.nickname || "Admin",
        action: "재고 삭제",
        category: "Inventory",
        targetId: req.params.id,
        details: deletedItem ? `${deletedItem.name} 삭제됨` : "알 수 없는 품목 삭제"
    });
    await log.save();

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

    // [Atomic Lock] 생산 등록 중복 방지 (10초 잠금)
    const lockKey = `lock:produce:${today}`;
    const acquired = await redisClient.set(lockKey, "locked", { NX: true, EX: 10 });
    if (!acquired) return res.status(429).json({ message: "다른 생산 기록 처리 중입니다. 잠시 후 다시 시도해주세요." });

    try {
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

        // [로그 기록] 생산 완료
        const prodLog = new Log({
            user: nickname,
            action: "생산 등록",
            category: "Production",
            details: `${productName} (${quantity}개) 생산 완료`
        });
        await prodLog.save();

        await redisClient.del("cache:inventory");
        res.json({ success: true });
    } finally {
        // 락 해제
        await redisClient.del(lockKey);
    }
  } catch (err) {
    console.error("❌ 통합 생산 기록 에러:", err);
    res.status(500).json({ error: err.message });
  }
});

// 6. 입고/출고 직접 등록 (개선 버전: 이름/사이즈/길이 기반)
router.post("/stock-move", async (req, res) => {
  try {
    let { name, size, length, quantity, mode, nickname } = req.body; 
    size = size || "-";
    length = length || "-";
    const today = new Date().toISOString().split("T")[0];

    // 1. 수량 검증
    const moveQty = parseFloat(quantity);
    if (isNaN(moveQty) || moveQty <= 0) return res.status(400).json({ message: "유효한 수량을 입력하세요." });

    // 2. 아이템 조회 및 업데이트 (입고는 upsert, 출고는 존재 확인)
    let item;
    if (mode === "in") {
      item = await Item.findOneAndUpdate(
        { name, size, length },
        { 
          $inc: { quantity: moveQty },
          $set: { lastUpdatedBy: nickname, updatedAt: Date.now() },
          $setOnInsert: { category: "완제품" } // 신규 생성 시 기본 카테고리
        },
        { upsert: true, new: true }
      );
    } else {
      item = await Item.findOne({ name, size, length });
      if (!item) return res.status(404).json({ message: "해당 품목이 재고에 존재하지 않습니다." });
      
      if (item.quantity < moveQty) {
          return res.status(400).json({ message: `재고가 부족합니다. (현재: ${item.quantity}개)` });
      }

      item.quantity -= moveQty;
      item.lastUpdatedBy = nickname;
      item.updatedAt = Date.now();
      await item.save();
    }

    // 3. 일정(Event) 생성/통합 (생산과 유사한 로직)
    const eventType = mode === "in" ? "입고" : "출고";
    
    let existingEvent = await Event.findOne({
      start: {
          $gte: new Date(today),
          $lt: new Date(new Date(today).getTime() + 24 * 60 * 60 * 1000),
      },
      type: eventType,
    });

    if (existingEvent) {
      // --- 통합 합산 로직 ---
      let hasItem = false;
      existingEvent.items.forEach((ei) => {
        if (
          ei.name === item.name &&
          ei.size === item.size &&
          ei.length === item.length &&
          ei.role === "product"
        ) {
          ei.quantity += moveQty;
          hasItem = true;
        }
      });

      if (!hasItem) {
        existingEvent.items.push({
          name: item.name,
          size: item.size,
          length: item.length,
          quantity: moveQty,
          role: "product",
        });
      }

      // 제목 업데이트
      const prodItems = existingEvent.items.filter((i) => i.role === "product");
      existingEvent.title = `[${eventType}] ${prodItems[0].name}${
        prodItems.length > 1 ? " 외 " + (prodItems.length - 1) + "건" : ""
      }`;

      existingEvent.markModified("items");
      await existingEvent.save();
    } else {
      // --- 새로운 일정 생성 ---
      const newEvent = new Event({
        title: `[${eventType}] ${item.name} (${item.size}/${item.length}) - ${moveQty}개`,
        start: new Date(today),
        type: eventType,
        items: [
          {
            name: item.name,
            size: item.size,
            length: item.length,
            quantity: moveQty,
            role: "product",
          },
        ],
        createdBy: nickname,
      });
      await newEvent.save();
    }

    // 4. 로그 기록
    const log = new Log({
      user: nickname,
      action: `${eventType} 등록`,
      category: "Inventory",
      targetId: item._id,
      details: `${item.name} (${item.size}/${item.length}) ${moveQty}개 ${eventType} 완료 (잔여: ${item.quantity})`,
    });
    await log.save();

    // 5. 캐시 삭제
    await redisClient.del(CACHE_KEY);

    res.json({ success: true, currentQuantity: item.quantity });
  } catch (err) {
    console.error("❌ Stock Move Error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
