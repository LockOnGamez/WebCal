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

// 4. (관리자용) 승인 처리
router.post("/admin/approve", async (req, res) => {
  try {
    const { username } = req.body;
    await User.findOneAndUpdate({ username }, { isApproved: true });
    res.json({ message: `${username} 승인 완료` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. (관리자용) 가입 거절 (유저 삭제)
router.post("/admin/reject", async (req, res) => {
  try {
    const { username } = req.body;
    // 유저 찾아서 삭제
    await User.findOneAndDelete({ username });
    res.json({ message: `${username} 님의 가입을 거절(삭제)했습니다.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
