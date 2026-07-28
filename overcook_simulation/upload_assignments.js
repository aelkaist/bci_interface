// upload_assignments.js
// CSV 할당표를 Firestore assignments 컬렉션에 업로드하는 스크립트
// 사용법: node upload_assignments.js
// CSV 수정 후 재실행하면 기존 데이터를 덮어씁니다.

import { readFileSync } from "fs";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, writeBatch } from "firebase/firestore";

// ── Firebase 설정 (환경변수 또는 직접 입력) ──
const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || "AIzaSyDWJQ055-OqXA1fnTfIgWzmq5uWMZyFjnM",
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || "overcookedpilot.firebaseapp.com",
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || "overcookedpilot",
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || "overcookedpilot.firebasestorage.app",
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "109877491451",
  appId: process.env.VITE_FIREBASE_APP_ID || "1:109877491451:web:2b851027b1eabfbf18a25e",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ── CSV 파싱 ──
function parseCSV(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim());
    if (values.length < headers.length) continue;

    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx];
    });
    rows.push(row);
  }

  return rows;
}

// ── group 이름을 폴더명으로 매핑 ──
function groupToFolderName(group) {
  switch (group) {
    case "Low":
      return "Low";
    case "Mid":
      return "Middle";
    case "High":
      return "High";
    default:
      return group;
  }
}

// ── 파일명에서 layout 이름 추출 ──
// 예: "2_forced_hard_seed1_4520000_40.json" → "2_forced_hard"
// 예: "2_forced_hard_4_seed3_9520000_40.json" → "2_forced_hard_4"
// 예: "2_incentivized_hard_seed1_1020000_60.json" → "2_incentivized_hard"
// 예: "2_incentivized_hard_4_seed1_2020000_60.json" → "2_incentivized_hard_4"
function extractLayoutName(filename) {
  const KNOWN_LAYOUTS = [
    "2_forced_hard_4",
    "2_forced_hard",
    "2_incentivized_hard_4",
    "2_incentivized_hard",
  ];

  for (const layout of KNOWN_LAYOUTS) {
    if (filename.startsWith(layout + "_seed")) {
      return layout;
    }
  }
  return null;
}

// ── 메인 업로드 ──
async function uploadAssignments() {
  const csvPath = "public/Participant Assignment.csv";
  console.log(`📄 Reading CSV from: ${csvPath}`);

  const csvText = readFileSync(csvPath, "utf-8");
  const rows = parseCSV(csvText);

  console.log(`📊 Parsed ${rows.length} assignment rows`);

  // Firestore writeBatch는 500개씩 제한이 있으므로 나눠서 처리
  const BATCH_SIZE = 400;
  let totalWritten = 0;

  for (let batchStart = 0; batchStart < rows.length; batchStart += BATCH_SIZE) {
    const batch = writeBatch(db);
    const batchRows = rows.slice(batchStart, batchStart + BATCH_SIZE);

    for (let i = 0; i < batchRows.length; i++) {
      const row = batchRows[i];
      const globalIndex = batchStart + i;
      const assignmentId = row["assignment_id"];

      if (!assignmentId) {
        console.warn(`⚠️  Row ${globalIndex + 1}: missing assignment_id, skipping`);
        continue;
      }

      const group = row["group"]; // Low, Mid, High
      const folderName = groupToFolderName(group);
      const maps = [row["Map 1"], row["Map 2"], row["Map 3"], row["Map 4"]];

      // 각 맵의 전체 경로를 구성: {layout}/{group}/{filename}
      const mapPaths = maps.map((filename) => {
        if (!filename || filename.startsWith("Trajectory")) {
          // "Trajectory 9" 같은 특수 값은 그대로 유지
          return filename;
        }
        const layout = extractLayoutName(filename);
        if (!layout) {
          console.warn(`⚠️  Row ${assignmentId}: cannot determine layout for "${filename}"`);
          return filename;
        }
        return `${layout}/${folderName}/${filename}`;
      });

      const docRef = doc(db, "assignments", assignmentId);
      batch.set(docRef, {
        assignmentId,
        group,
        maps: mapPaths,
        mapGroup: row["Map group"],
        hasStarted: false,
        hasFinished: false,
        order: globalIndex, // 순차 배정을 위한 정렬 인덱스
        assignedTo: null,
        assignedAt: null,
        completedAt: null,
      });
    }

    await batch.commit();
    totalWritten += batchRows.length;
    console.log(`✅ Batch committed: ${totalWritten}/${rows.length}`);
  }

  console.log(`\n🎉 Done! Uploaded ${totalWritten} assignments to Firestore.`);
  console.log(`   Collection: "assignments"`);
  console.log(`   Documents: ${rows[0]?.assignment_id} ~ ${rows[rows.length - 1]?.assignment_id}`);
  process.exit(0);
}

uploadAssignments().catch((err) => {
  console.error("❌ Upload failed:", err);
  process.exit(1);
});
