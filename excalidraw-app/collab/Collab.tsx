import { atom } from "jotai";
// import { generate as generateKoreanName } from "korean-name-generator";
import throttle from "lodash.throttle";
import { PureComponent } from "react";
import { ErrorDialog } from "../../packages/excalidraw/components/ErrorDialog";
import {
  ACTIVE_THRESHOLD,
  APP_NAME,
  ENV,
  EVENT,
  IDLE_THRESHOLD,
} from "../../packages/excalidraw/constants";
import { decryptData } from "../../packages/excalidraw/data/encryption";
import { ImportedDataState } from "../../packages/excalidraw/data/types";
import { getVisibleSceneBounds } from "../../packages/excalidraw/element/bounds";
import { newElementWith } from "../../packages/excalidraw/element/mutateElement";
import {
  isImageElement,
  isInitializedImageElement,
} from "../../packages/excalidraw/element/typeChecks";
import {
  ExcalidrawElement,
  FileId,
  InitializedExcalidrawImageElement,
} from "../../packages/excalidraw/element/types";
import { AbortError } from "../../packages/excalidraw/errors";
import { t } from "../../packages/excalidraw/i18n";
import {
  getCommonBounds,
  getSceneVersion,
  restoreElements,
  zoomToFitBounds,
} from "../../packages/excalidraw/index";
import { withBatchedUpdates } from "../../packages/excalidraw/reactUtils";
import {
  Collaborator,
  ExcalidrawImperativeAPI,
  Gesture,
  OnUserFollowedPayload,
  SocketId,
  UserIdleState,
} from "../../packages/excalidraw/types";
import { Mutable, ValueOf } from "../../packages/excalidraw/utility-types";
import {
  assertNever,
  preventUnload,
  resolvablePromise,
  throttleRAF,
} from "../../packages/excalidraw/utils";
import { appJotaiStore } from "../app-jotai";
import {
  CURSOR_SYNC_TIMEOUT,
  FILE_UPLOAD_MAX_BYTES,
  FIREBASE_STORAGE_PREFIXES,
  INITIAL_SCENE_UPDATE_TIMEOUT,
  LOAD_IMAGES_TIMEOUT,
  SYNC_FULL_SCENE_INTERVAL_MS,
  SYNC_SLIDE_INTERVAL_MS,
  WS_EVENTS,
  WS_SUBTYPES,
} from "../app_constants";
import {
  SocketUpdateDataSource,
  SyncableExcalidrawElement,
  generateCollaborationLinkData,
  getCollaborationLink,
  getSyncableElements,
} from "../data";
import {
  FileManager,
  encodeFilesForUpload,
  updateStaleImageStatuses,
} from "../data/FileManager";
import loaderSingleton from "../data/LoaderSingleton";
import { LocalData } from "../data/LocalData";
import {
  currentIndexAtom,
  currentSceneIdAtom,
  roomStatusAtom,
  slideAtom,
  socketAtom,
  socketLockAtom,
} from "../data/atoms";
import {
  isSavedToFirebase,
  loadFilesFromFirebase,
  // loadSlideFromFirebase,
  saveFilesToFirebase,
  saveSlideToFirebase,
} from "../data/firebase";
import {
  importUsernameFromLocalStorage,
  saveUsernameToLocalStorage,
} from "../data/localStorage";
import recorderRef from "../data/recorder";
import slideRef from "../data/slide";
import userRef from "../data/user";
import { resetBrowserStateVersions } from "../data/tabSync";
import { RoomData, RoomStatus, RoomUser, Scene } from "../data/types";
import { isLoadingAtom, loadingUIAtom } from "../loading/atom";
import Portal from "./Portal";
import {
  ReconciledElements,
  reconcileElements as _reconcileElements,
} from "./reconciliation";

export const collabAPIAtom = atom<CollabAPI | null>(null);
export const isCollaboratingAtom = atom(false);
export const isOfflineAtom = atom(false);

interface CollabState {
  errorMessage: string | null;
  username: string;
  activeRoomLink: string | null;
}

export const activeRoomLinkAtom = atom<string | null>(null);

type CollabInstance = InstanceType<typeof Collab>;

export interface CollabAPI {
  /** function so that we can access the latest value from stale callbacks */
  isCollaborating: () => boolean;
  onPointerUpdate: CollabInstance["onPointerUpdate"];
  startSocket: CollabInstance["startSocket"];
  isConnectedSocket: CollabInstance["isConnectedSocket"];
  startCollaboration: CollabInstance["startCollaboration"];
  stopCollaboration: CollabInstance["stopCollaboration"];
  syncElements: CollabInstance["syncElements"];
  syncElementsWithReset: CollabInstance["syncElementsWithReset"];
  syncSlide: CollabInstance["syncSlide"];
  syncSlideWithWait: CollabInstance["syncSlideWithWait"];
  broadcastStartRecording: CollabInstance["broadcastStartRecording"];
  broadcastStopRecording: CollabInstance["broadcastStopRecording"];
  broadcastSlideWaiting: CollabInstance["broadcastSlideWaiting"];
  broadcastSlideCanceled: CollabInstance["broadcastSlideCanceled"];
  broadcastSceneDeleted: CollabInstance["broadcastSceneDeleted"];
  getCurrentSceneId: CollabInstance["getCurrentSceneId"];
  getFileManager: CollabInstance["getFileManager"];
  fetchImageFilesFromFirebase: CollabInstance["fetchImageFilesFromFirebase"];
  setUsername: CollabInstance["setUsername"];
  getUsername: CollabInstance["getUsername"];
  getPortal: CollabInstance["getPortal"];
  getActiveRoomLink: CollabInstance["getActiveRoomLink"];
  setErrorMessage: CollabInstance["setErrorMessage"];
  followUser: CollabInstance["followUser"];
  closeRoom: CollabInstance["closeRoom"];
}

interface CollabProps {
  excalidrawAPI: ExcalidrawImperativeAPI;
}

class Collab extends PureComponent<CollabProps, CollabState> {
  portal: Portal;
  fileManager: FileManager;
  excalidrawAPI: CollabProps["excalidrawAPI"];
  activeIntervalId: number | null;
  idleTimeoutId: number | null;

  private socketInitializationTimer?: number;
  private lastBroadcastedOrReceivedSceneVersion: number = -1;
  private collaborators = new Map<SocketId, Collaborator>();

  constructor(props: CollabProps) {
    super(props);
    this.state = {
      errorMessage: null,
      username: importUsernameFromLocalStorage() || "",
      activeRoomLink: null,
    };
    this.portal = new Portal(this);
    this.fileManager = new FileManager({
      getFiles: async (fileIds) => {
        const { roomId, roomKey } = this.portal;
        if (!roomId || !roomKey) {
          throw new AbortError();
        }

        return loadFilesFromFirebase(`files/rooms/${roomId}`, roomKey, fileIds);
      },
      saveFiles: async ({ addedFiles }) => {
        const { roomId, roomKey } = this.portal;
        if (!roomId || !roomKey) {
          throw new AbortError();
        }

        return saveFilesToFirebase({
          prefix: `${FIREBASE_STORAGE_PREFIXES.collabFiles}/${roomId}`,
          files: await encodeFilesForUpload({
            files: addedFiles,
            encryptionKey: roomKey,
            maxBytes: FILE_UPLOAD_MAX_BYTES,
          }),
        });
      },
    });
    this.excalidrawAPI = props.excalidrawAPI;
    this.activeIntervalId = null;
    this.idleTimeoutId = null;
  }

  private onUmmount: (() => void) | null = null;

  componentDidMount() {
    window.addEventListener(EVENT.BEFORE_UNLOAD, this.beforeUnload);
    window.addEventListener("online", this.onOfflineStatusToggle);
    window.addEventListener("offline", this.onOfflineStatusToggle);
    window.addEventListener(EVENT.UNLOAD, this.onUnload);

    const unsubOnUserFollow = this.excalidrawAPI.onUserFollow((payload) => {
      this.portal.socket && this.portal.broadcastUserFollowed(payload);
    });
    const throttledRelayUserViewportBounds = throttleRAF(
      this.relayVisibleSceneBounds,
    );
    const unsubOnScrollChange = this.excalidrawAPI.onScrollChange(() =>
      throttledRelayUserViewportBounds(),
    );
    this.onUmmount = () => {
      unsubOnUserFollow();
      unsubOnScrollChange();
    };

    this.onOfflineStatusToggle();

    const collabAPI: CollabAPI = {
      isCollaborating: this.isCollaborating,
      onPointerUpdate: this.onPointerUpdate,
      startSocket: this.startSocket,
      isConnectedSocket: this.isConnectedSocket,
      startCollaboration: this.startCollaboration,
      syncElements: this.syncElements,
      syncElementsWithReset: this.syncElementsWithReset,
      syncSlide: this.syncSlide,
      syncSlideWithWait: this.syncSlideWithWait,
      broadcastStartRecording: this.broadcastStartRecording,
      broadcastStopRecording: this.broadcastStopRecording,
      broadcastSlideWaiting: this.broadcastSlideWaiting,
      broadcastSlideCanceled: this.broadcastSlideCanceled,
      broadcastSceneDeleted: this.broadcastSceneDeleted,
      getFileManager: this.getFileManager,
      fetchImageFilesFromFirebase: this.fetchImageFilesFromFirebase,
      stopCollaboration: this.stopCollaboration,
      getCurrentSceneId: this.getCurrentSceneId,
      setUsername: this.setUsername,
      getUsername: this.getUsername,
      getPortal: this.getPortal,
      getActiveRoomLink: this.getActiveRoomLink,
      setErrorMessage: this.setErrorMessage,
      followUser: this.followUser,
      closeRoom: this.closeRoom,
    };

    appJotaiStore.set(collabAPIAtom, collabAPI);

    if (import.meta.env.MODE === ENV.TEST || import.meta.env.DEV) {
      window.collab = window.collab || ({} as Window["collab"]);
      Object.defineProperties(window, {
        collab: {
          configurable: true,
          value: this,
        },
      });
    }
  }

  onOfflineStatusToggle = () => {
    appJotaiStore.set(isOfflineAtom, !window.navigator.onLine);
  };

  componentWillUnmount() {
    window.removeEventListener("online", this.onOfflineStatusToggle);
    window.removeEventListener("offline", this.onOfflineStatusToggle);
    window.removeEventListener(EVENT.BEFORE_UNLOAD, this.beforeUnload);
    window.removeEventListener(EVENT.UNLOAD, this.onUnload);
    window.removeEventListener(EVENT.POINTER_MOVE, this.onPointerMove);
    window.removeEventListener(
      EVENT.VISIBILITY_CHANGE,
      this.onVisibilityChange,
    );
    if (this.activeIntervalId) {
      window.clearInterval(this.activeIntervalId);
      this.activeIntervalId = null;
    }
    if (this.idleTimeoutId) {
      window.clearTimeout(this.idleTimeoutId);
      this.idleTimeoutId = null;
    }
    this.onUmmount?.();
  }

  isCollaborating = () => appJotaiStore.get(isCollaboratingAtom)!;

  private setIsCollaborating = (isCollaborating: boolean) => {
    appJotaiStore.set(isCollaboratingAtom, isCollaborating);
  };

  private onUnload = () => {
    this.destroySocketClient({ isUnload: true });
  };

  private beforeUnload = withBatchedUpdates((event: BeforeUnloadEvent) => {
    const syncableElements = getSyncableElements(
      this.getSceneElementsIncludingDeleted(),
    );

    if (
      this.isCollaborating() &&
      (this.fileManager.shouldPreventUnload(syncableElements) ||
        !isSavedToFirebase(this.portal, syncableElements))
    ) {
      // this won't run in time if user decides to leave the site, but
      //  the purpose is to run in immediately after user decides to stay
      this.saveCollabRoomToFirebase(syncableElements);

      preventUnload(event);
    }
  });

  saveCollabRoomToFirebase = async (
    syncableElements: readonly SyncableExcalidrawElement[],
  ) => {
    // 일단 씬은 동기화 안하게 변경
    // try {
    //   const savedData = await saveToFirebase(
    //     this.portal,
    //     syncableElements,
    //     this.excalidrawAPI.getAppState(),
    //   );
    //   if (this.isCollaborating() && savedData && savedData.reconciledElements) {
    //     this.handleRemoteSceneUpdate(
    //       this.reconcileElements(savedData.reconciledElements),
    //     );
    //   }
    // } catch (error: any) {
    //   this.setState({
    //     // firestore doesn't return a specific error code when size exceeded
    //     errorMessage: /is longer than.*?bytes/.test(error.message)
    //       ? t("errors.collabSaveFailed_sizeExceeded")
    //       : t("errors.collabSaveFailed"),
    //   });
    //   console.error(error);
    // }
  };

  /**
   * 동기체크 없이 파이어베이스에 저장하는 함수
   * Add by dotree
   * @param syncableElements
   */
  saveCollabRoomToFirebaseWithReset = async (
    syncableElements: readonly SyncableExcalidrawElement[],
  ) => {
    // 일단 씬은 동기화 안하게 변경
    // try {
    //   const savedData = await saveToFirebaseNotSync(
    //     this.portal,
    //     syncableElements,
    //     this.excalidrawAPI.getAppState(),
    //   );
    //   if (this.isCollaborating() && savedData && savedData.reconciledElements) {
    //     this.handleRemoteSceneUpdate(
    //       this.reconcileElements(savedData.reconciledElements),
    //     );
    //   }
    // } catch (error: any) {
    //   this.setState({
    //     // firestore doesn't return a specific error code when size exceeded
    //     errorMessage: /is longer than.*?bytes/.test(error.message)
    //       ? t("errors.collabSaveFailed_sizeExceeded")
    //       : t("errors.collabSaveFailed"),
    //   });
    //   console.error(error);
    // }
  };

  /**
   * 슬라이드 저장하는 firestore에 저장하는 함수
   * Add by dotree
   * @param slides
   */
  saveCollabRoomSlideToFirebase = async (
    slides: readonly Scene[],
    fileIds: readonly FileId[],
    currentSceneId: string,
  ) => {
    try {
      const savedData = await saveSlideToFirebase(
        this.portal,
        slides,
        fileIds,
        currentSceneId,
      );
      if (this.isCollaborating() && savedData) {
        // 갱신해줘야할 것이 있으면 갱신
      }
    } catch (error: any) {
      this.setState({
        // firestore doesn't return a specific error code when size exceeded
        errorMessage: /is longer than.*?bytes/.test(error.message)
          ? t("errors.collabSaveFailed_sizeExceeded")
          : t("errors.collabSaveFailed"),
      });
      console.error(error);
    }
  };

  stopCollaboration = (keepRemoteState = true) => {
    this.queueBroadcastAllElements.cancel();
    this.queueSaveToFirebase.cancel();
    this.loadImageFiles.cancel();
    this.forceLoadImageFiles.cancel();

    this.saveCollabRoomToFirebase(
      getSyncableElements(
        this.excalidrawAPI.getSceneElementsIncludingDeleted(),
      ),
    );

    if (this.portal.socket && this.fallbackInitializationHandler) {
      this.portal.socket.off(
        "connect_error",
        this.fallbackInitializationHandler,
      );
    }

    if (!keepRemoteState) {
      LocalData.fileStorage.reset();
      this.destroySocketClient();
    } else if (window.confirm(t("alerts.collabStopOverridePrompt"))) {
      // hack to ensure that we prefer we disregard any new browser state
      // that could have been saved in other tabs while we were collaborating
      resetBrowserStateVersions();

      window.history.pushState({}, APP_NAME, window.location.origin);
      this.destroySocketClient();

      LocalData.fileStorage.reset();

      const elements = this.excalidrawAPI
        .getSceneElementsIncludingDeleted()
        .map((element) => {
          if (isImageElement(element) && element.status === "saved") {
            return newElementWith(element, { status: "pending" });
          }
          return element;
        });

      this.excalidrawAPI.updateScene({
        elements,
        commitToHistory: false,
      });
    }
  };

  private destroySocketClient = (opts?: { isUnload: boolean }) => {
    this.lastBroadcastedOrReceivedSceneVersion = -1;
    this.portal.close();
    this.fileManager.reset();
    if (!opts?.isUnload) {
      this.setIsCollaborating(false);
      this.setActiveRoomLink(null);
      this.collaborators = new Map();
      this.excalidrawAPI.updateScene({
        collaborators: this.collaborators,
      });
      LocalData.resumeSave("collaboration");
    }
  };

  private fetchImageFilesFromFirebase = async (opts: {
    elements: readonly ExcalidrawElement[];
    /**
     * Indicates whether to fetch files that are errored or pending and older
     * than 10 seconds.
     *
     * Use this as a mechanism to fetch files which may be ok but for some
     * reason their status was not updated correctly.
     */
    forceFetchFiles?: boolean;
  }) => {
    const unfetchedImages = opts.elements
      .filter((element) => {
        return (
          isInitializedImageElement(element) &&
          !this.fileManager.isFileHandled(element.fileId) &&
          !element.isDeleted &&
          (opts.forceFetchFiles
            ? element.status !== "pending" ||
            Date.now() - element.updated > 10000
            : element.status === "saved")
        );
      })
      .map((element) => (element as InitializedExcalidrawImageElement).fileId);

    return await this.fileManager.getFiles(unfetchedImages);
  };

  private fetchImageFilesFromFirebaseFileOnly = async (opts: {
    fileIds: readonly FileId[];
  }) => {
    const unfetchedImages = opts.fileIds.filter((fileId) => {
      return !this.fileManager.isFileHandled(fileId);
    });

    return await this.fileManager.getFiles(unfetchedImages);
  };

  private decryptPayload = async (
    iv: Uint8Array,
    encryptedData: ArrayBuffer,
    decryptionKey: string,
  ): Promise<ValueOf<SocketUpdateDataSource>> => {
    try {
      const decrypted = await decryptData(iv, encryptedData, decryptionKey);

      const decodedData = new TextDecoder("utf-8").decode(
        new Uint8Array(decrypted),
      );
      return JSON.parse(decodedData);
    } catch (error) {
      window.alert(t("alerts.decryptFailed"));
      console.error(error);
      return {
        type: WS_SUBTYPES.INVALID_RESPONSE,
      };
    }
  };

  private decryptPayloadJson = async (
    encryptedData: string,
  ): Promise<ValueOf<SocketUpdateDataSource>> => {
    try {
      return JSON.parse(encryptedData);
    } catch (error) {
      window.alert(t("alerts.decryptFailed"));
      console.error(error);
      return {
        type: WS_SUBTYPES.INVALID_RESPONSE,
      };
    }
  };

  private fallbackInitializationHandler: null | (() => any) = null;

  getFileManager = () => {
    return this.fileManager;
  };

  startCollaboration = async (
    existingRoomLinkData: null | RoomData,
  ): Promise<ImportedDataState | null> => {
    // if (!this.state.username) {
    //   const username = generateKoreanName(false);
    //   this.setUsername(username);
    //   // import("@excalidraw/random-username").then(({ getRandomUsername }) => {
    //   //   const username = getRandomUsername();
    //   //   this.setUsername(username);
    //   // });
    // }
    // const username = generateKoreanName(false);
    // const username = "안녕녕녕";
    // this.setUsername(username);

    if (this.portal.socket) {
      return null;
    }

    let roomId;
    let roomKey;
    let user;

    if (existingRoomLinkData) {
      ({ roomId, roomKey, user } = existingRoomLinkData);
      if (user) {
        this.setUsername(user.name);
      }
    } else {
      ({ roomId, roomKey } = await generateCollaborationLinkData());
      window.history.pushState(
        {},
        APP_NAME,
        getCollaborationLink({ roomId, roomKey }),
      );

      // 공유 시작하고, 상태 처리
      loaderSingleton.setIsSlide(true);
    }

    const scenePromise = resolvablePromise<ImportedDataState | null>();

    this.setIsCollaborating(true);
    LocalData.pauseSave("collaboration");

    const { default: socketIOClient } = await import(
      /* webpackChunkName: "socketIoClient" */ "socket.io-client"
    );

    const fallbackInitializationHandler = () => {
      this.initializeRoom({
        roomLinkData: existingRoomLinkData,
        fetchScene: true,
      }).then((scene) => {
        scenePromise.resolve(scene);
      });
    };
    this.fallbackInitializationHandler = fallbackInitializationHandler;

    try {
      this.portal.socket = this.portal.open(
        socketIOClient(import.meta.env.VITE_APP_WS_SERVER_URL, {
          transports: ["websocket", "polling"],
          autoConnect: true,
        }),
        roomId,
        roomKey,
      );

      // 소켓 공유
      appJotaiStore.set(socketAtom, this.portal.socket);

      this.portal.socket.on("disconnect", (reason, details) => {
        console.error("io disconnected ", reason, details);
        loaderSingleton.setIsWebSocket(false);
      });

      this.portal.socket.on("connect_error", (error) => {
        console.error("io connect_error", error);
        loaderSingleton.setIsWebSocket(false);
      });
      this.portal.socket.once("connect_error", fallbackInitializationHandler);
    } catch (error: any) {
      console.error(error);
      this.setState({ errorMessage: error.message });
      return null;
    }

    if (!existingRoomLinkData) {
      const elements = this.excalidrawAPI.getSceneElements().map((element) => {
        if (isImageElement(element) && element.status === "saved") {
          return newElementWith(element, { status: "pending" });
        }
        return element;
      });
      // remove deleted elements from elements array & history to ensure we don't
      // expose potentially sensitive user data in case user manually deletes
      // existing elements (or clears scene), which would otherwise be persisted
      // to database even if deleted before creating the room.
      this.excalidrawAPI.history.clear();
      this.excalidrawAPI.updateScene({
        elements,
        commitToHistory: true,
      });

      this.saveCollabRoomToFirebase(getSyncableElements(elements));
    }

    // fallback in case you're not alone in the room but still don't receive
    // initial SCENE_INIT message
    this.socketInitializationTimer = window.setTimeout(
      fallbackInitializationHandler,
      INITIAL_SCENE_UPDATE_TIMEOUT,
    );

    // All socket listeners are moving to Portal
    this.portal.socket.on(
      "client-broadcast",
      // async (encryptedData: ArrayBuffer, iv: Uint8Array) => {
      async (jsonData: string) => {
        if (!this.portal.roomKey) {
          return;
        }

        // 종단간 암호화 데이터 복호화
        // const decryptedData = await this.decryptPayload(
        //   iv,
        //   encryptedData,
        //   this.portal.roomKey,
        // );
        const decryptedData = await this.decryptPayloadJson(jsonData);

        switch (decryptedData.type) {
          case WS_SUBTYPES.INVALID_RESPONSE:
            return;
          case WS_SUBTYPES.INIT: {
            if (!this.portal.socketInitialized) {
              await this.initializeRoom({
                fetchScene: true,
                roomLinkData: {
                  roomId: this.portal.roomId || "",
                  roomKey: this.portal.roomKey,
                },
              });
              const remoteElements = decryptedData.payload.elements;
              const reconciledElements = this.reconcileElements(remoteElements);
              this.handleRemoteSceneUpdate(reconciledElements, {
                init: true,
              });
              // noop if already resolved via init from firebase
              scenePromise.resolve({
                elements: reconciledElements,
                scrollToContent: true,
              });
            }
            break;
          }
          case WS_SUBTYPES.UPDATE:
            if (decryptedData.payload.id === this.getCurrentSceneId()) {
              this.handleRemoteSceneUpdate(
                this.reconcileElements(decryptedData.payload.elements),
              );
            }
            break;
          case WS_SUBTYPES.FULL_UPDATE: // 슬라이드 전환용 Add by dotree
            if (decryptedData.payload.id) {
              this.setLastBroadcastedOrReceivedSceneVersion(0);

              // 인덱스 변경
              appJotaiStore.set(
                currentIndexAtom,
                decryptedData.payload.currentIndex || 0,
              );

              // 문서ID 변경
              appJotaiStore.set(currentSceneIdAtom, decryptedData.payload.id);

              this.handleRemoteSceneUpdateWithReset(
                decryptedData.payload.elements,
                {
                  init: false,
                },
              );
            }
            break;
          case WS_SUBTYPES.START_RECORDING: // 녹화 시작
          case WS_SUBTYPES.STOP_RECORDING: // 녹화 종료
            break;
          case WS_SUBTYPES.SCENE_DELETED: // 슬라이드 삭제
            if (decryptedData.payload.id) {
              slideRef.removeScene(decryptedData.payload.id, { isSync: false });
            }
            break;
          case WS_SUBTYPES.SLIDE_WAITING: // PDF 로드 대기중 Add by dotree
            // PDF 불러오는 동안 소켓 데이터 안쏘게 변경
            appJotaiStore.set(socketLockAtom, true);

            // 로딩 표시
            appJotaiStore.set(loadingUIAtom, {
              icon: "pdf",
              message: "PDF 불러오기 요청이\n들어와서 대기 중입니다.",
            });
            appJotaiStore.set(isLoadingAtom, true);
            break;
          case WS_SUBTYPES.SLIDE_UPDATE: // 슬라이드 교체용 Add by dotree
            appJotaiStore.set(loadingUIAtom, {
              icon: "pdf",
              message: "PDF 데이터를 불러오고 있습니다.",
            });

            this.portal.socketInitialized = false;
            await this.initializeRoom({
              fetchScene: true,
              roomLinkData: {
                roomId: this.portal.roomId || "",
                roomKey: this.portal.roomKey,
              },
            });

            // if (res !== null) {
            //   this.handleRemoteSceneUpdateWithReset(res.elements, {
            //     init: false,
            //   });
            // }
            // scenePromise.resolve({
            //   elements: elements,
            //   scrollToContent: true,
            // });

            // PDF 불러오는 동안 소켓 데이터 안쏘게 변경
            appJotaiStore.set(socketLockAtom, false);

            // 로딩 종료
            appJotaiStore.set(isLoadingAtom, false);
            break;
          case WS_SUBTYPES.SLIDE_CANCELED: // 슬라이드 교체용 Add by dotree
            // PDF 불러오는 동안 소켓 데이터 안쏘게 변경
            appJotaiStore.set(socketLockAtom, false);
            appJotaiStore.set(isLoadingAtom, false);
            break;
          case WS_SUBTYPES.UPLOADED_IMAGES: // 이미지가 업로드 되었을 때, 알림(빠른 동기화를 위함) Add by dotree
            // this.forceLoadImageFiles({
            //   fileIds: decryptedData.payload.fileIds,
            // });
            break;
          case WS_SUBTYPES.MOUSE_LOCATION: {
            const { pointer, button, username, selectedElementIds } =
              decryptedData.payload;

            const socketId: SocketUpdateDataSource["MOUSE_LOCATION"]["payload"]["socketId"] =
              decryptedData.payload.socketId ||
              // @ts-ignore legacy, see #2094 (#2097)
              decryptedData.payload.socketID;

            this.updateCollaborator(socketId, {
              pointer,
              button,
              selectedElementIds,
              username,
            });

            break;
          }

          case WS_SUBTYPES.USER_VISIBLE_SCENE_BOUNDS: {
            const { sceneBounds, socketId } = decryptedData.payload;
            const appState = this.excalidrawAPI.getAppState();

            // we're not following the user
            // (shouldn't happen, but could be late message or bug upstream)
            if (appState.userToFollow?.socketId !== socketId) {
              console.warn(
                `receiving remote client's (from ${socketId}) viewport bounds even though we're not subscribed to it!`,
              );
              return;
            }

            // cross-follow case, ignore updates in this case
            if (
              appState.userToFollow &&
              appState.followedBy.has(appState.userToFollow.socketId)
            ) {
              return;
            }

            this.excalidrawAPI.updateScene({
              appState: zoomToFitBounds({
                appState,
                bounds: sceneBounds,
                fitToViewport: true,
                viewportZoomFactor: 1,
              }).appState,
            });

            break;
          }

          case WS_SUBTYPES.ENDED_ROOM: {
            appJotaiStore.set(roomStatusAtom, RoomStatus.ENDED);
            break;
          }

          case WS_SUBTYPES.IDLE_STATUS: {
            const { userState, socketId, username } = decryptedData.payload;
            this.updateCollaborator(socketId, {
              userState,
              username,
            });
            break;
          }

          default: {
            assertNever(decryptedData, null);
          }
        }
      },
    );

    this.portal.socket.on("first-in-room", async () => {
      if (this.portal.socket) {
        this.portal.socket.off("first-in-room");
      }
      const sceneData = await this.initializeRoom({
        fetchScene: true,
        roomLinkData: existingRoomLinkData,
      });
      scenePromise.resolve(sceneData);
    });

    this.portal.socket.on(
      WS_EVENTS.USER_FOLLOW_ROOM_CHANGE,
      (followedBy: SocketId[]) => {
        this.excalidrawAPI.updateScene({
          appState: { followedBy: new Set(followedBy) },
        });

        this.relayVisibleSceneBounds({ force: true });
      },
    );

    this.portal.socket.on(WS_EVENTS.RECORDER_STATUS_CHANGE, (status: any) => {
      recorderRef.setStatus(status);
    });

    this.initializeIdleDetector();

    this.setActiveRoomLink(window.location.href);

    return scenePromise;
  };

  startSocket = () => {
    if (this.portal.socket) {
      this.portal.socket.connect();
    }
  };

  isConnectedSocket = () => {
    if (this.portal.socket) {
      return this.portal.socket.connected;
    }
    return false;
  };

  private initializeRoom = async ({
    fetchScene,
    roomLinkData,
  }:
    | {
      fetchScene: true;
      roomLinkData: { roomId: string; roomKey: string } | null;
    }
    | { fetchScene: false; roomLinkData?: null }) => {
    clearTimeout(this.socketInitializationTimer!);
    if (this.portal.socket && this.fallbackInitializationHandler) {
      this.portal.socket.off(
        "connect_error",
        this.fallbackInitializationHandler,
      );
    }
    if (fetchScene && roomLinkData && this.portal.socket) {
      try {
        await slideRef.loadRoomSlideData({
          roomId: roomLinkData.roomId,
          roomKey: roomLinkData.roomKey,
          socket: this.portal.socket,
        });
      } catch (error: any) {
        console.error(error);
      } finally {
        this.portal.socketInitialized = true;
      }
      // // 로딩 표시
      // appJotaiStore.set(loadingUIAtom, {
      //   icon: "pdf",
      //   message: "페이지를 로드하고 있습니다.",
      // });
      // appJotaiStore.set(isLoadingAtom, true);

      // try {
      //   const slide: {
      //     slides: Scene[];
      //     fileIds: readonly FileId[];
      //     currentSceneId: string;
      //   } | null = await loadSlideFromFirebase(
      //     roomLinkData.roomId,
      //     roomLinkData.roomKey,
      //     this.portal.socket,
      //   );
      //   if (slide && slide.fileIds.length > 0) {
      //     const { loadedFiles } = await this.fileManager.getFiles([
      //       ...slide.fileIds,
      //     ]);
      //     await this.excalidrawAPI.setFiles(
      //       loadedFiles.length > 0 ? loadedFiles : [],
      //     );
      //   }

      //   if (slide && slide.slides) {
      //     let currentIndex = slide.currentSceneId
      //       ? slide.slides.findIndex(
      //           (scene) => scene.id === slide.currentSceneId,
      //         )
      //       : 0;
      //     currentIndex = Math.max(currentIndex, 0);

      //     const scene = slide.slides[currentIndex] || null;
      //     const selectedIndex = scene ? currentIndex : 0;

      //     // 해당 슬라이드 그리기
      //     await slideRef.setSlide(slide.slides, {
      //       focusIndex: selectedIndex,
      //       isFit: true,
      //     });

      //     // 끝나기 전에 딜레이 살짝 줘야 렌더링이 재대로 되서 넣음
      //     await this.delay(100);

      //     loaderSingleton.setIsSlide(true);

      //     return {
      //       elements: scene && scene.drawing ? scene.drawing.elements : [],
      //       scrollToContent: true,
      //       slide,
      //     };
      //   }
      // } catch (error: any) {
      //   // log the error and move on. other peers will sync us the scene.
      //   console.error(error);
      // } finally {
      //   this.portal.socketInitialized = true;
      //   appJotaiStore.set(isLoadingAtom, false);
      // }
    } else {
      this.portal.socketInitialized = true;
    }
    return null;
  };

  private reconcileElements = (
    remoteElements: readonly ExcalidrawElement[],
  ): ReconciledElements => {
    const localElements = this.getSceneElementsIncludingDeleted();
    const appState = this.excalidrawAPI.getAppState();

    remoteElements = restoreElements(remoteElements, null);

    const reconciledElements = _reconcileElements(
      localElements,
      remoteElements,
      appState,
    );

    // Avoid broadcasting to the rest of the collaborators the scene
    // we just received!
    // Note: this needs to be set before updating the scene as it
    // synchronously calls render.
    this.setLastBroadcastedOrReceivedSceneVersion(
      getSceneVersion(reconciledElements),
    );

    return reconciledElements;
  };

  private loadImageFiles = throttle(async () => {
    const { loadedFiles, erroredFiles } =
      await this.fetchImageFilesFromFirebase({
        elements: this.excalidrawAPI.getSceneElementsIncludingDeleted(),
      });

    this.excalidrawAPI.addFiles(loadedFiles);

    updateStaleImageStatuses({
      excalidrawAPI: this.excalidrawAPI,
      erroredFiles,
      elements: this.excalidrawAPI.getSceneElementsIncludingDeleted(),
    });
  }, LOAD_IMAGES_TIMEOUT);

  private forceLoadImageFiles = throttle(
    async ({ fileIds }: { fileIds: readonly FileId[] }) => {
      const { loadedFiles, erroredFiles } =
        await this.fetchImageFilesFromFirebaseFileOnly({
          fileIds,
        });

      this.excalidrawAPI.setFiles(loadedFiles.length > 0 ? loadedFiles : []);

      updateStaleImageStatuses({
        excalidrawAPI: this.excalidrawAPI,
        erroredFiles,
        elements: this.excalidrawAPI.getSceneElementsIncludingDeleted(),
      });
    },
    LOAD_IMAGES_TIMEOUT,
  );

  private handleRemoteSceneUpdate = (
    elements: ReconciledElements,
    { init = false }: { init?: boolean } = {},
  ) => {
    this.excalidrawAPI.updateScene({
      elements,
      commitToHistory: !!init,
    });

    // We haven't yet implemented multiplayer undo functionality, so we clear the undo stack
    // when we receive any messages from another peer. This UX can be pretty rough -- if you
    // undo, a user makes a change, and then try to redo, your element(s) will be lost. However,
    // right now we think this is the right tradeoff.
    this.excalidrawAPI.history.clear();

    this.loadImageFiles();
  };

  private handleRemoteSceneUpdateWithReset = (
    elements: readonly ExcalidrawElement[],
    { init = false }: { init?: boolean } = {},
  ) => {
    const appState = this.excalidrawAPI.getAppState();

    // zoom to fit viewport
    const fitBoundsAppState = zoomToFitBounds({
      appState,
      bounds: getCommonBounds(elements),
      fitToViewport: true,
      viewportZoomFactor: 1,
    }).appState;

    this.excalidrawAPI.resetScene();
    this.excalidrawAPI.updateScene({
      elements,
      appState: fitBoundsAppState,
      commitToHistory: !!init,
    });

    // We haven't yet implemented multiplayer undo functionality, so we clear the undo stack
    // when we receive any messages from another peer. This UX can be pretty rough -- if you
    // undo, a user makes a change, and then try to redo, your element(s) will be lost. However,
    // right now we think this is the right tradeoff.
    this.excalidrawAPI.history.clear();

    this.loadImageFiles();
  };

  private onPointerMove = () => {
    if (this.idleTimeoutId) {
      window.clearTimeout(this.idleTimeoutId);
      this.idleTimeoutId = null;
    }

    this.idleTimeoutId = window.setTimeout(this.reportIdle, IDLE_THRESHOLD);

    if (!this.activeIntervalId) {
      this.activeIntervalId = window.setInterval(
        this.reportActive,
        ACTIVE_THRESHOLD,
      );
    }
  };

  private onVisibilityChange = () => {
    if (document.hidden) {
      if (this.idleTimeoutId) {
        window.clearTimeout(this.idleTimeoutId);
        this.idleTimeoutId = null;
      }
      if (this.activeIntervalId) {
        window.clearInterval(this.activeIntervalId);
        this.activeIntervalId = null;
      }
      this.onIdleStateChange(UserIdleState.AWAY);
    } else {
      this.idleTimeoutId = window.setTimeout(this.reportIdle, IDLE_THRESHOLD);
      this.activeIntervalId = window.setInterval(
        this.reportActive,
        ACTIVE_THRESHOLD,
      );
      this.onIdleStateChange(UserIdleState.ACTIVE);
    }
  };

  private reportIdle = () => {
    this.onIdleStateChange(UserIdleState.IDLE);
    if (this.activeIntervalId) {
      window.clearInterval(this.activeIntervalId);
      this.activeIntervalId = null;
    }
  };

  private reportActive = () => {
    this.onIdleStateChange(UserIdleState.ACTIVE);
  };

  private initializeIdleDetector = () => {
    document.addEventListener(EVENT.POINTER_MOVE, this.onPointerMove);
    document.addEventListener(EVENT.VISIBILITY_CHANGE, this.onVisibilityChange);
  };

  setCollaborators(clients: RoomUser[]) {
    const collaborators: InstanceType<typeof Collab>["collaborators"] =
      new Map();
    for (const user of clients) {
      collaborators.set(
        user.socketId as SocketId,
        Object.assign({}, this.collaborators.get(user.socketId as SocketId), {
          username: user.name,
          role: user.role,
          isCurrentUser: user.socketId === this.portal.socket?.id,
        }),
      );
    }
    this.collaborators = collaborators;
    // 학생은 기본적으로 팔로우 하게 추가
    // if (userRole === RoomUserRole.STUDENT) {
    //   const user = clients.find(
    //     (client) => client.role === RoomUserRole.TEACHER,
    //   );
    //   if (user) {
    //     this.excalidrawAPI.updateScene({
    //       appState: {
    //         userToFollow: {
    //           socketId: user.id as SocketId,
    //           username: user.name || "",
    //         },
    //       },
    //       collaborators,
    //     });
    //     return;
    //   }
    // }
    this.excalidrawAPI.updateScene({ collaborators });
  }

  updateCollaborator = (socketId: SocketId, updates: Partial<Collaborator>) => {
    const collaborators = new Map(this.collaborators);
    const user: Mutable<Collaborator> = Object.assign(
      {},
      collaborators.get(socketId),
      updates,
      {
        isCurrentUser: socketId === this.portal.socket?.id,
      },
    );
    collaborators.set(socketId, user);
    this.collaborators = collaborators;

    this.excalidrawAPI.updateScene({
      collaborators,
    });
  };

  public setLastBroadcastedOrReceivedSceneVersion = (version: number) => {
    this.lastBroadcastedOrReceivedSceneVersion = version;
  };

  public getLastBroadcastedOrReceivedSceneVersion = () => {
    return this.lastBroadcastedOrReceivedSceneVersion;
  };

  public getSceneElementsIncludingDeleted = () => {
    return this.excalidrawAPI.getSceneElementsIncludingDeleted();
  };

  public getCurrentSceneId = () => {
    return appJotaiStore.get(currentSceneIdAtom) || null;
  };

  onPointerUpdate = throttle(
    (payload: {
      pointer: SocketUpdateDataSource["MOUSE_LOCATION"]["payload"]["pointer"];
      button: SocketUpdateDataSource["MOUSE_LOCATION"]["payload"]["button"];
      pointersMap: Gesture["pointers"];
    }) => {
      payload.pointersMap.size < 2 &&
        this.portal.socket &&
        this.portal.broadcastMouseLocation(payload);
    },
    CURSOR_SYNC_TIMEOUT,
  );

  relayVisibleSceneBounds = (props?: { force: boolean }) => {
    const appState = this.excalidrawAPI.getAppState();

    if (this.portal.socket && (appState.followedBy.size > 0 || props?.force)) {
      this.portal.broadcastVisibleSceneBounds(
        {
          sceneBounds: getVisibleSceneBounds(appState),
        },
        `follow@${this.portal.socket.id}`,
      );
    }
  };

  onIdleStateChange = (userState: UserIdleState) => {
    this.portal.broadcastIdleChange(userState);
  };

  broadcastElements = (
    elements: readonly ExcalidrawElement[],
    id: string | null,
  ) => {
    if (
      getSceneVersion(elements) >
      this.getLastBroadcastedOrReceivedSceneVersion()
    ) {
      this.portal.broadcastScene(WS_SUBTYPES.UPDATE, elements, id, false);
      this.lastBroadcastedOrReceivedSceneVersion = getSceneVersion(elements);
      this.queueBroadcastAllElements();
    }
  };

  /**
   * 동기 체크 없이 엘레멘탈 브로드 캐스트 및 동기화 하는 함수
   * Add by dotree
   * @param elements
   */
  broadcastElementsWithReset = (
    elements: readonly ExcalidrawElement[],
    id: string | null,
    currentIndex: number | undefined,
  ) => {
    this.portal.broadcastSceneWithReset(
      WS_SUBTYPES.FULL_UPDATE,
      elements,
      id,
      currentIndex,
      true,
    );
    this.queueBroadcastAllElements();
  };

  /**
   * 녹화 시작
   */
  broadcastStartRecording = (
    elements: readonly ExcalidrawElement[],
    id: string | null,
    currentIndex: number | undefined,
  ) => {
    this.portal.broadcastStartRecording(elements, id, currentIndex);
  };

  /**
   * 녹화 종료
   */
  broadcastStopRecording = () => {
    this.portal.broadcastStopRecording();
  };

  /**
   * 슬라이드 업로드 대기
   */
  broadcastSlideWaiting = () => {
    this.portal.broadcastSlideWaiting(WS_SUBTYPES.SLIDE_WAITING);
  };

  /**
   * 슬라이드 동기화
   */
  broadcastSlide = () => {
    this.portal.broadcastSlide(WS_SUBTYPES.SLIDE_UPDATE);
  };

  /**
   * 슬라이드 업로드 취소
   */
  broadcastSlideCanceled = () => {
    this.portal.broadcastSlideCanceled(WS_SUBTYPES.SLIDE_CANCELED);
  };

  /**
   * 씬 삭제
   */
  broadcastSceneDeleted = (id: string) => {
    this.portal.broadcastSceneDeleted(WS_SUBTYPES.SCENE_DELETED, id);
  };

  syncElements = (
    elements: readonly ExcalidrawElement[],
    id: string | null,
  ) => {
    if (!appJotaiStore.get(socketLockAtom)) {
      this.broadcastElements(elements, id);
      this.queueSaveToFirebase();
      this.queueSaveSlideToFirebaseThrottle(
        (appJotaiStore.get(slideAtom) || []).map((scene) => {
          return Object.assign({}, scene, {
            imageUrl: null,
            drawing: Object.assign({}, scene.drawing, { files: null }),
          });
        }),
        Object.keys(this.excalidrawAPI.getFiles()) as unknown as FileId[],
        appJotaiStore.get(currentSceneIdAtom) || "",
      );
    }
  };

  /**
   * 동기 체크 없이 엘레멘탈 브로드 캐스트 및 동기화 하는 함수
   * Add by dotree
   * @param elements
   */
  syncElementsWithReset = (
    elements: readonly ExcalidrawElement[],
    id: string | null,
    currentIndex: number | undefined,
  ) => {
    if (!appJotaiStore.get(socketLockAtom)) {
      this.setLastBroadcastedOrReceivedSceneVersion(0);
      this.broadcastElementsWithReset(elements, id, currentIndex);
      this.queueSaveToFirebaseWithReset();
      this.queueSaveSlideToFirebase(
        (appJotaiStore.get(slideAtom) || []).map((scene) => {
          return Object.assign({}, scene, {
            imageUrl: null,
            drawing: Object.assign({}, scene.drawing, { files: null }),
          });
        }),
        Object.keys(this.excalidrawAPI.getFiles()) as unknown as FileId[],
        appJotaiStore.get(currentSceneIdAtom) || "",
      );
    }
  };

  /**
   * 슬라이드 동기화를 위해 Firestore에 저장 하는 함수
   * @param slides
   * @param fileIds
   */
  syncSlideWithWait = async (
    slides: readonly Scene[],
    fileIds: readonly FileId[],
    currentSceneId: string,
  ) => {
    await this.queueSaveSlideToFirebase(slides, fileIds, currentSceneId);
    await this.portal.forceQueueFileUpload();
    // await this.delay(500);
    await this.broadcastSlide();
  };

  /**
   * 슬라이드 동기화를 위해 Firestore에 저장 하는 함수
   * @param slides
   * @param fileIds
   */
  syncSlide = (
    slides: readonly Scene[],
    fileIds: readonly FileId[],
    currentSceneId: string,
  ) => {
    if (!appJotaiStore.get(socketLockAtom)) {
      this.queueSaveSlideToFirebaseThrottle(slides, fileIds, currentSceneId);
    }
  };

  queueBroadcastAllElements = throttle(() => {
    this.portal.broadcastScene(
      WS_SUBTYPES.UPDATE,
      this.excalidrawAPI.getSceneElementsIncludingDeleted(),
      appJotaiStore.get(currentSceneIdAtom) || null,
      true,
    );
    const currentVersion = this.getLastBroadcastedOrReceivedSceneVersion();
    const newVersion = Math.max(
      currentVersion,
      getSceneVersion(this.getSceneElementsIncludingDeleted()),
    );
    this.setLastBroadcastedOrReceivedSceneVersion(newVersion);
  }, SYNC_FULL_SCENE_INTERVAL_MS);

  queueSaveToFirebase = throttle(
    () => {
      if (this.portal.socketInitialized) {
        this.saveCollabRoomToFirebase(
          getSyncableElements(
            this.excalidrawAPI.getSceneElementsIncludingDeleted(),
          ),
        );
      }
    },
    SYNC_FULL_SCENE_INTERVAL_MS,
    { leading: false },
  );

  queueSaveToFirebaseWithReset = () => {
    if (this.portal.socketInitialized) {
      const elements =
        this.excalidrawAPI.getSceneElementsIncludingDeleted() as SyncableExcalidrawElement[];
      this.saveCollabRoomToFirebaseWithReset(elements);
    }
  };

  /**
   * 슬라이드 Firestore에 저장하는 함수
   * Add by dotree
   */
  queueSaveSlideToFirebase = async (
    slides: readonly Scene[],
    fileIds: readonly FileId[],
    currentSceneId: string,
  ) => {
    if (this.portal.socketInitialized) {
      return await this.saveCollabRoomSlideToFirebase(
        slides,
        fileIds,
        currentSceneId,
      );
    }
    return null;
  };

  /**
   * 슬라이드 Firestore에 저장하는 함수
   * Add by dotree
   */
  queueSaveSlideToFirebaseThrottle = throttle(
    (
      slides: readonly Scene[],
      fileIds: readonly FileId[],
      currentSceneId: string,
    ) => {
      if (this.portal.socketInitialized) {
        this.saveCollabRoomSlideToFirebase(slides, fileIds, currentSceneId);
      }
    },
    SYNC_SLIDE_INTERVAL_MS,
    { leading: true },
  );

  setUsername = (username: string) => {
    this.setState({ username });
    saveUsernameToLocalStorage(username);
    userRef.setAnonymousUser(username);
  };

  getUsername = () => this.state.username;

  getPortal = () => this.portal;

  setActiveRoomLink = (activeRoomLink: string | null) => {
    this.setState({ activeRoomLink });
    appJotaiStore.set(activeRoomLinkAtom, activeRoomLink);
  };

  getActiveRoomLink = () => this.state.activeRoomLink;

  setErrorMessage = (errorMessage: string | null) => {
    this.setState({ errorMessage });
  };

  followUser = (payload: OnUserFollowedPayload) => {
    const appState = this.excalidrawAPI.getAppState();

    // 이미 팔로우 중인 사람이 있으면
    if (appState.userToFollow) {
      // 이미 팔로우 중인 사람이 같은 사람이면, 언팔
      if (appState.userToFollow.socketId === payload.userToFollow.socketId) {
        this.excalidrawAPI.updateScene({
          appState: {
            ...appState,
            userToFollow: null,
          },
        });
        this.portal.broadcastUserFollowed({ ...payload, action: "UNFOLLOW" });
        return;
      }
    }

    // 팔로우 처리
    this.excalidrawAPI.updateScene({
      appState: {
        ...appState,
        userToFollow: payload.userToFollow,
      },
    });
    this.portal.broadcastUserFollowed(payload);
  };

  closeRoom = () => {
    this.portal.broadcastCloseRoom();
  };

  render() {
    const { errorMessage } = this.state;

    return (
      <>
        {errorMessage != null && (
          <ErrorDialog onClose={() => this.setState({ errorMessage: null })}>
            {errorMessage}
          </ErrorDialog>
        )}
      </>
    );
  }
}

declare global {
  interface Window {
    collab: InstanceType<typeof Collab>;
  }
}

if (import.meta.env.MODE === ENV.TEST || import.meta.env.DEV) {
  window.collab = window.collab || ({} as Window["collab"]);
}

export default Collab;

export type TCollabClass = Collab;
