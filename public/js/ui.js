/**
 * Smart Factory Premium UI Utility
 */

const UI = {
    // 1. 세련된 토스트 알림
    showToast: (message, type = 'success', duration = 3000) => {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };

        toast.innerHTML = `
            <span>${icons[type] || '🔔'}</span>
            <span>${message}</span>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'toast-out 0.4s ease forwards';
            setTimeout(() => toast.remove(), 400);
        }, duration);
    },

    // 2. 프리미엄 알림 모달 (alert 대체)
    alert: (title, message, type = 'info') => {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'alert-overlay';

            const icons = {
                success: '✨',
                error: '🚫',
                warning: '⚠️',
                info: '🔔'
            };

            overlay.innerHTML = `
                <div class="alert-box">
                    <div class="alert-icon">${icons[type] || icons.info}</div>
                    <div class="alert-title">${title}</div>
                    <div class="alert-msg">${message}</div>
                    <button class="alert-btn">확인</button>
                </div>
            `;

            document.body.appendChild(overlay);

            const btn = overlay.querySelector('.alert-btn');
            btn.addEventListener('click', () => {
                overlay.style.opacity = '0';
                overlay.querySelector('.alert-box').style.transform = 'translateY(20px) scale(0.9)';
                setTimeout(() => {
                    overlay.remove();
                    resolve();
                }, 300);
            });
        });
    },

    // 3. 프리미엄 확인 모달 (confirm 대체)
    confirm: (title, message, type = 'warning') => {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'alert-overlay';

            const icons = {
                success: '✨',
                error: '🚫',
                warning: '🚨',
                info: '❓'
            };

            overlay.innerHTML = `
                <div class="alert-box">
                    <div class="alert-icon">${icons[type] || icons.warning}</div>
                    <div class="alert-title">${title}</div>
                    <div class="alert-msg">${message}</div>
                    <div style="display:flex; gap:10px; width:100%; margin-top:20px;">
                        <button class="alert-btn btn-cancel" style="background:var(--btn-hover); color:var(--text-sub); flex:1;">취소</button>
                        <button class="alert-btn btn-confirm" style="background:var(--accent-gradient); color:white; flex:2;">확인</button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            const remove = (val) => {
                overlay.style.opacity = '0';
                overlay.querySelector('.alert-box').style.transform = 'translateY(20px) scale(0.9)';
                setTimeout(() => {
                    overlay.remove();
                    resolve(val);
                }, 300);
            };

            overlay.querySelector('.btn-confirm').onclick = () => remove(true);
            overlay.querySelector('.btn-cancel').onclick = () => remove(false);
            overlay.onclick = (e) => { if(e.target === overlay) remove(false); };
        });
    }
};

// 전역객체 등록
window.UI = UI;

// [추가] 전역 Fetch Error Handling (401 Unauthorized 처리)
const originalFetch = window.fetch;
window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (response.status === 401) {
        // 로그인 세션 만료 시 처리
        if (!window.location.pathname.endsWith('/') && !window.location.pathname.endsWith('index.html')) {
            await UI.alert("세션 만료", "로그인 세션이 만료되었습니다. 다시 로그인해주세요.", "warning");
            localStorage.clear();
            window.location.href = '/';
        }
    }
    return response;
};
