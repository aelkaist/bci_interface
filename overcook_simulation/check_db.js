import { initializeApp } from "firebase/app";
import { getFirestore, collectionGroup, getDocs, collection } from "firebase/firestore";
import fs from "fs";

// Load env vars manually
const envFile = fs.readFileSync("/Users/donggunlee/Desktop/bci_interface/overcook_simulation/.env", "utf8");
const env = {};
envFile.split("\n").forEach(line => {
  const [key, ...value] = line.split("=");
  if (key) env[key.trim()] = value.join("=").trim();
});

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

async function checkData() {
  try {
    const sessionsGroup = collectionGroup(db, "experiment_sessions");
    const snapshot = await getDocs(sessionsGroup);
    
    // Extract unique prolificIds from the sessions path: participants/{pId}/experiment_sessions/{sId}
    const participantIds = new Set();
    snapshot.docs.forEach(doc => {
      // doc.ref.path -> participants/abc/experiment_sessions/xyz
      const parts = doc.ref.path.split("/");
      if (parts.length >= 2 && parts[0] === "participants") {
        participantIds.add(parts[1]);
      }
    });

    console.log(`Found ${participantIds.size} participants.`);
    
    let index = 1;
    for (const pId of Array.from(participantIds)) {
      console.log(`\n[${index++}] Participant ID: ${pId}`);
      
      // Check experiment_sessions
      const sessionsSnap = await getDocs(collection(db, `participants/${pId}/experiment_sessions`));
      console.log(`  - Sessions: ${sessionsSnap.docs.length} (Status: ${sessionsSnap.docs.map(s => s.data().status).join(", ")})`);

      // Check episodes
      const episodesSnap = await getDocs(collection(db, `participants/${pId}/episodes`));
      console.log(`  - Episodes completed: ${episodesSnap.docs.length}`);

      // Check post_surveys
      const surveysSnap = await getDocs(collection(db, `participants/${pId}/post_surveys`));
      console.log(`  - Post surveys: ${surveysSnap.docs.length}`);
    }
    
    process.exit(0);
  } catch (error) {
    console.error("Error fetching data:", error);
    process.exit(1);
  }
}

checkData();
