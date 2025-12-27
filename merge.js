const fs = require("fs");
const path = require("path");

// --- 설정 ---
const TARGET_DIR = "./"; // 현재 폴더 전체를 대상으로 함
const OUTPUT_FILE = "merged_code_report.txt";
const EXTENSIONS = [".js", ".json", ".html", ".css", ".env"]; // 포함할 확장자 (.cs 제거, .env/.css 추가)

// 제외할 폴더 및 파일 목록
const EXCLUDE_NAMES = [
  "node_modules",
  "Library",
  ".git",
  "package-lock.json", // 병합 시 너무 길어지므로 제외 권장
  OUTPUT_FILE, // 자기 자신(결과 파일) 제외
];

function readFiles(dir, allFiles = []) {
  if (!fs.existsSync(dir)) return allFiles;

  const files = fs.readdirSync(dir);
  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const stats = fs.statSync(filePath);

    // 1. 제외 목록에 포함된 이름이면 건너뜀
    if (EXCLUDE_NAMES.includes(file)) return;

    if (stats.isDirectory()) {
      // 2. 재귀적으로 하위 폴더 탐색
      readFiles(filePath, allFiles);
    } else {
      // 3. 확장자 체크 후 리스트에 추가
      if (EXTENSIONS.includes(path.extname(file)) || file === ".env") {
        allFiles.push(filePath);
      }
    }
  });
  return allFiles;
}

function mergeFiles() {
  try {
    console.log("🔍 파일을 검색 중입니다...");
    const files = readFiles(TARGET_DIR);

    let combinedContent = `=== Project Merge Report: ${new Date().toLocaleString()} ===\n`;
    combinedContent += `=== Total Files Found: ${files.length} ===\n\n`;

    files.forEach((file, index) => {
      const content = fs.readFileSync(file, "utf8");
      combinedContent += `\n\n// ==========================================\n`;
      combinedContent += `// [${index + 1}/${files.length}] FILE: ${file}\n`;
      combinedContent += `// ==========================================\n\n`;
      combinedContent += content;
      combinedContent += `\n\n// --- END OF FILE: ${file} ---\n`;
      console.log(`✅ 병합 중: ${file}`);
    });

    fs.writeFileSync(OUTPUT_FILE, combinedContent);
    console.log(
      `\n✨ 성공! 총 ${files.length}개의 파일이 ${OUTPUT_FILE}에 병합되었습니다.`
    );
  } catch (err) {
    console.error("❌ 오류 발생:", err);
  }
}

mergeFiles();
