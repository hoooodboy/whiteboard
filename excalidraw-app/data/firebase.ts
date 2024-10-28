import axios from "axios";
import {
  ExcalidrawElement,
  FileId,
} from "../../packages/excalidraw/element/types";
import { getSceneVersion } from "../../packages/excalidraw/element";
import Portal from "../collab/Portal";
import { restoreElements } from "../../packages/excalidraw/data/restore";
import {
  AppState,
  BinaryFileData,
  BinaryFileMetadata,
  DataURL,
} from "../../packages/excalidraw/types";
import { FILE_CACHE_MAX_AGE_SEC } from "../app_constants";
import { decompressData } from "../../packages/excalidraw/data/encode";
import {
  encryptData,
  decryptData,
} from "../../packages/excalidraw/data/encryption";
import { MIME_TYPES } from "../../packages/excalidraw/constants";
import { reconcileElements } from "../collab/reconciliation";
import { getSyncableElements, SyncableExcalidrawElement } from ".";
import { ResolutionType } from "../../packages/excalidraw/utility-types";
import type { Socket } from "socket.io-client";
import { Scene } from "./types";
import { fromBase64, toBase64 } from "@smithy/util-base64";

// private
// -----------------------------------------------------------------------------

let FIREBASE_CONFIG: Record<string, any>;
try {
  FIREBASE_CONFIG = JSON.parse(import.meta.env.VITE_APP_FIREBASE_CONFIG);
} catch (error: any) {
  console.warn(
    `Error JSON parsing firebase config. Supplied value: ${
      import.meta.env.VITE_APP_FIREBASE_CONFIG
    }`,
  );
  FIREBASE_CONFIG = {};
}

let firebasePromise: Promise<typeof import("firebase/app").default> | null =
  null;
let firestorePromise: Promise<any> | null | true = null;
let firebaseStoragePromise: Promise<any> | null | true = null;

let isFirebaseInitialized = false;

const _loadFirebase = async () => {
  const firebase = (
    await import(/* webpackChunkName: "firebase" */ "firebase/app")
  ).default;

  if (!isFirebaseInitialized) {
    try {
      firebase.initializeApp(FIREBASE_CONFIG);
    } catch (error: any) {
      // trying initialize again throws. Usually this is harmless, and happens
      // mainly in dev (HMR)
      if (error.code === "app/duplicate-app") {
        console.warn(error.name, error.code);
      } else {
        throw error;
      }
    }
    isFirebaseInitialized = true;
  }

  return firebase;
};

const _getFirebase = async (): Promise<
  typeof import("firebase/app").default
> => {
  if (!firebasePromise) {
    firebasePromise = _loadFirebase();
  }
  return firebasePromise;
};

// -----------------------------------------------------------------------------

const loadFirestore = async () => {
  const firebase = await _getFirebase();
  if (!firestorePromise) {
    firestorePromise = import(
      /* webpackChunkName: "firestore" */ "firebase/firestore"
    );
  }
  if (firestorePromise !== true) {
    await firestorePromise;
    firestorePromise = true;
  }
  return firebase;
};

export const loadFirebaseStorage = async () => {
  const firebase = await _getFirebase();
  if (!firebaseStoragePromise) {
    firebaseStoragePromise = import(
      /* webpackChunkName: "storage" */ "firebase/storage"
    );
  }
  if (firebaseStoragePromise !== true) {
    await firebaseStoragePromise;
    firebaseStoragePromise = true;
  }
  return firebase;
};

interface FirebaseStoredScene {
  sceneVersion: number;
  iv: firebase.default.firestore.Blob;
  ciphertext: firebase.default.firestore.Blob;
}

interface FirebaseStoredSlide {
  slideVersion: number;
  iv: string;
  ciphertext: string;
}

const encryptElements = async (
  key: string,
  elements: readonly ExcalidrawElement[],
): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array }> => {
  const json = JSON.stringify(elements);
  const encoded = new TextEncoder().encode(json);
  const { encryptedBuffer, iv } = await encryptData(key, encoded);

  return { ciphertext: encryptedBuffer, iv };
};

const decryptElements = async (
  data: FirebaseStoredScene,
  roomKey: string,
): Promise<readonly ExcalidrawElement[]> => {
  const ciphertext = data.ciphertext.toUint8Array();
  const iv = data.iv.toUint8Array();

  const decrypted = await decryptData(iv, ciphertext, roomKey);
  const decodedData = new TextDecoder("utf-8").decode(
    new Uint8Array(decrypted),
  );
  return JSON.parse(decodedData);
};

class FirebaseSceneVersionCache {
  private static cache = new WeakMap<Socket, number>();
  static get = (socket: Socket) => {
    return FirebaseSceneVersionCache.cache.get(socket);
  };
  static set = (
    socket: Socket,
    elements: readonly SyncableExcalidrawElement[],
  ) => {
    FirebaseSceneVersionCache.cache.set(socket, getSceneVersion(elements));
  };
}

export const isSavedToFirebase = (
  portal: Portal,
  elements: readonly ExcalidrawElement[],
): boolean => {
  if (portal.socket && portal.roomId && portal.roomKey) {
    const sceneVersion = getSceneVersion(elements);

    return FirebaseSceneVersionCache.get(portal.socket) === sceneVersion;
  }
  // if no room exists, consider the room saved so that we don't unnecessarily
  // prevent unload (there's nothing we could do at that point anyway)
  return true;
};

export const saveFilesToFirebase = async ({
  prefix,
  files,
}: {
  prefix: string;
  files: { id: FileId; buffer: Uint8Array }[];
}) => {
  const firebase = await loadFirebaseStorage();

  const erroredFiles = new Map<FileId, true>();
  const savedFiles = new Map<FileId, true>();

  await Promise.all(
    files.map(async ({ id, buffer }) => {
      try {
        await firebase
          .storage()
          .ref(`${prefix}/${id}`)
          .put(
            new Blob([buffer], {
              type: MIME_TYPES.binary,
            }),
            {
              cacheControl: `public, max-age=${FILE_CACHE_MAX_AGE_SEC}`,
            },
          );
        savedFiles.set(id, true);
      } catch (error: any) {
        erroredFiles.set(id, true);
      }
    }),
  );

  return { savedFiles, erroredFiles };
};

const createFirebaseSceneDocument = async (
  firebase: ResolutionType<typeof loadFirestore>,
  elements: readonly SyncableExcalidrawElement[],
  roomKey: string,
) => {
  const sceneVersion = getSceneVersion(elements);
  const { ciphertext, iv } = await encryptElements(roomKey, elements);
  return {
    sceneVersion,
    ciphertext: firebase.firestore.Blob.fromUint8Array(
      new Uint8Array(ciphertext),
    ),
    iv: firebase.firestore.Blob.fromUint8Array(iv),
  } as FirebaseStoredScene;
};

/**
 * 파이어베이스에 씬 저장하는 함수(동기체크해서 필요한것만 저장)
 * @param portal
 * @param elements
 * @param appState
 * @returns
 */
export const saveToFirebase = async (
  portal: Portal,
  elements: readonly SyncableExcalidrawElement[],
  appState: AppState,
) => {
  const { roomId, roomKey, socket } = portal;
  if (
    // bail if no room exists as there's nothing we can do at this point
    !roomId ||
    !roomKey ||
    !socket ||
    isSavedToFirebase(portal, elements)
  ) {
    return false;
  }

  const firebase = await loadFirestore();
  const firestore = firebase.firestore();

  const docRef = firestore.collection("scenes").doc(roomId);

  const savedData = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(docRef);

    if (!snapshot.exists) {
      const sceneDocument = await createFirebaseSceneDocument(
        firebase,
        elements,
        roomKey,
      );

      transaction.set(docRef, sceneDocument);

      return {
        elements,
        reconciledElements: null,
      };
    }

    const prevDocData = snapshot.data() as FirebaseStoredScene;
    const prevElements = getSyncableElements(
      await decryptElements(prevDocData, roomKey),
    );

    const reconciledElements = getSyncableElements(
      reconcileElements(elements, prevElements, appState),
    );

    const sceneDocument = await createFirebaseSceneDocument(
      firebase,
      reconciledElements,
      roomKey,
    );

    transaction.update(docRef, sceneDocument);
    return {
      elements,
      reconciledElements,
    };
  });

  FirebaseSceneVersionCache.set(socket, savedData.elements);

  return { reconciledElements: savedData.reconciledElements };
};

/**
 * 파이어베이스에 씬 저장하는 함수, elements 값 그대로 저장하게 함
 * Add by dotree
 * @param portal
 * @param elements
 * @param appState
 * @returns
 */
export const saveToFirebaseNotSync = async (
  portal: Portal,
  elements: readonly SyncableExcalidrawElement[],
  appState: AppState,
) => {
  const { roomId, roomKey, socket } = portal;
  if (
    // bail if no room exists as there's nothing we can do at this point
    !roomId ||
    !roomKey ||
    !socket ||
    isSavedToFirebase(portal, elements)
  ) {
    return false;
  }

  const firebase = await loadFirestore();
  const firestore = firebase.firestore();

  const docRef = firestore.collection("scenes").doc(roomId);

  const savedData = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(docRef);

    if (!snapshot.exists) {
      const sceneDocument = await createFirebaseSceneDocument(
        firebase,
        elements,
        roomKey,
      );

      transaction.set(docRef, sceneDocument);

      return {
        elements,
        reconciledElements: null,
      };
    }

    const sceneDocument = await createFirebaseSceneDocument(
      firebase,
      elements,
      roomKey,
    );

    transaction.update(docRef, sceneDocument);
    return {
      elements,
    };
  });

  FirebaseSceneVersionCache.set(socket, savedData.elements);

  return { reconciledElements: savedData.reconciledElements };
};

export const loadFromFirebase = async (
  roomId: string,
  roomKey: string,
  socket: Socket | null,
): Promise<readonly ExcalidrawElement[] | null> => {
  const firebase = await loadFirestore();
  const db = firebase.firestore();

  const docRef = db.collection("scenes").doc(roomId);
  const doc = await docRef.get();
  if (!doc.exists) {
    return null;
  }
  const storedScene = doc.data() as FirebaseStoredScene;
  const elements = getSyncableElements(
    await decryptElements(storedScene, roomKey),
  );

  if (socket) {
    FirebaseSceneVersionCache.set(socket, elements);
  }

  return restoreElements(elements, null);
};

export const loadFilesFromFirebase = async (
  prefix: string,
  decryptionKey: string,
  filesIds: readonly FileId[],
) => {
  const loadedFiles: BinaryFileData[] = [];
  const erroredFiles = new Map<FileId, true>();

  await Promise.all(
    [...new Set(filesIds)].map(async (id) => {
      try {
        const url = `https://firebasestorage.googleapis.com/v0/b/${
          FIREBASE_CONFIG.storageBucket
        }/o/${encodeURIComponent(prefix.replace(/^\//, ""))}%2F${id}`;
        const response = await fetch(`${url}?alt=media`);
        if (response.status < 400) {
          const arrayBuffer = await response.arrayBuffer();

          const { data, metadata } = await decompressData<BinaryFileMetadata>(
            new Uint8Array(arrayBuffer),
            {
              decryptionKey,
            },
          );

          const dataURL = new TextDecoder().decode(data) as DataURL;

          loadedFiles.push({
            mimeType: metadata.mimeType || MIME_TYPES.binary,
            id,
            dataURL,
            created: metadata?.created || Date.now(),
            lastRetrieved: metadata?.created || Date.now(),
          });
        } else {
          erroredFiles.set(id, true);
        }
      } catch (error: any) {
        erroredFiles.set(id, true);
        console.error(error);
      }
    }),
  );

  return { loadedFiles, erroredFiles };
};

// 아래 부터는 슬라이드용 파이어베이스 코드
const encryptSlides = async (
  key: string,
  slides: readonly Scene[],
  fileIds: readonly FileId[],
  currentSceneId: string,
): Promise<{ ciphertext: string; iv: string }> => {
  const json = JSON.stringify({
    slides,
    fileIds,
    currentSceneId,
  });
  const encoded = new TextEncoder().encode(json);
  const { encryptedBuffer, iv } = await encryptData(key, encoded);

  return {
    ciphertext: toBase64(new Uint8Array(encryptedBuffer)),
    iv: toBase64(iv),
  };
};

const decryptSlides = async (
  data: FirebaseStoredSlide,
  roomKey: string,
): Promise<{
  slides: Scene[];
  fileIds: readonly FileId[];
  currentSceneId: string;
}> => {
  const ciphertext = fromBase64(data.ciphertext);
  const iv = fromBase64(data.iv);

  const decrypted = await decryptData(iv, ciphertext, roomKey);
  const decodedData = new TextDecoder("utf-8").decode(
    new Uint8Array(decrypted),
  );
  return JSON.parse(decodedData);
};

const createFirebaseSlideDocument = async (
  slides: readonly Scene[],
  fileIds: readonly FileId[],
  currentSceneId: string,
  roomKey: string,
) => {
  const { ciphertext, iv } = await encryptSlides(
    roomKey,
    slides,
    fileIds,
    currentSceneId,
  );
  const version: number = 1;
  return {
    version,
    ciphertext,
    iv,
  } as unknown as FirebaseStoredSlide;
};

/**
 * 파이어베이스에 슬라이드 저장하는 함수(동기체크해서 필요한것만 저장)
 * @param portal
 * @param elements
 * @param appState
 * @returns
 */
// const _saveSlideToFirebase = async (
//   portal: Portal,
//   slides: readonly Scene[],
//   fileIds: readonly FileId[],
//   currentSceneId: string,
// ) => {
//   const { roomId, roomKey, socket } = portal;
//   if (
//     // bail if no room exists as there's nothing we can do at this point
//     !roomId ||
//     !roomKey ||
//     !socket
//   ) {
//     return false;
//   }

//   const firebase = await loadFirestore();
//   const firestore = firebase.firestore();

//   const docRef = firestore.collection("slides").doc(roomId);

//   const savedData = await firestore.runTransaction(async (transaction) => {
//     const snapshot = await transaction.get(docRef);

//     if (!snapshot.exists) {
//       const sceneDocument = await createFirebaseSlideDocument(
//         firebase,
//         slides,
//         fileIds,
//         currentSceneId,
//         roomKey,
//       );

//       transaction.set(docRef, sceneDocument);

//       return {
//         slides,
//         fileIds,
//         currentSceneId,
//       };
//     }

//     const slideDocument = await createFirebaseSlideDocument(
//       firebase,
//       slides,
//       fileIds,
//       currentSceneId,
//       roomKey,
//     );

//     transaction.update(docRef, slideDocument);
//     return {
//       slides,
//       fileIds,
//     };
//   });

//   return { slides: savedData.slides, fileIds: savedData.fileIds };
// };

const loadDocForMongo = async (collection: string, docId: string) => {
  const response = await axios.get(
    `${
      import.meta.env.VITE_APP_DOCUMENT_SERVER_URL
    }/api/${collection}/single?id=${docId}`,
  );

  const doc =
    response.status === 200
      ? Object.keys(response.data).length > 0 && response.data.id
        ? JSON.parse(response.data.data)
        : null
      : null;

  return { exists: doc !== null, data: doc };
};

const saveDocForMongo = async (
  collection: string,
  docId: string,
  data: any,
) => {
  const response = await axios.post(
    `${import.meta.env.VITE_APP_DOCUMENT_SERVER_URL}/api/${collection}/create`,
    {
      id: docId,
      data: JSON.stringify(data),
    },
  );

  return response.status === 200;
};

/**
 * 파이어베이스에 슬라이드 저장하는 함수(동기체크해서 필요한것만 저장)
 * @param portal
 * @param elements
 * @param appState
 * @returns
 */
const _saveSlideForMongo = async (
  portal: Portal,
  slides: readonly Scene[],
  fileIds: readonly FileId[],
  currentSceneId: string,
) => {
  const { roomId, roomKey, socket } = portal;
  if (
    // bail if no room exists as there's nothing we can do at this point
    !roomId ||
    !roomKey ||
    !socket
  ) {
    return false;
  }

  const sceneDocument = await createFirebaseSlideDocument(
    slides,
    fileIds,
    currentSceneId,
    roomKey,
  );

  await saveDocForMongo("slides", roomId, sceneDocument);

  return {
    slides,
    fileIds,
  };
};

export const saveSlideToFirebase = _saveSlideForMongo;

const _loadSlideForMongo = async (
  roomId: string,
  roomKey: string,
  socket: Socket | null,
): Promise<{
  slides: Scene[];
  fileIds: readonly FileId[];
  currentSceneId: string;
} | null> => {
  const doc = await loadDocForMongo("slides", roomId);

  if (!doc) {
    return null;
  }

  const storedSlide = doc.data as FirebaseStoredSlide;
  if (!storedSlide) {
    return null;
  }
  const { slides, fileIds, currentSceneId } = await decryptSlides(
    storedSlide,
    roomKey,
  );

  return { slides, fileIds, currentSceneId };
};

// const _loadSlideFromFirebase = async (
//   roomId: string,
//   roomKey: string,
//   socket: Socket | null,
// ): Promise<{
//   slides: Scene[];
//   fileIds: readonly FileId[];
//   currentSceneId: string;
// } | null> => {
//   const firebase = await loadFirestore();
//   const db = firebase.firestore();

//   const docRef = db.collection("slides").doc(roomId);
//   const doc = await docRef.get();
//   if (!doc.exists) {
//     return null;
//   }
//   const storedSlide = doc.data() as FirebaseStoredSlide;
//   const { slides, fileIds, currentSceneId } = await decryptSlides(
//     storedSlide,
//     roomKey,
//   );

//   return { slides, fileIds, currentSceneId };
// };

export const loadSlideFromFirebase = _loadSlideForMongo;
