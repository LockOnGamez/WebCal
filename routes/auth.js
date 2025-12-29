const express = require("express");
const router = express.Router();
const User = require("../models/User");

// 1. 회원가입 신청
router.post("/register", async (req, res) => {
  console.log("1. 요청 받음! 데이터:", req.body); // 여기는 뜰 것임

  try {
    const { username, password, nickname } = req.body;

    console.log("2. 중복 검사 시작...");
    // 여기서 멈출 확률이 높음 (DB 조회)
    const existingUser = await User.findOne({ username });
    console.log("3. 중복 검사 통과 (결과):", existingUser);

    if (existingUser) {
      console.log("❌ 중복된 유저임");
      return res.status(400).json({ message: "이미 존재하는 아이디입니다." });
    }

    console.log("4. 유저 객체 생성 중...");
    const newUser = new User({ username, password, nickname });

    console.log("5. DB 저장 시도...");
    // 또는 여기서 멈출 수 있음 (DB 쓰기)
    await newUser.save();
    console.log("6. DB 저장 완료!");

    res.status(201).json({ message: "가입 신청 완료!" });
  } catch (err) {
    console.error("🔥 에러 발생:", err);
    res.status(500).json({ error: err.message });
  }
});

// 2. 로그인
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });

    // 1. 계정 확인
    if (!user || user.password !== password) {
      return res
        .status(400)
        .json({ message: "아이디 또는 비밀번호가 틀렸습니다." });
    }

    // 2. 승인 여부 확인
    if (user.isApproved === false) {
      return res
        .status(403)
        .json({ message: "아직 승인되지 않은 계정입니다." });
    }

    // ★ 3. [복구 및 수정] 세션 저장 (Redis에 저장됩니다)
    req.session.user = {
      id: user._id,
      username: user.username,
      nickname: user.nickname,
      role: user.role, // "admin" 혹은 "user"
    };

    // ★ 세션을 명시적으로 저장 후 응답을 보냅니다.
    req.session.save((err) => {
      if (err) {
        console.error("세션 저장 실패:", err);
        return res.status(500).json({ message: "세션 저장 오류" });
      }

      console.log(`✅ ${user.username} 로그인 및 세션 저장 완료`);

      // 4. 응답 보내기
      res.status(200).json({
        message: "로그인 성공",
        user: req.session.user,
      });
    });
  } catch (err) {
    console.error("로그인 에러:", err);
    res.status(500).json({ error: err.message });
  }
});

// 3. (관리자용) 대기 목록 조회
router.get("/admin/pending", async (req, res) => {
  try {
    const users = await User.find({ isApproved: false });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. (관리자용) 승인 처리 - ID 기반으로 수정 및 권한 부여
router.post("/admin/approve", async (req, res) => {
  try {
    const { userId } = req.body; // 프론트엔드에서 넘겨주는 데이터 이름 확인

    console.log("승인 요청 ID:", userId); // 서버 터미널에 ID가 잘 찍히는지 확인용

    if (!userId) {
      return res.status(400).json({ message: "userId가 누락되었습니다." });
    }

    // [수정] findOneAndUpdate를 사용하여 더 유연하게 매칭
    const updatedUser = await User.findOneAndUpdate(
      { _id: userId },
      { $set: { isApproved: true, role: "user" } },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: "해당 유저를 찾을 수 없습니다." });
    }

    console.log(`✅ ${updatedUser.username} 승인 완료`);
    res.json({ message: `${updatedUser.username} 승인 완료` });
  } catch (err) {
    console.error("🔥 서버 승인 로직 에러:", err);
    res.status(500).json({ error: err.message });
  }
});

// 5. (관리자용) 가입 거절 (유저 삭제)
router.post("/admin/reject", async (req, res) => {
  try {
    const { userId } = req.body;
    await User.findByIdAndDelete(userId);
    res.json({ message: "가입 신청이 거절 및 삭제되었습니다." });
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

// [추가] 전체 회원 목록 조회 (이미 승인된 유저만)
router.get("/admin/users", async (req, res) => {
  try {
    // isApproved가 true인 유저만 찾기
    const users = await User.find({ isApproved: true });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// [추가] 비밀번호 초기화 (1234로 초기화)
router.post("/admin/reset-password", async (req, res) => {
  try {
    const { userId } = req.body;

    // 보안을 위해 실제 서비스 시에는 암호화(bcrypt 등)를 권장하지만,
    // 현재 구조에 맞춰 평문 또는 기존 방식대로 저장합니다.
    const user = await User.findByIdAndUpdate(
      userId,
      { password: "1234" },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: "유저를 찾을 수 없습니다." });
    }

    res.json({
      message: `${user.username}님의 비밀번호가 '1234'로 초기화되었습니다.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
