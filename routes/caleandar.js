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

// 2. 일정 추가 (재고 연동 포함)
router.post("/", async (req, res) => {
  const { type, products, materials, start, username } = req.body;

  try {
    // [검증] 최소 데이터 확인
    if (!products || products.length === 0 || !products[0].name) {
      return res
        .status(400)
        .json({ message: "유효한 품목 데이터가 없습니다." });
    }

    // [제목 생성] 달력 라벨 표시용
    const mainItem = products[0].name;
    const extraCount =
      products.length > 1 ? ` 외 ${products.length - 1}건` : "";
    const generatedTitle = `[${type}] ${mainItem}${extraCount}`;

    // [데이터 통합] 스키마 구조(items 배열)에 맞게 role 부여 및 정규화
    const combinedItems = [];

    // 제품(입고/출고/생산결과) 처리
    if (products) {
      products.forEach((p) => {
        combinedItems.push({
          name: p.name.trim(),
          size: p.size ? p.size.toString().trim() : "-",
          length: p.length ? p.length.toString().trim() : "-",
          quantity: Number(p.quantity) || 0,
          role: "product",
        });
      });
    }

    // 원자재(생산 시 소모품) 처리
    if (type === "생산" && materials) {
      materials.forEach((m) => {
        combinedItems.push({
          name: m.name.trim(),
          size: m.size ? m.size.toString().trim() : "-",
          length: m.length ? m.length.toString().trim() : "-",
          quantity: Number(m.quantity) || 0,
          role: "material",
        });
      });
    }

    // [DB 저장] 달력 이벤트 생성
    const newEvent = new Event({
      title: generatedTitle,
      start,
      type,
      items: combinedItems,
      createdBy: username,
    });
    await newEvent.save();

    // [재고 연동] 품목+사이즈+길이 기준으로 업데이트
    for (const item of combinedItems) {
      if (item.quantity === 0) continue;

      let amount = 0;
      if (item.role === "product") {
        // 입고/생산은 +, 출고는 -
        amount =
          type === "입고" || type === "생산" ? item.quantity : -item.quantity;
      } else {
        // 원자재(material)는 무조건 -
        amount = -item.quantity;
      }

      // name, size, length 세 가지가 모두 일치해야 같은 재고로 인식함
      await Item.findOneAndUpdate(
        {
          name: item.name,
          size: item.size,
          length: item.length,
        },
        {
          $inc: { quantity: amount },
          $set: { lastUpdatedBy: username, updatedAt: Date.now() },
        },
        { upsert: true } // 없으면 새로 생성
      );
    }

    // Redis 캐시 삭제 (재고 목록 갱신용)
    await redisClient.del("cache:inventory");

    res.status(201).json(newEvent);
  } catch (err) {
    console.error("저장 에러:", err);
    res.status(500).json({ message: "서버 저장 오류: " + err.message });
  }
});

// 3. 일정 삭제 (재고 완벽 복구 포함)
router.delete("/:id", async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event)
      return res.status(404).json({ message: "일정을 찾을 수 없습니다." });

    // [재고 복구] 등록 시 적용했던 수량을 반대로 적용
    for (const item of event.items) {
      let restoreAmount = 0;

      if (item.role === "product") {
        // 입고/생산으로 더했던 건 빼고(-), 출고로 뺐던 건 더함(+)
        restoreAmount =
          event.type === "입고" || event.type === "생산"
            ? -item.quantity
            : item.quantity;
      } else {
        // 소모되었던 원자재는 다시 채워줌(+)
        restoreAmount = item.quantity;
      }

      await Item.findOneAndUpdate(
        { name: item.name, size: item.size, length: item.length },
        { $inc: { quantity: restoreAmount } }
      );
    }

    await Event.findByIdAndDelete(req.params.id);
    await redisClient.del("cache:inventory");

    res.json({ message: "삭제 및 재고 복구 완료" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
