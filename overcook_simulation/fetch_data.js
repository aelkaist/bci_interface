import { initializeApp } from "firebase/app";
import { getFirestore, collectionGroup, getDocs, collection } from "firebase/firestore";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Prefer local Vite settings, then fall back to the shared .env file.
const envPaths = [
  path.resolve(__dirname, ".env.local"),
  path.resolve(__dirname, ".env"),
];
const envPath = envPaths.find(candidate => fs.existsSync(candidate));
let env = {};
if (envPath) {
  const envFile = fs.readFileSync(envPath, "utf8");
  envFile.split("\n").forEach(line => {
    const [key, ...value] = line.split("=");
    if (key) env[key.trim()] = value.join("=").trim();
  });
} else {
  console.error("Could not find .env.local or .env in", __dirname);
  process.exit(1);
}

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function fetchAllData() {
  console.log("Fetching data from Firebase...");
  const sessionsSnap = await getDocs(collectionGroup(db, 'experiment_sessions'));
  const participantMap = {};

  for (const doc of sessionsSnap.docs) {
    const parts = doc.ref.path.split('/');
    if (parts[0] !== 'participants') continue;
    const pId = parts[1];
    if (!participantMap[pId]) participantMap[pId] = { id: pId, sessions: [], episodes: [], feedbackItems: [], postSurveys: [] };
    participantMap[pId].sessions.push({ docId: doc.id, ...doc.data() });
  }

  for (const pId of Object.keys(participantMap)) {
    const epSnap = await getDocs(collection(db, `participants/${pId}/episodes`));
    for (const epDoc of epSnap.docs) {
      const ep = { docId: epDoc.id, ...epDoc.data(), feedbackItems: [] };
      const itemsSnap = await getDocs(collection(db, `participants/${pId}/episodes/${epDoc.id}/feedback_items`));
      for (const it of itemsSnap.docs) ep.feedbackItems.push({ docId: it.id, ...it.data() });
      participantMap[pId].episodes.push(ep);
      participantMap[pId].feedbackItems.push(...ep.feedbackItems);
    }
    participantMap[pId].episodes.sort((a, b) => (a.episodeCount || 0) - (b.episodeCount || 0));

    const surveySnap = await getDocs(collection(db, `participants/${pId}/post_surveys`));
    for (const sDoc of surveySnap.docs) {
      participantMap[pId].postSurveys.push({ docId: sDoc.id, ...sDoc.data() });
    }
  }

  const outPath = path.resolve(__dirname, "../analysis/dashboard/data.json");
  fs.writeFileSync(outPath, JSON.stringify(participantMap, null, 2));
  console.log(`Saved ${Object.keys(participantMap).length} participants to ${outPath}`);
  process.exit(0);
}

fetchAllData().catch(err => {
  console.error(err);
  process.exit(1);
});
