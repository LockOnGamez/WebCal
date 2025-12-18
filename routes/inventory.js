const express = require("express");
const router = express.Router();
const Item = require("../models/Item");

// 1. 재고 목록 조회 (GET /api/inventory)
router.get("/", async (req, res) => {
  try {
    const items = await Item.find().sort({ createdAt: -1 }); // 최신순 정렬
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. 재고 추가 (POST /api/inventory)
router.post("/", async (req, res) => {
  try {
    const { name, quantity, description, category, username } = req.body;

    const newItem = new Item({
      name,
      quantity,
      description,
      category,
      lastUpdatedBy: username, // 누가 추가했는지 기록
    });

    await newItem.save();
    res.status(201).json({ message: "물품이 등록되었습니다.", item: newItem });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. 재고 수량 수정 (PUT /api/inventory/:id)
router.put("/:id", async (req, res) => {
  try {
    const { quantity, username } = req.body;

    const updatedItem = await Item.findByIdAndUpdate(
      req.params.id,
      {
        quantity,
        lastUpdatedBy: username,
        updatedAt: Date.now(),
      },
      { new: true } // 수정된 데이터 반환 옵션
    );

    res.json({ message: "수량이 변경되었습니다.", item: updatedItem });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. 재고 삭제 (DELETE /api/inventory/:id)
router.delete("/:id", async (req, res) => {
  try {
    await Item.findByIdAndDelete(req.params.id);
    res.json({ message: "물품이 삭제되었습니다." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
