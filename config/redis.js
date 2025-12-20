const { createClient } = require("redis");
const dotenv = require("dotenv");

dotenv.config();

// .env에 있는 정보들을 조합해서 접속 주소(URL)를 만듭니다.
// 형식: redis://default:비밀번호@주소:포트
const redisUrl = `redis://default:${process.env.REDIS_PASSWORD}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`;

// Redis 클라이언트 생성
const client = createClient({
  url: redisUrl,
});

client.on("error", (err) => console.error("❌ Redis Client Error", err));
client.on("connect", () => console.log("✅ Redis 연결 성공!"));

// 연결 시작 함수
const connectRedis = async () => {
  if (!client.isOpen) {
    await client.connect();
  }
};

// 연결 실행
connectRedis();

module.exports = client;
