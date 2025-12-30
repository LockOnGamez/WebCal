document.addEventListener('DOMContentLoaded', () => {
    const role = localStorage.getItem('role');
    const path = window.location.pathname;
    const page = path.split('/').pop() || 'main.html';

    const menuItems = [
        { name: '홈', icon: '🏠', url: 'main.html' },
        { name: '재고', icon: '📦', url: 'inventory.html' },
        { name: '일정', icon: '📅', url: 'calendar.html' },
        { name: '생산', icon: '🏭', url: 'production.html' }
    ];

    if (role === 'admin') {
        menuItems.push({ name: '관리', icon: '⚙️', url: 'admin.html' });
    }

    // Improve page detection for active state
    const currentPage = page === '' || page === 'index.html' ? 'main.html' : page;

    // Generate Sidebar HTML
    let sidebarHtml = `<div id="sidebar">
        <div style="font-size:0.7rem; font-weight:900; color:var(--highlight); text-align:center; margin-bottom:10px;">F-OS</div>
        ${menuItems.map(item => `
            <a href="${item.url}" class="nav-item ${currentPage === item.url ? 'active' : ''}">
                <span style="font-size:1.6rem;">${item.icon}</span>
                <span style="font-size:0.65rem; margin-top:-2px;">${item.name}</span>
            </a>
        `).join('')}
    </div>`;

    // Generate Bottom Nav HTML (Mobile)
    let bottomNavHtml = `<div id="bottom-nav">
        ${menuItems.map(item => `
            <a href="${item.url}" class="nav-item ${currentPage === item.url ? 'active' : ''}">
                <span style="font-size:1.5rem;">${item.icon}</span>
                <span style="font-size:0.75rem;">${item.name}</span>
            </a>
        `).join('')}
    </div>`;

    // Inject into body
    document.body.insertAdjacentHTML('afterbegin', sidebarHtml);
    document.body.insertAdjacentHTML('beforeend', bottomNavHtml);

    // [Clean up] Remove old back buttons or redundant home links
    document.querySelectorAll('.nav-btn, .back-btn, .header .nav-btns button').forEach(btn => {
        const txt = btn.innerText.toLowerCase();
        if (txt.includes('홈') || txt.includes('home') || txt.includes('🏠')) {
            btn.style.setProperty('display', 'none', 'important');
        }
    });
});
