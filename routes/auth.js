const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Log = require("../models/Log");

// [보안 추가] 관리자 권한 확인 미들웨어 (이 파일 내부에서만 씀)
const isAdmin = (req, res, next) => {
  // 1. 로그인 했는지 확인
  if (!req.session || !req.session.user) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }
  // 2. 관리자 권한인지 확인
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ message: "관리자 권한이 없습니다." });
  }
  next();
};

// 1. 회원가입 신청 (공개)
router.post("/register", async (req, res) => {
  try {
    const { username, password, nickname } = req.body;
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: "이미 존재하는 아이디입니다." });
    }
    const newUser = new User({ username, password, nickname });
    await newUser.save();
    res.status(201).json({ message: "가입 신청 완료!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. 로그인 (공개)
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });

    if (!user || user.password !== password) {
      return res
        .status(400)
        .json({ message: "아이디 또는 비밀번호가 틀렸습니다." });
    }

    if (user.isApproved === false) {
      return res
        .status(403)
        .json({ message: "아직 승인되지 않은 계정입니다." });
    }

    req.session.user = {
      id: user._id,
      username: user.username,
      nickname: user.nickname,
      role: user.role,
    };

    req.session.save(async () => {
      // [로그 기록] 로그인
      const log = new Log({
          user: user.nickname || user.username,
          action: "로그인",
          category: "Auth",
          details: "시스템 접속"
      });
      await log.save();

      res.status(200).json({
        message: "로그인 성공",
        user: req.session.user,
      });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// 🚨 [보안 패치] 아래 관리자 기능들은 이제 isAdmin 검사를 통과해야만 실행됨
// ============================================================

// 3. (관리자용) 대기 목록 조회
router.get("/admin/pending", isAdmin, async (req, res) => {
  try {
    const users = await User.find({ isApproved: false });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// [추가] (관리자용) 전체 회원 조회
router.get("/admin/users", isAdmin, async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// [추가] (관리자용) 비밀번호 초기화
router.post("/admin/reset-password", isAdmin, async (req, res) => {
  try {
    const { userId } = req.body;
    await User.findByIdAndUpdate(userId, { password: "1234" }); // 암호화 없이 1234로 초기화 (임시)
    res.json({ message: "비밀번호가 1234로 초기화되었습니다." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. (관리자용) 승인 처리
router.post("/admin/approve", isAdmin, async (req, res) => {
  try {
    const { userId } = req.body;
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { isApproved: true, role: "user" },
      { new: true }
    );
    if (!updatedUser) return res.status(404).json({ message: "유저 없음" });

    // [로그 기록] 계정 승인
    const log = new Log({
        user: "Admin",
        action: "계정 승인",
        category: "Auth",
        targetId: updatedUser._id,
        details: `${updatedUser.username} (${updatedUser.nickname}) 승인됨`
    });
    await log.save();

    res.json({ message: `${updatedUser.username} 승인 완료` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. (관리자용) 가입 거절/강퇴
router.post("/admin/reject", isAdmin, async (req, res) => {
  try {
    const { userId } = req.body;
    await User.findByIdAndDelete(userId);
    res.json({ message: "삭제되었습니다." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 관리자 권한 확인 API
router.get("/admin/check", (req, res) => {
  if (req.session.user && req.session.user.role === "admin") {
    res.json({ isAdmin: true });
  } else {
    res.json({ isAdmin: false });
  }
});

// [추가] (관리자용) 활동 로그 조회 (필터링 지원)
router.get("/admin/logs", isAdmin, async (req, res) => {
    try {
        const { category } = req.query;
        const query = {};
        if (category && category !== 'ALL') {
            query.category = category;
        }

        const logs = await Log.find(query).sort({ timestamp: -1 }).limit(100);
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. 로그아웃 (세션 파괴)
router.post("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) return res.status(500).json({ error: "Logout failed" });
        res.clearCookie("connect.sid");
        res.json({ message: "로그아웃 성공" });
    });
});

module.exports = router;
