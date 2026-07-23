import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, getDocs, setDoc, writeBatch } from "firebase/firestore";

// .env 파일에 정의된 환경 변수 사용
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// ── 모든 데이터는 participants/{prolificId}/ 하위에 저장 ──

export const saveFeedbackToFirestore = async (payload) => {
  try {
    const { prolificId, feedbackDetails, episodeCount, ...episodeStats } = payload;
    if (!prolificId) throw new Error("prolificId is required");

    const episodeId = `episode_${episodeCount}`;

    // participants/{prolificId}/episodes/episode_N
    const episodeRef = doc(db, `participants/${prolificId}/episodes`, episodeId);
    await setDoc(episodeRef, {
      ...episodeStats,
      episodeCount,
      createdAt: new Date().toISOString()
    });

    // Keep this subcollection in sync so revisiting an episode never creates duplicates.
    const itemsCol = collection(db, `participants/${prolificId}/episodes/${episodeId}/feedback_items`);
    const existingItems = await getDocs(itemsCol);
    const currentItemIds = new Set((feedbackDetails || []).map((detail) => detail.feedbackId));
    const batch = writeBatch(db);

    existingItems.forEach((itemDoc) => {
      if (!currentItemIds.has(itemDoc.id)) batch.delete(itemDoc.ref);
    });

    (feedbackDetails || []).forEach((detail, index) => {
      const { feedbackId, ...feedbackData } = detail;
      if (!feedbackId) throw new Error("feedbackId is required");
      const itemRef = doc(itemsCol, feedbackId);
      batch.set(itemRef, {
        index: index + 1,
        ...feedbackData,
        updatedAt: new Date().toISOString()
      });
    });

    await batch.commit();

    console.log("Episode saved:", episodeId);
    return episodeId;
  } catch (e) {
    console.error("Error saving episode: ", e);
    throw e;
  }
};


export const savePostSurveyToFirestore = async (prolificId, sessionId, surveyPayload) => {
  try {
    if (!prolificId) throw new Error("prolificId is required");

    // participants/{prolificId}/post_surveys/{sessionId}
    const surveyRef = doc(db, `participants/${prolificId}/post_surveys`, sessionId);
    await setDoc(
      surveyRef,
      {
        ...surveyPayload,
        createdAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return sessionId;
  } catch (e) {
    console.error("Error saving post survey: ", e);
    throw e;
  }
};

export const upsertExperimentSessionToFirestore = async (prolificId, sessionId, payload) => {
  try {
    if (!prolificId) throw new Error("prolificId is required");

    // participants/{prolificId}/experiment_sessions/{sessionId}
    const sessionRef = doc(db, `participants/${prolificId}/experiment_sessions`, sessionId);
    await setDoc(
      sessionRef,
      {
        ...payload,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return sessionId;
  } catch (e) {
    console.error("Error upserting experiment session: ", e);
    throw e;
  }
};
