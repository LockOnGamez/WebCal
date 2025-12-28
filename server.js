const express = require("express");
const http = require("http");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const cors = require("cors");
const authRoutes = require("./routes/auth");
const inventoryRoutes = require("./routes/inventory");
const calendarRoutes = require("./routes/caleandar");
const optionRoutes = require("./routes/options");

const session = require("express-session");
const { RedisStore } = require("connect-redis");
const redisClient = require("./config/redis");

const holidayRoutes = require(`./routes/holidays`);

dotenv.config();

// 1. 앱 초기화
const app = express();
const server = http.createServer(app);

app.set("trust proxy", 1);

// 2. 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// 3. 몽고DB 연결
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB 연결 성공!"))
  .catch((err) => console.error("❌ MongoDB 연결 실패:", err));

// 4. 세션 설정 (라우터 연결보다 먼저 와야 함)
app.use(
  session({
    store: new RedisStore({
      client: redisClient,
      prefix: "session:",
    }),
    secret: "my-super-secret-key-reset",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24,
      sameSite: "lax",
    },
  })
);

// --- 권한 체크 미들웨어 분리 ---

// [A] 로그인 여부만 체크 (일반 유저/관리자 모두 통과)
const checkLogin = (req, res, next) => {
  if (!req.session || !req.session.user) {
    console.log(">> 탈락: 로그인 안됨");
    return res.send(
      '<script>alert("로그인하세요"); location.href="/login";</script>'
    );
  }
  next();
};

// [B] 관리자 권한까지 체크 (관리자만 통과)
const checkAdmin = (req, res, next) => {
  // 먼저 로그인이 되어있는지 확인
  if (!req.session || !req.session.user) {
    return res.send(
      '<script>alert("로그인하세요"); location.href="/login";</script>'
    );
  }
  // 관리자인지 확인
  if (req.session.user.role !== "admin") {
    console.log(`>> 탈락: 관리자 아님 (현재 역할: ${req.session.user.role})`);
    return res
      .status(403)
      .send(
        '<script>alert("관리자만 접근 가능합니다."); location.href="/";</script>'
      );
  }
  next();
};

app.get("/ping", (req, res) => {
  res.status(200).send("pong");
});

// 5. 라우터 연결 (권한 미들웨어 적용)
app.use("/api", authRoutes); // 로그인/회원가입은 체크 안함
app.use("/api/inventory", checkLogin, inventoryRoutes); // 재고는 로그인해야 함
app.use("/api/calendar", checkLogin, calendarRoutes); // 달력은 로그인만 하면 됨
app.use(
  "/api/options",
  (req, res, next) => {
    // GET(조회)은 누구나 가능, POST/DELETE(수정)는 관리자만 가능하게 분리
    if (req.method === "GET") {
      return next(); // 조회는 checkAdmin 건너뜀
    }
    checkAdmin(req, res, next); // 그 외엔 관리자 체크
  },
  optionRoutes
); // 옵션은 관리자만!

app.use(`/api/holidays`, holidayRoutes);

const Item = require("./models/Item");

// 6. 서버 시작
const PORT = process.env.PORT || 3000;

server.listen(PORT, async () => {
  console.log(`🚀 서버 실행 중: http://localhost:${PORT}`);
  try {
    if (!redisClient.isOpen) await redisClient.connect();

    // 1. [임시 추가] 기존 DB의 지저분한 소수점 데이터 일괄 정제
    const Item = require("./models/Item");
    const allItems = await Item.find({});

    console.log("🔍 소수점 데이터 정제 시작...");
    for (const item of allItems) {
      // 소수점 한 자리로 반올림 (7.7999 -> 7.8)
      const cleanedQty = parseFloat(item.quantity.toFixed(1));

      // 기존 수량과 정제된 수량이 다를 때만 업데이트
      if (item.quantity !== cleanedQty) {
        await Item.updateOne(
          { _id: item._id },
          { $set: { quantity: cleanedQty } }
        );
        console.log(
          `✅ 정제됨: ${item.name} (${item.quantity} -> ${cleanedQty})`
        );
      }
    }
    console.log("✨ 모든 재고 데이터 정제 완료");

    // 2. 캐시 초기화 및 예열
    await redisClient.del("cache:inventory");
    await redisClient.del("cache:options");

    const items = await Item.find().sort({ updatedAt: -1 });
    await redisClient.set("cache:inventory", JSON.stringify(items));

    const Option = require("./models/Option");
    const options = await Option.find();
    await redisClient.set("cache:options", JSON.stringify(options));

    console.log(
      `🔥 데이터 예열 완료: 재고 ${items.length}개, 옵션 ${options.length}개`
    );
  } catch (e) {
    console.error("초기화 중 오류:", e);
  }
});
