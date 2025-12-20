// 모바일 버튼 클릭 이벤트
const mobileBtn = document.getElementById("mobileAddBtn");

if (mobileBtn) {
  mobileBtn.addEventListener("click", function () {
    // 1. 오늘 날짜 구하기 (YYYY-MM-DD)
    const today = new Date().toISOString().split("T")[0];

    // 2. 날짜 입력칸(id="date")에 오늘 날짜 채워주기
    // (본인 HTML의 날짜 입력칸 ID가 'date'인지 확인 필요)
    const dateInput = document.querySelector('input[type="date"]');
    if (dateInput) {
      dateInput.value = today;
    }

    // 3. 모달창 띄우기 함수 실행
    // ★중요★: 본인 코드에서 모달창 띄우는 함수 이름이 openModal이 아니면 수정하세요!
    if (typeof openModal === "function") {
      openModal();
    } else {
      console.error("모달 띄우는 함수 이름을 확인해주세요!");
      alert("일정 추가 창을 띄우는 함수를 찾을 수 없습니다.");
    }
  });
}
