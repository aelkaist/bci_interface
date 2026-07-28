// reset_db.js
// Firestore assignments 컬렉션의 상태를 초기화하는 스크립트
// 사용법:
//   node reset_db.js --in-progress   (진행 중(In Progress) 상태인 항목만 초기화)
//   node reset_db.js --all           (모든 assignment 초기화)

import fs from "fs";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, writeBatch } from "firebase/firestore";

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

async function main() {
  const args = process.argv.slice(2);
  const resetAll = args.includes("--all");
  const modeText = resetAll ? "전체 (ALL)" : "진행 중 (In Progress만)";

  console.log(`🔄 Firestore assignments 초기화 시작 (${modeText})...`);

  const snap = await getDocs(collection(db, "assignments"));
  console.log(`📊 총 ${snap.size}개 문서 확인 완료.`);

  let batch = writeBatch(db);
  let count = 0;
  let totalReset = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();

    if (!resetAll) {
      // 진행 중인 것만 (hasStarted = true, hasFinished = false)
      if (!data.hasStarted || data.hasFinished) {
        continue;
      }
    }

    batch.update(doc(db, "assignments", docSnap.id), {
      hasStarted: false,
      hasFinished: false,
      assignedTo: null,
      assignedAt: null,
      completedAt: null,
    });

    count++;
    totalReset++;

    if (count === 400) {
      await batch.commit();
      console.log(`  - ${totalReset}개 업데이트 커밋 완료`);
      batch = writeBatch(db);
      count = 0;
    }
  }

  if (count > 0) {
    await batch.commit();
  }

  console.log(`\n🎉 완료! 총 ${totalReset}개 assignment가 초기화되었습니다.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Reset 실패:", err);
  process.exit(1);
});
