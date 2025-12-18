const express = require("express");
const router = express.Router();
const Event = require("../models/Event");
const Item = require("../models/Item");

// --- [핵심] 재고 조정 공통 함수 ---
// items: 처리할 아이템 목록
// isReverse: true면 반대로 계산 (삭제나 수정 전 취소 시 사용)
async function adjustInventory(items, username, isReverse = false) {
  if (!items || items.length === 0) return;

  for (const item of items) {
    const qty = Number(item.quantity);
    if (qty <= 0) continue;

    let targetItem = await Item.findOne({
      name: item.name,
      size: item.size || "",
      length: item.length || "",
    });

    // 로직 결정 (기본: 입고/생산품=증가, 출고/원자재=감소)
    // role이 'material'(원자재)이거나 type이 '출고'인 경우 감소가 기본값
    // 하지만 Event 모델에 role이 저장되므로 role을 기준으로 판단하는 게 정확함.

    let change = 0;

    // 1. 기본 방향 설정
    if (item.role === "material") {
      change = -qty; // 원자재는 소모(감소)
    } else {
      // 산출물(product)이나 단순 입출고 품목
      // 입고/생산 -> 증가, 출고 -> 감소
      // 하지만 DB에 저장된 item.role 만으로는 '출고'인지 '입고'인지 알 수 없음(상위 type필드 필요)
      // 그래서 호출할 때 상위 로직에서 부호가 결정된 상태로 넘어오거나, 여기서 type을 받아야 함.
      // *구조 단순화를 위해 Event 저장 시 role을 확실히 구분하거나, 아래처럼직접직 계산*
    }
  }
}

// 위의 함수 방식보다, 라우터 안에서 명확하게 처리하는 게 오류가 적으므로
// 아래 라우터 로직에 직접 구현하겠습니다.

// 1. 조회
router.get("/", async (req, res) => {
  try {
    const events = await Event.find();
    const responseEvents = events.map((event) => ({
      id: event._id,
      title: event.title,
      start: event.start,
      allDay: event.allDay,
      extendedProps: {
        type: event.type,
        items: event.items || [],
        createdBy: event.createdBy,
      },
      backgroundColor:
        event.type === "입고"
          ? "#4CAF50"
          : event.type === "출고"
          ? "#F44336"
          : "#2196F3",
      borderColor:
        event.type === "입고"
          ? "#4CAF50"
          : event.type === "출고"
          ? "#F44336"
          : "#2196F3",
    }));
    res.json(responseEvents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- 재고 업데이트 헬퍼 함수 ---
// items: [{name, size, length, quantity, role}]
// multiplier: 1(정방향), -1(역방향/취소)
async function processStock(items, type, username, multiplier) {
  if (!items) return;

  for (const item of items) {
    let qty = Number(item.quantity);
    if (qty === 0) continue;

    // 1. 재고 찾기
    let targetItem = await Item.findOne({
      name: item.name,
      size: item.size || "",
      length: item.length || "",
    });

    // 2. 증감 결정
    // 입고: (+), 출고: (-)
    // 생산: product는 (+), material은 (-)
    let direction = 1;

    if (type === "입고") direction = 1;
    else if (type === "출고") direction = -1;
    else if (type === "생산") {
      direction = item.role === "material" ? -1 : 1;
    }

    const finalChange = qty * direction * multiplier;

    // 3. DB 반영
    if (targetItem) {
      targetItem.quantity += finalChange;
      targetItem.lastUpdatedBy = username;
      await targetItem.save();
    } else if (finalChange > 0) {
      // 없는데 늘어나는 경우 (신규 입고/생산)
      await new Item({
        name: item.name,
        size: item.size,
        length: item.length,
        quantity: finalChange,
        category: type === "생산" ? "생산품" : "자재",
        lastUpdatedBy: username,
      }).save();
    }
    // 없는데 줄어드는 경우는 무시하거나 에러처리 (여기선 무시)
  }
}

// 2. 일정 추가 (POST)
router.post("/", async (req, res) => {
  try {
    const { start, type, products, materials, username } = req.body;

    const allItems = [];
    if (products)
      products.forEach((p) => allItems.push({ ...p, role: "product" }));
    if (materials)
      materials.forEach((m) => allItems.push({ ...m, role: "material" }));

    // 1) 재고 반영 (정방향: 1)
    await processStock(allItems, type, username, 1);

    // 2) 이벤트 저장
    const mainName =
      products && products.length > 0 ? products[0].name : "항목 없음";
    const count = allItems.length - 1;
    const title = `[${type}] ${mainName}${count > 0 ? ` 외 ${count}건` : ""}`;

    const newEvent = new Event({
      title,
      start,
      type,
      items: allItems,
      createdBy: username,
    });
    await newEvent.save();

    res.status(201).json({ message: "등록 완료", event: newEvent });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 3. 일정 수정 (PUT) - [신규 기능]
router.put("/:id", async (req, res) => {
  try {
    const { start, type, products, materials, username } = req.body;
    const eventId = req.params.id;

    // 1) 기존 이벤트 찾기
    const oldEvent = await Event.findById(eventId);
    if (!oldEvent)
      return res.status(404).json({ message: "일정을 찾을 수 없음" });

    // 2) [Rollback] 기존 재고 원상복구 (역방향: -1)
    await processStock(oldEvent.items, oldEvent.type, username, -1);

    // 3) 새로운 데이터 준비
    const allItems = [];
    if (products)
      products.forEach((p) => allItems.push({ ...p, role: "product" }));
    if (materials)
      materials.forEach((m) => allItems.push({ ...m, role: "material" }));

    // 4) [Apply] 새 재고 반영 (정방향: 1)
    await processStock(allItems, type, username, 1);

    // 5) 이벤트 내용 업데이트
    const mainName =
      products && products.length > 0 ? products[0].name : "항목 없음";
    const count = allItems.length - 1;
    const newTitle = `[${type}] ${mainName}${
      count > 0 ? ` 외 ${count}건` : ""
    }`;

    oldEvent.title = newTitle;
    oldEvent.start = start;
    oldEvent.type = type;
    oldEvent.items = allItems;
    oldEvent.createdBy = username;

    await oldEvent.save();

    res.json({ message: "수정 완료" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 4. 일정 삭제 (DELETE) - [기능 개선]
router.delete("/:id", async (req, res) => {
  try {
    const eventId = req.params.id;
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "일정을 찾을 수 없음" });

    // 1) [Rollback] 재고 원상복구 (역방향: -1)
    // 삭제하는 사람의 이름을 기록에 남길지, 원래 작성자를 쓸지인데 여기선 현재 요청자가 불분명하니
    // 그냥 시스템적으로 처리하거나, 필요한 경우 req.body나 query로 username을 받아야 함.
    // 일단 '시스템 복구'로 간주.
    await processStock(event.items, event.type, "system-rollback", -1);

    // 2) 이벤트 삭제
    await event.deleteOne();

    res.json({ message: "삭제 및 재고 복구 완료" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
