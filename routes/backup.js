const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

// 모델들
const User = require("../models/User");
const Item = require("../models/Item");
const Event = require("../models/Event");
const Attendance = require("../models/Attendance");
const Log = require("../models/Log");
const Option = require("../models/Option");

const { checkAdmin } = require("../middleware/auth");

// 1. 데이터 내보내기 (Export)
router.get("/export", checkAdmin, async (req, res) => {
    try {
        const { start, end } = req.query;
        let data = {};

        if (!start || !end) {
            // 전체 백업 모드
            data = {
                users: await User.find(),
                items: await Item.find(),
                events: await Event.find(),
                attendance: await Attendance.find(),
                logs: await Log.find(),
                options: await Option.find(),
                exportInfo: {
                    type: "FULL",
                    timestamp: new Date()
                }
            };
        } else {
            // 기간 필터링 모드
            const startDate = new Date(start);
            const endDate = new Date(end);
            endDate.setHours(23, 59, 59, 999);

            data = {
                events: await Event.find({ date: { $gte: start, $lte: end } }), // Event는 문자열 날짜(KST) 기반임
                attendance: await Attendance.find({ date: { $gte: start, $lte: end } }),
                logs: await Log.find({ timestamp: { $gte: startDate, $lte: endDate } }),
                exportInfo: {
                    type: "FILTERED",
                    range: { start, end },
                    timestamp: new Date()
                }
            };
        }

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=factory_backup_${new Date().toISOString().split('T')[0]}.json`);
        res.send(JSON.stringify(data, null, 2));

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. 데이터 가져오기 (Import) - 전체 복구 또는 머지 로직
router.post("/import", checkAdmin, upload.single('backup'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "파일이 없습니다." });
        const data = JSON.parse(req.file.buffer.toString());

        // 복구 전 현재 데이터 백업 로그 (선택 사항)
        console.log("📥 데이터 복구 시도 중...");

        if (data.exportInfo && data.exportInfo.type === "FULL") {
            // 전체 복구 모드: 기존 데이터 삭제 후 삽입
            if (data.users) { await User.deleteMany({}); await User.insertMany(data.users); }
            if (data.items) { await Item.deleteMany({}); await Item.insertMany(data.items); }
            if (data.events) { await Event.deleteMany({}); await Event.insertMany(data.events); }
            if (data.attendance) { await Attendance.deleteMany({}); await Attendance.insertMany(data.attendance); }
            if (data.options) { await Option.deleteMany({}); await Option.insertMany(data.options); }
            // 로그는 날리지 않고 유지하면서 머지하는 것이 안전함 (선택사항)
            if (data.logs) await Log.insertMany(data.logs);
            
            res.json({ message: "전체 데이터 복구 성공" });
        } else if (data.exportInfo && data.exportInfo.type === "FILTERED") {
            // 필터링 모드: 단순히 추가(Merge)
            if (data.events) await Event.insertMany(data.events);
            if (data.attendance) await Attendance.insertMany(data.attendance);
            if (data.logs) await Log.insertMany(data.logs);

            res.json({ message: "기간 데이터 머지 성공" });
        } else {
            res.status(400).json({ message: "유효하지 않은 백업 파일 형식입니다." });
        }

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
