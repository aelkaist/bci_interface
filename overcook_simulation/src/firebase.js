import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, doc, setDoc } from "firebase/firestore";

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
    const { prolificId, feedbackDetails, ...episodeStats } = payload;
    if (!prolificId) throw new Error("prolificId is required");

    const rawJsonView = JSON.stringify(payload, null, 2);

    // participants/{prolificId}/feedbacks/{docId}
    const feedbacksCol = collection(db, `participants/${prolificId}/feedbacks`);
    const mainDocRef = await addDoc(feedbacksCol, {
      ...episodeStats,
      prolificId,
      _rawJsonView: rawJsonView,
      createdAt: new Date().toISOString()
    });

    // participants/{prolificId}/feedbacks/{docId}/feedback_items/{itemId}
    if (feedbackDetails && feedbackDetails.length > 0) {
      const detailsCollectionRef = collection(
        db,
        `participants/${prolificId}/feedbacks/${mainDocRef.id}/feedback_items`
      );
      for (const [index, detail] of feedbackDetails.entries()) {
        await addDoc(detailsCollectionRef, {
          index: index + 1,
          ...detail,
          createdAt: new Date().toISOString()
        });
      }
    }

    console.log("Document written with ID: ", mainDocRef.id);
    return mainDocRef.id;
  } catch (e) {
    console.error("Error adding document: ", e);
    throw e;
  }
};

export const saveEpisodeSurveyToFirestore = async (payload) => {
  try {
    const { prolificId, ...rest } = payload;
    if (!prolificId) throw new Error("prolificId is required");

    // participants/{prolificId}/episode_surveys/{docId}
    const surveysCol = collection(db, `participants/${prolificId}/episode_surveys`);
    const docRef = await addDoc(surveysCol, {
      ...rest,
      prolificId,
      createdAt: new Date().toISOString(),
    });
    return docRef.id;
  } catch (e) {
    console.error("Error saving episode survey: ", e);
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
        prolificId,
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
        prolificId,
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
