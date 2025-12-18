const express = require("express");
const http = require("http");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const cors = require("cors");
const authRoutes = require("./routes/auth");
const inventoryRoutes = require("./routes/inventory");
const calendarRoutes = require("./routes/caleandar");
const optionRoutes = require("./routes/options");

dotenv.config();

// 1. 앱 초기화
const app = express();
const server = http.createServer(app);

// 2. 미들웨어 설정 (반드시 이 순서여야 합니다!)
app.use(cors()); // 보안 해제
app.use(express.json()); // JSON 데이터 받기 (이게 없으면 req.body가 비어서 터짐)
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// 3. 몽고DB 연결
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB 연결 성공!"))
  .catch((err) => console.error("❌ MongoDB 연결 실패:", err));

// 4. 라우터 연결
app.use("/api", authRoutes); // /api 경로로 연결
app.use("/api/inventory", inventoryRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/options", optionRoutes);

// 5. 서버 시작
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
