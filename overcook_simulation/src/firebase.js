import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  setDoc,
  writeBatch,
  runTransaction,
  query,
  where,
  orderBy,
  limit,
  updateDoc,
  getDoc,
} from "firebase/firestore";

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

// ── 참가자 배정 시스템 ──

/**
 * Transaction으로 hasStarted=false인 첫 번째 assignment를 원자적으로 배정합니다.
 * 모든 assignment가 hasStarted=true이면, hasFinished=false인 행들을 리셋 후 재시도합니다.
 *
 * @param {string} prolificId - 참가자 ID
 * @returns {Promise<Object>} 배정된 assignment 데이터 (assignmentId, group, maps, mapGroup 포함)
 */
export const claimAssignment = async (prolificId) => {
  if (!prolificId) throw new Error("prolificId is required");

  const assignmentsCol = collection(db, "assignments");

  // 1단계: hasStarted=false인 첫 번째 assignment 찾기
  const availableQuery = query(
    assignmentsCol,
    where("hasStarted", "==", false),
    orderBy("order", "asc"),
    limit(1)
  );

  const availableSnap = await getDocs(availableQuery);

  if (!availableSnap.empty) {
    // 사용 가능한 assignment가 있으면 Transaction으로 배정
    const targetDoc = availableSnap.docs[0];
    const targetRef = doc(db, "assignments", targetDoc.id);

    const result = await runTransaction(db, async (transaction) => {
      const freshDoc = await transaction.get(targetRef);
      if (!freshDoc.exists()) {
        throw new Error("Assignment document not found");
      }

      const data = freshDoc.data();

      // Transaction 시작 사이에 다른 참가자가 이미 가져갔으면 실패 → 자동 재시도
      if (data.hasStarted === true) {
        throw new Error("Assignment already claimed (will retry)");
      }

      transaction.update(targetRef, {
        hasStarted: true,
        assignedTo: prolificId,
        assignedAt: new Date().toISOString(),
      });

      return {
        assignmentId: freshDoc.id,
        ...data,
        hasStarted: true,
        assignedTo: prolificId,
      };
    });

    console.log(`✅ Assignment claimed: ${result.assignmentId} → ${prolificId}`);
    return result;
  }

  // 2단계: 사용 가능한 assignment가 없으면 그냥 실패 처리.
  // (자동 큐 리셋은 실험 중인 활성 참가자까지 detach시키는 문제가 있어 제거함.
  //  이탈자로 슬롯이 소진된 경우, 대시보드나 reset_db.js로 "수동" 회수만 합니다.)
  console.log("⚠️ No available assignments. (auto-reset disabled)");
  throw new Error("No available assignment slots at the moment. Please contact the researcher.");
};

/**
 * 실험 완료 시 해당 assignment의 hasFinished를 true로 변경합니다.
 *
 * @param {string} assignmentId - assignment document ID (예: "L001")
 */
export const completeAssignment = async (assignmentId) => {
  if (!assignmentId) throw new Error("assignmentId is required");

  const assignmentRef = doc(db, "assignments", assignmentId);
  await updateDoc(assignmentRef, {
    hasFinished: true,
    completedAt: new Date().toISOString(),
  });

  console.log(`✅ Assignment completed: ${assignmentId}`);
};

/**
 * 참가자 이탈 시 assignment를 다시 큐에 되돌립니다. (선택적 사용)
 *
 * @param {string} assignmentId - assignment document ID
 */
export const releaseAssignment = async (assignmentId) => {
  if (!assignmentId) throw new Error("assignmentId is required");

  const assignmentRef = doc(db, "assignments", assignmentId);
  const snap = await getDoc(assignmentRef);

  if (!snap.exists()) return;

  const data = snap.data();
  // 이미 완료된 assignment는 릴리즈하지 않음
  if (data.hasFinished) return;

  await updateDoc(assignmentRef, {
    hasStarted: false,
    assignedTo: null,
    assignedAt: null,
  });

  console.log(`🔄 Assignment released: ${assignmentId}`);
};
