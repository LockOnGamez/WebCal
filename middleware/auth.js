/**
 * 권한 체크 미들웨어
 */

// 1. 로그인 여부만 체크 (API용: JSON 반환 / 페이지용: 리다이렉트)
const checkLogin = (req, res, next) => {
    if (!req.session || !req.session.user) {
        // API 요청인 경우
        if (req.originalUrl.startsWith('/api/')) {
            return res.status(401).json({ message: "로그인이 필요합니다." });
        }
        // 일반 페이지 요청인 경우 (로그인 페이지로 리다이렉트)
        // 쿼리 파라미터로 에러 전달
        return res.redirect('/?error=session_expired');
    }
    next();
};

// 2. 관리자 권한 체크
const checkAdmin = (req, res, next) => {
    // 로그인이 안 되어 있으면 checkLogin과 동일하게 처리
    if (!req.session || !req.session.user) {
        if (req.originalUrl.startsWith('/api/')) {
            return res.status(401).json({ message: "로그인이 필요합니다." });
        }
        return res.redirect('/?error=login_required');
    }

    // 관리자가 아닌 경우
    if (req.session.user.role !== 'admin') {
        if (req.originalUrl.startsWith('/api/')) {
            return res.status(403).json({ message: "관리자 전용 기능입니다." });
        }
        return res.redirect('/main.html?error=admin_only');
    }
    next();
};

// 3. 세부 권한 체크 (특정 기능에 대한 수정/삭제 권한)
const checkPermission = (feature) => {
    return (req, res, next) => {
        if (!req.session || !req.session.user) {
            if (req.originalUrl.startsWith('/api/')) {
                return res.status(401).json({ message: "로그인이 필요합니다." });
            }
            return res.redirect('/?error=login_required');
        }

        // 관리자는 모든 권한 허용
        if (req.session.user.role === 'admin') {
            return next();
        }

        // 일반 사용자인 경우 세부 권한 확인
        const userPermissions = req.session.user.permissions || {};
        if (userPermissions[feature] === true) {
            return next();
        }

        // 권한이 없는 경우
        if (req.originalUrl.startsWith('/api/')) {
            return res.status(403).json({ message: "해당 기능에 대한 권한이 없습니다." });
        }
        return res.redirect('/main.html?error=no_permission');
    };
};

module.exports = { checkLogin, checkAdmin, checkPermission };
