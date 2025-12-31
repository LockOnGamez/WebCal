const express = require("express");
const router = express.Router();
const Item = require("../models/Item");

/**
 * 카카오톡 챗봇 스킬 엔드포인트
 * POST /api/bot
 */
router.post("/", async (req, res) => {
    try {
        // [디버킹용] 요청 데이터 확인 (Render 로그에서 확인 가능)
        console.log("🤖 Kakao Bot Request Received");
        
        // 1. 파라미터 추출
        const params = req.body.action.params || {};
        let category = "전체";

        // 사용자가 관리자 센터에서 설정한 파라미터명(완제품, 원자재)에 값이 있는지 확인
        if (params.완제품) category = "완제품";
        else if (params.원자재) category = "원자재";
        else if (params.category) category = params.category; 

        console.log(`🔍 요청된 카테고리: ${category}`);

        // 2. DB 조회 (재고가 0보다 큰 품목만)
        const query = { quantity: { $gt: 0 } };
        if (category !== "전체") {
            query.category = category;
        }
        const items = await Item.find(query).sort({ updatedAt: -1 });

        // 3. 메시지 텍스트 구성
        let responseText = "";
        if (items.length === 0) {
            responseText = `⚠️ [${category}] 조회 결과가 없습니다.`;
        } else {
            responseText = `📦 [${category}] 재고 현황\n━━━━━━━━━━━━━━\n`;
            
            // 카톡 글자수 제한(1000자)을 고려하여 최대 15개까지만 노출
            const maxItems = 15;
            items.slice(0, maxItems).forEach(item => {
                const stockStatus = item.quantity <= 0 ? "❗품절" : `${item.quantity}개`;
                responseText += `• ${item.name} (${item.size}/${item.length}m): ${stockStatus}\n`;
            });

            if (items.length > maxItems) {
                responseText += `\n...외 ${items.length - maxItems}건이 더 있습니다.`;
            }
        }

        // 4. Kakao Skill Response v2.0 정석 구조
        const responseBody = {
            version: "2.0",
            template: {
                outputs: [
                    {
                        simpleText: {
                            text: responseText.slice(0, 1000) // 혹시 모를 글자수 초과 방지
                        }
                    }
                ],
                quickReplies: [
                    { label: "전체 재고", action: "message", messageText: "/재고 전체" },
                    { label: "완제품 보기", action: "message", messageText: "/재고 완제품" },
                    { label: "원자재 보기", action: "message", messageText: "/재고 원자재" }
                ]
            }
        };

        return res.status(200).json(responseBody);

    } catch (err) {
        console.error("❌ Kakao Bot Error:", err);
        return res.status(200).json({
            version: "2.0",
            template: {
                outputs: [
                    {
                        simpleText: {
                            text: "죄송합니다. 서버 통신 중 오류가 발생했습니다."
                        }
                    }
                ]
            }
        });
    }
});

module.exports = router;
