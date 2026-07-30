// fetch_main_experiment.js
// 현재 본 실험(main)의 "완료 + assignedAt(정상 배정)" 참가자를 그룹(Low/Mid/High)별 버킷으로 만들어
// analysis/dashboard/data/ 에 저장하고 manifest.json에 추가합니다.
// analysis 대시보드의 pilot 드롭다운에서 Low/Mid/High를 골라 보는 필터로 동작합니다.
//
//   node fetch_main_experiment.js
//
// 대상 선정 기준: assignments 문서 중 hasFinished=true AND assignedAt != null
//   → 그 assignedTo 참가자 = 현재 유효하게 집계되는 완료자 (orphan 채택/좀비 리셋 반영됨)

import { initializeApp } from "firebase/app";
import { getFirestore, collection, collectionGroup, getDocs } from "firebase/firestore";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = [path.resolve(__dirname, ".env.local"), path.resolve(__dirname, ".env")].find(p => fs.existsSync(p));
const env = {};
fs.readFileSync(envPath, "utf8").split("\n").forEach(line => { const [k, ...v] = line.split("="); if (k) env[k.trim()] = v.join("=").trim(); });

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID, storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID, appId: env.VITE_FIREBASE_APP_ID,
});
const db = getFirestore(app);

const dataDir = path.resolve(__dirname, "../analysis/dashboard/data");

async function run() {
  console.log("Fetching assignments...");
  const aSnap = await getDocs(collection(db, "assignments"));
  // 참가자 -> {group, assignmentId}  (hasFinished=true & assignedAt 존재)
  const target = {};
  for (const d of aSnap.docs) {
    const a = d.data();
    if (a.hasFinished === true && a.assignedTo && a.assignedAt) {
      if (!target[a.assignedTo]) target[a.assignedTo] = { group: a.group || "?", assignmentId: d.id, assignedAt: a.assignedAt, completedAt: a.completedAt || null };
    }
  }
  const targetIds = new Set(Object.keys(target));
  console.log(`대상 참가자(완료+assignedAt): ${targetIds.size}명`);

  // 세션 (대상만)
  console.log("Fetching sessions...");
  const sSnap = await getDocs(collectionGroup(db, "experiment_sessions"));
  const pMap = {};
  for (const doc of sSnap.docs) {
    const parts = doc.ref.path.split("/");
    if (parts[0] !== "participants") continue;
    const pId = parts[1];
    if (!targetIds.has(pId)) continue;
    if (!pMap[pId]) pMap[pId] = { id: pId, group: target[pId].group, assignmentId: target[pId].assignmentId, sessions: [], episodes: [], feedbackItems: [], postSurveys: [] };
    pMap[pId].sessions.push({ docId: doc.id, ...doc.data() });
  }

  // 에피소드 + 피드백 + 서베이
  console.log("Fetching episodes / feedback / surveys...");
  for (const pId of Object.keys(pMap)) {
    const epSnap = await getDocs(collection(db, `participants/${pId}/episodes`));
    for (const epDoc of epSnap.docs) {
      const ep = { docId: epDoc.id, ...epDoc.data(), feedbackItems: [] };
      const itemsSnap = await getDocs(collection(db, `participants/${pId}/episodes/${epDoc.id}/feedback_items`));
      for (const it of itemsSnap.docs) ep.feedbackItems.push({ docId: it.id, ...it.data() });
      pMap[pId].episodes.push(ep);
      pMap[pId].feedbackItems.push(...ep.feedbackItems);
    }
    pMap[pId].episodes.sort((a, b) => (a.episodeCount || 0) - (b.episodeCount || 0));
    const surveySnap = await getDocs(collection(db, `participants/${pId}/post_surveys`));
    for (const sDoc of surveySnap.docs) pMap[pId].postSurveys.push({ docId: sDoc.id, ...sDoc.data() });
  }

  // 그룹별 버킷
  const buckets = { All: {}, Low: {}, Mid: {}, High: {} };
  for (const [pId, p] of Object.entries(pMap)) {
    buckets.All[pId] = p;
    if (buckets[p.group]) buckets[p.group][pId] = p;
  }

  const defs = [
    { id: "main-all",  label: "▶ Main (All groups)", key: "All",  file: "main-all.json" },
    { id: "main-low",  label: "▶ Main — Low",        key: "Low",  file: "main-low.json" },
    { id: "main-mid",  label: "▶ Main — Mid",        key: "Mid",  file: "main-mid.json" },
    { id: "main-high", label: "▶ Main — High",       key: "High", file: "main-high.json" },
  ];

  fs.mkdirSync(dataDir, { recursive: true });
  const mainEntries = [];
  for (const def of defs) {
    const bucket = buckets[def.key];
    fs.writeFileSync(path.join(dataDir, def.file), JSON.stringify(bucket, null, 2));
    const n = Object.keys(bucket).length;
    mainEntries.push({ id: def.id, label: `${def.label} (${n})`, date: "main", file: def.file, participantCount: n, completedParticipantCount: n });
    console.log(`  ${def.file}: ${n}명`);
  }

  // 리플레이 에셋 복사: Main 에피소드가 참조하는 맵 파일(dynamicState 포함)을
  // src/maps → analysis/dashboard/seeds/ 로 복사해야 대시보드의 trajectory replay가 동작함.
  const mapsRoot = path.resolve(__dirname, "src/maps");
  const seedsDir = path.resolve(__dirname, "../analysis/dashboard/seeds");
  const fileNames = new Set();
  for (const p of Object.values(pMap)) for (const ep of p.episodes) if (ep.fileName) fileNames.add(ep.fileName);
  let copied = 0, missing = 0;
  for (const f of fileNames) {
    const src = path.join(mapsRoot, f), dst = path.join(seedsDir, f);
    if (fs.existsSync(src)) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); copied++; }
    else { missing++; console.warn("  replay asset MISSING:", f); }
  }
  console.log(`리플레이 에셋 복사: ${copied}개 (누락 ${missing})`);

  // manifest 갱신: 기존 main-* 제거 후 앞에 붙이고, pilot들은 유지
  const manifestPath = path.join(dataDir, "manifest.json");
  let manifest = { generatedAt: "", timeZone: "Asia/Seoul", pilots: [] };
  if (fs.existsSync(manifestPath)) manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const pilotsOnly = (manifest.pilots || []).filter(p => !String(p.id).startsWith("main-"));
  manifest.pilots = [...mainEntries, ...pilotsOnly];
  manifest.generatedAt = new Date().toISOString();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`manifest 갱신 완료 (main 4개 + pilot ${pilotsOnly.length}개)`);
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
