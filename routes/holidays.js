const express = require("express");
const router = express.Router();
const axios = require("axios");
const client = require("../config/redis");

router.get("/:year", async (req, res) => {
  const year = req.params.year;
  // 데이터 구조가 변경되었으므로 키 이름을 v2로 업데이트하여 충돌을 방지합니다.
  const redisKey = `holidays_v2:${year}`;

  const SERVICE_KEY = process.env.DATA_GO_KR_KEY;

  try {
    // 1. Redis 캐시 확인
    const cachedData = await client.get(redisKey);
    if (cachedData) {
      console.log(`🚀 Redis 캐시 사용 (${year}년)`);
      return res.json(JSON.parse(cachedData));
    }

    // 2. 공공데이터 API 호출
    const baseUrl =
      "http://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo";
    const fullUrl = `${baseUrl}?ServiceKey=${SERVICE_KEY}&solYear=${year}&_type=json&numOfRows=100`;

    console.log(`🌐 공공데이터 API 호출 중: ${year}년`);
    const response = await axios.get(fullUrl);

    if (response.data.response?.header?.resultCode !== "00") {
      console.error(
        "❌ API 인증 실패:",
        response.data.response?.header?.resultMsg
      );
      return res.status(401).json({ error: "인증 실패" });
    }

    const items = response.data.response.body.items?.item;
    const holidayList = Array.isArray(items) ? items : items ? [items] : [];

    // 날짜와 이름을 모두 포함한 객체 배열 생성
    const formattedHolidays = holidayList.map((item) => {
      const date = String(item.locdate);
      return {
        date: `${date.substring(0, 4)}-${date.substring(4, 6)}-${date.substring(
          6,
          8
        )}`,
        name: item.dateName, // 공휴일 명칭 (예: 신정, 설날)
      };
    }); // 이 부분 괄호가 누락되어 수정했습니다.

    // 3. Redis 저장 (30일 유지)
    if (formattedHolidays.length > 0) {
      await client.setEx(redisKey, 2592000, JSON.stringify(formattedHolidays));
    }

    res.json(formattedHolidays);
  } catch (error) {
    console.error(`${year}년 공휴일 처리 중 에러:`, error.message);
    res.status(500).json([]);
  }
});

module.exports = router;
