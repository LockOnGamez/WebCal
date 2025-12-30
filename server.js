const express = require("express");
const http = require("http");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const cors = require("cors");
const authRoutes = require("./routes/auth");
const inventoryRoutes = require("./routes/inventory");
const calendarRoutes = require("./routes/caleandar");
const optionRoutes = require("./routes/options");
const backupRoutes = require("./routes/backup");

const session = require("express-session");
const { RedisStore } = require("connect-redis");
const redisClient = require("./config/redis");

const holidayRoutes = require(`./routes/holidays`);

const attendanceRoutes = require(`./routes/attendance`);

// 미들웨어
const { checkLogin, checkAdmin } = require("./middleware/auth");

dotenv.config();

// 1. 앱 초기화
const app = express();
const server = http.createServer(app);

app.set("trust proxy", 1);

// 2. 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// 3. 몽고DB 연결
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB 연결 성공!"))
  .catch((err) => console.error("❌ MongoDB 연결 실패:", err));

// 4. 세션 설정
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

// [추가] 정적 페이지 보호 (HTML 파일 및 루트 접근 제어)
app.use((req, res, next) => {
    const path = req.path;
    // .html 파일이거나 루트(/) 요청인 경우만 체크
    if (path === "/" || path.endsWith(".html")) {
        const isPublic = (path === "/" || path === "/index.html" || path === "/register.html");
        
        if (isPublic) {
            // 로그인된 사용자가 로그인 페이지 접근 시 메인으로
            if (req.session && req.session.user) {
                return res.redirect('/main.html');
            }
            return next();
        }
        
        // 그 외 HTML 페이지는 로그인 체크
        return checkLogin(req, res, next);
    }
    next();
});

app.use(express.static("public"));

app.get("/ping", (req, res) => {
  res.status(200).send("pong");
});

// 5. 라우터 연결
app.use("/api", authRoutes); 

// 재고 관리: 조회는 누구나, 수정/삭제는 관리자만 (세부 제어는 라우터 내부에서 하거나 여기서 분리)
app.use("/api/inventory", checkLogin, (req, res, next) => {
    if (req.method === "GET") return next();
    checkAdmin(req, res, next);
}, inventoryRoutes);

app.use("/api/calendar", checkLogin, calendarRoutes); 
app.use("/api/options", checkLogin, (req, res, next) => {
    if (req.method === "GET") return next();
    checkAdmin(req, res, next);
}, optionRoutes); 

app.use(`/api/holidays`, holidayRoutes);
app.use("/api/attendance", checkLogin, attendanceRoutes);
app.use("/api/admin", checkLogin, checkAdmin, backupRoutes);

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
