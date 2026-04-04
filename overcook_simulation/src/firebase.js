import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc } from "firebase/firestore";

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

export const saveFeedbackToFirestore = async (payload) => {
  try {
    // 1. 에피소드 고유 통계 데이터와 피드백 리스트를 분리
    const { feedbackDetails, ...episodeStats } = payload;
    
    // 2. Firestore 콘솔에서 한 눈에 파악하기 쉽도록 전체 데이터를 이쁘게 정렬된 문자열로도 저장
    const rawJsonView = JSON.stringify(payload, null, 2);

    // 3. 메인 문서(feedbacks 컬렉션)에는 에피소드 정보와 문자열 저장
    const mainDocRef = await addDoc(collection(db, "feedbacks"), {
      ...episodeStats,
      _rawJsonView: rawJsonView, // 이 필드를 펼치면 JSON 구조 그대로 볼 수 있음
      createdAt: new Date().toISOString()
    });

    // 4. 각각의 피드백 카드는 클릭하기 편하게 하위 컬렉션(Subcollection)으로 개별 문서화
    if (feedbackDetails && feedbackDetails.length > 0) {
      const detailsCollectionRef = collection(db, `feedbacks/${mainDocRef.id}/feedback_items`);
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
