const express = require("express");
const router = express.Router();
const Event = require("../models/Event");
const Item = require("../models/Item");
const redisClient = require("../config/redis");

// 1. 일정 조회 (달력 로딩용)
router.get("/", async (req, res) => {
  try {
    const events = await Event.find();
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. 일정 추가 (재고 연동 및 소수점 처리 포함)
router.post("/", async (req, res) => {
  const { type, products, materials, start, username } = req.body;

  try {
    if (!products || products.length === 0 || !products[0].name) {
      return res
        .status(400)
        .json({ message: "유효한 품목 데이터가 없습니다." });
    }

    const mainItem = products[0].name;
    const extraCount =
      products.length > 1 ? ` 외 ${products.length - 1}건` : "";
    const generatedTitle = `[${type}] ${mainItem}${extraCount}`;

    const combinedItems = [];
    // 제품 처리
    products.forEach((p) => {
      combinedItems.push({
        name: p.name.trim(),
        size: p.size ? p.size.toString().trim() : "-",
        length: p.length ? p.length.toString().trim() : "-",
        quantity: parseFloat(Number(p.quantity).toFixed(1)), // 소수점 한자리 고정
        role: "product",
      });
    });

    // 원자재 처리
    if (type === "생산" && materials) {
      materials.forEach((m) => {
        combinedItems.push({
          name: m.name.trim(),
          size: m.size ? m.size.toString().trim() : "-",
          length: m.length ? m.length.toString().trim() : "-",
          quantity: parseFloat(Number(m.quantity).toFixed(1)),
          role: "material",
        });
      });
    }

    const newEvent = new Event({
      title: generatedTitle,
      start,
      type,
      items: combinedItems,
      createdBy: username,
    });
    await newEvent.save();

    // 재고 연동 로직
    for (const item of combinedItems) {
      if (item.quantity === 0) continue;

      let amount = 0;
      if (item.role === "product") {
        amount =
          type === "입고" || type === "생산" ? item.quantity : -item.quantity;
      } else {
        amount = -item.quantity;
      }

      // [수정] 부동 소수점 오차 방지를 위해 기존 수량을 가져와서 계산 후 저장
      const targetItem = await Item.findOne({
        name: item.name,
        size: item.size,
        length: item.length,
      });
      if (targetItem) {
        targetItem.quantity = parseFloat(
          (targetItem.quantity + amount).toFixed(1)
        );
        targetItem.lastUpdatedBy = username;
        targetItem.updatedAt = Date.now();
        await targetItem.save();
      } else {
        await Item.create({
          name: item.name,
          size: item.size,
          length: item.length,
          quantity: parseFloat(item.quantity.toFixed(1)),
          lastUpdatedBy: username,
          updatedAt: Date.now(),
        });
      }
    }

    await redisClient.del("cache:inventory");
    res.status(201).json(newEvent);
  } catch (err) {
    console.error("저장 에러:", err);
    res.status(500).json({ message: "서버 저장 오류: " + err.message });
  }
});

// 3. 일정 수정 (PUT) - 기존 재고 복구 후 새 데이터 반영
router.put("/:id", async (req, res) => {
  try {
    const oldEvent = await Event.findById(req.params.id);
    if (!oldEvent)
      return res.status(404).json({ message: "일정을 찾을 수 없습니다." });

    // [A] 기존 재고 원상복구 (역계산)
    for (const item of oldEvent.items) {
      let restoreAmount = 0;
      if (item.role === "product") {
        restoreAmount =
          oldEvent.type === "입고" || oldEvent.type === "생산"
            ? -item.quantity
            : item.quantity;
      } else {
        restoreAmount = item.quantity; // 소모됐던 원자재 다시 채워줌
      }

      const target = await Item.findOne({
        name: item.name,
        size: item.size,
        length: item.length,
      });
      if (target) {
        target.quantity = parseFloat(
          (target.quantity + restoreAmount).toFixed(1)
        );
        await target.save();
      }
    }

    // [B] 새로운 데이터 정규화
    const { type, products, materials, start, username } = req.body;
    const combinedItems = [];
    products.forEach((p) =>
      combinedItems.push({
        ...p,
        role: "product",
        quantity: parseFloat(Number(p.quantity).toFixed(1)),
      })
    );
    if (type === "생산" && materials) {
      materials.forEach((m) =>
        combinedItems.push({
          ...m,
          role: "material",
          quantity: parseFloat(Number(m.quantity).toFixed(1)),
        })
      );
    }

    const generatedTitle = `[${type}] ${combinedItems[0].name}${
      combinedItems.length > 1 ? " 외 " + (combinedItems.length - 1) + "건" : ""
    }`;

    // [C] 일정 문서 업데이트
    const updatedEvent = await Event.findByIdAndUpdate(
      req.params.id,
      {
        title: generatedTitle,
        start,
        type,
        items: combinedItems,
        createdBy: username,
        updatedAt: Date.now(),
      },
      { new: true }
    );

    // [D] 새로운 재고 수량 반영
    for (const item of combinedItems) {
      let amount =
        item.role === "product"
          ? type === "입고" || type === "생산"
            ? item.quantity
            : -item.quantity
          : -item.quantity;

      const target = await Item.findOne({
        name: item.name,
        size: item.size,
        length: item.length,
      });
      if (target) {
        target.quantity = parseFloat((target.quantity + amount).toFixed(1));
        target.lastUpdatedBy = username;
        await target.save();
      } else {
        await Item.create({
          ...item,
          quantity: parseFloat(amount.toFixed(1)),
          lastUpdatedBy: username,
        });
      }
    }

    await redisClient.del("cache:inventory");
    res.json(updatedEvent);
  } catch (err) {
    console.error("수정 에러:", err);
    res.status(500).json({ message: err.message });
  }
});

// 4. 일정 삭제 (재고 복구 포함)
router.delete("/:id", async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event)
      return res.status(404).json({ message: "일정을 찾을 수 없습니다." });

    for (const item of event.items) {
      let restoreAmount =
        item.role === "product"
          ? event.type === "입고" || event.type === "생산"
            ? -item.quantity
            : item.quantity
          : item.quantity;

      const target = await Item.findOne({
        name: item.name,
        size: item.size,
        length: item.length,
      });
      if (target) {
        target.quantity = parseFloat(
          (target.quantity + restoreAmount).toFixed(1)
        );
        await target.save();
      }
    }

    await Event.findByIdAndDelete(req.params.id);
    await redisClient.del("cache:inventory");

    res.json({ message: "삭제 및 재고 복구 완료" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
