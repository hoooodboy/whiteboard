import clsx from "clsx";
import LanguageDetector from "i18next-browser-languagedetector";
import { isEqual } from "lodash";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { trackEvent } from "../packages/excalidraw/analytics";
import { getDefaultAppState } from "../packages/excalidraw/appState";
import { ErrorDialog } from "../packages/excalidraw/components/ErrorDialog";
import {
  APP_NAME,
  EVENT,
  THEME,
  TITLE_TIMEOUT,
  VERSION_TIMEOUT,
} from "../packages/excalidraw/constants";
import { loadFromBlob } from "../packages/excalidraw/data/blob";
import {
  parseLibraryTokensFromUrl,
  useHandleLibrary,
} from "../packages/excalidraw/data/library";
import {
  restore,
  restoreAppState,
  RestoredDataState,
} from "../packages/excalidraw/data/restore";
import { isInitializedImageElement } from "../packages/excalidraw/element/typeChecks";
import {
  ExcalidrawElement,
  FileId,
  NonDeletedExcalidrawElement,
  Theme,
} from "../packages/excalidraw/element/types";
import { useCallbackRefState } from "../packages/excalidraw/hooks/useCallbackRefState";
import { t } from "../packages/excalidraw/i18n";
import {
  defaultLang,
  Excalidraw,
  TTDDialog,
  TTDDialogTrigger,
} from "../packages/excalidraw/index";
import polyfill from "../packages/excalidraw/polyfill";
import {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  LibraryItems,
  UIAppState,
} from "../packages/excalidraw/types";
import {
  debounce,
  getFrame,
  getVersion,
  isRunningInIframe,
  isTestEnv,
  preventUnload,
  ResolvablePromise,
  resolvablePromise,
} from "../packages/excalidraw/utils";
import {
  FIREBASE_STORAGE_PREFIXES,
  STORAGE_KEYS,
  SYNC_BROWSER_TABS_TIMEOUT,
} from "./app_constants";
import Collab, {
  CollabAPI,
  collabAPIAtom,
  isCollaboratingAtom,
  isOfflineAtom,
} from "./collab/Collab";
import { reconcileElements } from "./collab/reconciliation";
import { AppMainMenu } from "./components/AppMainMenu";
import {
  ExportToExcalidrawPlus,
  exportToExcalidrawPlus,
} from "./components/ExportToExcalidrawPlus";
import { TopErrorBoundary } from "./components/TopErrorBoundary";
import CustomStats from "./CustomStats";
import {
  exportToBackend,
  getCollaborationLinkData,
  isCollaborationLink,
  loadScene,
} from "./data";
import { updateStaleImageStatuses } from "./data/FileManager";
import { loadFilesFromFirebase } from "./data/firebase";
import { LocalData } from "./data/LocalData";
import {
  getLibraryItemsFromStorage,
  importFromLocalStorage,
  importUsernameFromLocalStorage,
} from "./data/localStorage";
import { isBrowserStorageStateNewer } from "./data/tabSync";
// import { AppWelcomeScreen } from "./components/AppWelcomeScreen";
// import { AppFooter } from "./components/AppFooter";
import { atom, Provider, useAtom, useAtomValue } from "jotai";
import { useAtomWithInitialValue } from "../packages/excalidraw/jotai";
import { appJotaiStore } from "./app-jotai";

import { OverwriteConfirmDialog } from "../packages/excalidraw/components/OverwriteConfirm/OverwriteConfirm";
import { openConfirmModal } from "../packages/excalidraw/components/OverwriteConfirm/OverwriteConfirmState";
import { ShareableLinkDialog } from "../packages/excalidraw/components/ShareableLinkDialog";
import Trans from "../packages/excalidraw/components/Trans";
import { ResolutionType } from "../packages/excalidraw/utility-types";
import "./index.scss";
import { ShareDialog, shareDialogStateAtom } from "./share/ShareDialog";

// DoSlide
import recorderRef from "./data/recorder";
import playerRef from "./data/player";
import slideRef from "./data/slide";
import Loading from "./loading/Loading";
import SlideList from "./slide/SlideList";
// import WebRTC from "./webrtc/WebRTC";
// import WebRTCJanus from "./webrtc/WebRTCJanus";

import WebRTCLoading from "./webrtc/WebRTCLoading";
import html2canvas from "html2canvas";

// Recoder
import {
  deviceStatusAtom,
  // playerStatusAtom,
  roomStatusAtom,
  screenShareStreamAtom,
  showDeviceDialogAtom,
  socketAtom,
  socketUsersAtom,
  webRTCUsersAtom,
} from "./data/atoms";
import Recorder from "./recorder/Recorder";

import "./App.scss";
import { currentSceneIdAtom, isWebRTCAtom } from "./data/atoms";
import {
  ExcalidrawAppProps,
  // PlayerStatusEnum,
  RoomData,
  RoomStatus,
  Scene,
} from "./data/types";

import { RoomUserRole } from "./data/types";
import userRef from "./data/user";
import DeviceDialog from "./components/DeviceDialog";
import SettingForm from "./components/SettingForm";
import { lazy, Suspense } from "react";
import Modal from "./components/Modal";
import styled from "styled-components";
import { WebRTCUser } from "./webrtc/types";

polyfill();

window.EXCALIDRAW_THROTTLE_RENDER = true;

let isSelfEmbedding = false;

if (window.self !== window.top) {
  try {
    const parentUrl = new URL(document.referrer);
    const currentUrl = new URL(window.location.href);
    if (parentUrl.origin === currentUrl.origin) {
      isSelfEmbedding = true;
    }
  } catch (error) {
    // ignore
  }
}

const languageDetector = new LanguageDetector();
languageDetector.init({
  languageUtils: {},
});

const shareableLinkConfirmDialog = {
  title: t("overwriteConfirm.modal.shareableLink.title"),
  description: (
    <Trans
      i18nKey="overwriteConfirm.modal.shareableLink.description"
      bold={(text) => <strong>{text}</strong>}
      br={() => <br />}
    />
  ),
  actionLabel: t("overwriteConfirm.modal.shareableLink.button"),
  color: "danger",
} as const;

const WebRTC = lazy(() => import("./webrtc/WebRTC"));
const WebRTCJanus = lazy(() => import("./webrtc/WebRTCJanus"));

const WhiteboardControls = ({ divRef }: any) => {
  // const [recorderStatus] = useAtom(playerStatusAtom);
  const [deviceStatus, setDeviceStatus] = useAtom(deviceStatusAtom);
  const [, setShowDeviceDialog] = useAtom(showDeviceDialogAtom);

  const handleCaptureClick = () => {
    if (divRef.current === null) {
      return;
    }

    html2canvas(divRef.current)
      .then((canvas) => {
        const dataUrl = canvas.toDataURL("image/png");
        const link = document.createElement("a");
        link.href = dataUrl;
        link.download = `syncblock-${new Date().getFullYear()}-${
          new Date().getMonth() + 1
        }-${new Date().getDate()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      })
      .catch((err) => {
        console.error("Failed to capture image:", err);
      });
  };

  // const toggleRecording = useCallback(async () => {
  //   return await recorderRef.toggleRecording();
  // }, []);

  useEffect(() => {
    const parseRoomIdFromUrl = () => {
      const hash = window.location.hash;
      const match = hash.match(/#room=([\w-]+)/);
      if (match && match[1]) {
      }
    };

    parseRoomIdFromUrl();

    // URL이 변경될 때마다 roomId를 다시 파싱합니다.
    window.addEventListener("hashchange", parseRoomIdFromUrl);

    return () => {
      window.removeEventListener("hashchange", parseRoomIdFromUrl);
    };
  }, []);

  return (
    <>
      <button
        type="button"
        className="btn btn-link btn-bg-trans-white"
        onClick={() =>
          setDeviceStatus((prev) => {
            return {
              ...prev,
              isVideo: !prev.isVideo,
            };
          })
        }
      >
        {deviceStatus.isVideo ? (
          <i className="wb-icon wb-icon-video-on"></i>
        ) : (
          <i className="wb-icon wb-icon-video-off"></i>
        )}
      </button>
      <button
        type="button"
        className="btn btn-link btn-bg-trans-white"
        onClick={() =>
          setDeviceStatus((prev) => {
            return {
              ...prev,
              isMic: !prev.isMic,
            };
          })
        }
      >
        {deviceStatus.isMic ? (
          <i className="wb-icon wb-icon-mic-on"></i>
        ) : (
          <i className="wb-icon wb-icon-mic-off"></i>
        )}
      </button>
      {/* <button
        type="button"
        className="btn btn-link btn-bg-trans-white"
        onClick={toggleRecording}
      >
        {recorderStatus === PlayerStatusEnum.RECORDING ? (
          <i className="wb-icon wb-icon-record-on"></i>
        ) : (
          <>
            {recorderStatus === PlayerStatusEnum.RECORD_ENDING ? (
              <>
                <i className="wb-icon wb-icon-record-on"></i>
                <span>녹화 종료 중</span>
              </>
            ) : (
              <i className="wb-icon wb-icon-record-off"></i>
            )}
          </>
        )}
      </button> */}
      <button
        type="button"
        className="btn btn-link btn-bg-trans-white"
        onClick={() => setShowDeviceDialog(true)}
      >
        <i className="wb-icon wb-icon-control"></i>
      </button>
      <button onClick={handleCaptureClick}>화면 캡처</button>
    </>
  );
};

const DeviceDialogWrapper = (props: ExcalidrawAppProps) => {
  const showDeviceDialog = useAtomValue(showDeviceDialogAtom);

  return (
    <>
      {showDeviceDialog && (
        <DeviceDialog isEditName={!props.roomData?.user?.name} />
      )}
    </>
  );
};

const initializeScene = async (opts: {
  collabAPI: CollabAPI | null;
  excalidrawAPI: ExcalidrawImperativeAPI;
  roomData: RoomData | null;
  replay?: boolean;
  embed?: boolean;
}): Promise<
  { scene: ExcalidrawInitialDataState | null } & (
    | { isExternalScene: true; id: string; key: string }
    | { isExternalScene: false; id?: null; key?: null }
  )
> => {
  const searchParams = new URLSearchParams(window.location.search);
  const id = searchParams.get("id");
  const jsonBackendMatch = window.location.hash.match(
    /^#json=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/,
  );
  const externalUrlMatch = window.location.hash.match(/^#url=(.*)$/);

  const localDataState = importFromLocalStorage();

  let scene: RestoredDataState & {
    scrollToContent?: boolean;
  } = await loadScene(null, null, localDataState);

  let roomLinkData = null;
  if (opts.roomData?.roomId) {
    roomLinkData = opts.roomData;
  } else {
    roomLinkData = getCollaborationLinkData(window.location.href);
  }
  const isExternalScene = !!(id || jsonBackendMatch || roomLinkData);
  if (isExternalScene) {
    if (
      // don't prompt if scene is empty
      !scene.elements.length ||
      // don't prompt for collab scenes because we don't override local storage
      roomLinkData ||
      // otherwise, prompt whether user wants to override current scene
      (await openConfirmModal(shareableLinkConfirmDialog))
    ) {
      if (jsonBackendMatch) {
        scene = await loadScene(
          jsonBackendMatch[1],
          jsonBackendMatch[2],
          localDataState,
        );
      }
      scene.scrollToContent = true;
      if (!roomLinkData) {
        window.history.replaceState({}, APP_NAME, window.location.origin);
      }
    } else {
      // https://github.com/excalidraw/excalidraw/issues/1919
      if (document.hidden) {
        return new Promise((resolve, reject) => {
          window.addEventListener(
            "focus",
            () => initializeScene(opts).then(resolve).catch(reject),
            {
              once: true,
            },
          );
        });
      }

      roomLinkData = null;
      window.history.replaceState({}, APP_NAME, window.location.origin);
    }
  } else if (externalUrlMatch) {
    window.history.replaceState({}, APP_NAME, window.location.origin);

    const url = externalUrlMatch[1];
    try {
      const request = await fetch(window.decodeURIComponent(url));
      const data = await loadFromBlob(await request.blob(), null, null);
      if (
        !scene.elements.length ||
        (await openConfirmModal(shareableLinkConfirmDialog))
      ) {
        return { scene: data, isExternalScene };
      }
    } catch (error: any) {
      return {
        scene: {
          appState: {
            errorMessage: t("alerts.invalidSceneUrl"),
          },
        },
        isExternalScene,
      };
    }
  }

  if (roomLinkData && opts.collabAPI) {
    const { excalidrawAPI, replay } = opts;

    // 다시보기 모드일 때는 소켓 연결 안함
    if (replay) {
      return { scene: null, isExternalScene: false };
    }

    const scene = await opts.collabAPI.startCollaboration(roomLinkData);

    return {
      // when collaborating, the state may have already been updated at this
      // point (we may have received updates from other clients), so reconcile
      // elements and appState with existing state
      scene: {
        ...scene,
        appState: {
          ...restoreAppState(
            {
              ...scene?.appState,
              theme: localDataState?.appState?.theme || scene?.appState?.theme,
            },
            excalidrawAPI.getAppState(),
          ),
          // necessary if we're invoking from a hashchange handler which doesn't
          // go through App.initializeScene() that resets this flag
          isLoading: false,
        },
        elements: reconcileElements(
          scene?.elements || [],
          excalidrawAPI.getSceneElementsIncludingDeleted(),
          excalidrawAPI.getAppState(),
        ),
      },
      isExternalScene: true,
      id: roomLinkData.roomId,
      key: roomLinkData.roomKey,
    };
  } else if (scene) {
    return isExternalScene && jsonBackendMatch
      ? {
          scene,
          isExternalScene,
          id: jsonBackendMatch[1],
          key: jsonBackendMatch[2],
        }
      : { scene, isExternalScene: false };
  }
  return { scene: null, isExternalScene: false };
};

const detectedLangCode = languageDetector.detect() || defaultLang.code;
export const appLangCodeAtom = atom(
  Array.isArray(detectedLangCode) ? detectedLangCode[0] : detectedLangCode,
);

const ExcalidrawWrapper = (props: ExcalidrawAppProps) => {
  const [errorMessage, setErrorMessage] = useState("");
  const [langCode, setLangCode] = useAtom(appLangCodeAtom);
  const [roomStatus, setRoomStatus] = useAtom(roomStatusAtom);
  const isCollabDisabled = isRunningInIframe();
  const [currentSceneId] = useAtom(currentSceneIdAtom);
  const [isWebRTC] = useAtom(isWebRTCAtom);
  const [screenShareStream] = useAtom(screenShareStreamAtom);

  const [excalidrawAPI, excalidrawRefCallback] =
    useCallbackRefState<ExcalidrawImperativeAPI>();

  const [, setShareDialogState] = useAtom(shareDialogStateAtom);
  const [collabAPI] = useAtom(collabAPIAtom);
  const [isCollaborating] = useAtomWithInitialValue(isCollaboratingAtom, () => {
    return isCollaborationLink(window.location.href);
  });

  const currentExcalidrawElements = useRef<Array<ExcalidrawElement>>([]);
  const currentExcalidrawAppState = useRef<AppState | null>(null);
  const currentExcalidrawFiles = useRef<BinaryFiles | null>(null);
  const screenShareVideoRef = useRef<HTMLVideoElement>(null);

  if (props.roomData?.user) {
    userRef.setUser(props.roomData?.user);
  }

  // doSlide
  const refSlideList = useRef<{
    generateThumbnail: () => void;
    setSlide: (scenes: Scene[], index: number) => void;
    deleteScene: (id: string) => void;
  }>(null);

  // initial state
  // ---------------------------------------------------------------------------

  const initialStatePromiseRef = useRef<{
    promise: ResolvablePromise<ExcalidrawInitialDataState | null>;
  }>({ promise: null! });
  if (!initialStatePromiseRef.current.promise) {
    initialStatePromiseRef.current.promise =
      resolvablePromise<ExcalidrawInitialDataState | null>();
  }

  useEffect(() => {
    trackEvent("load", "frame", getFrame());
    // Delayed so that the app has a time to load the latest SW
    setTimeout(() => {
      trackEvent("load", "version", getVersion());
    }, VERSION_TIMEOUT);
  }, []);

  useEffect(() => {
    if (screenShareVideoRef.current && screenShareStream) {
      screenShareVideoRef.current.srcObject = screenShareStream;
    }
  }, [screenShareStream]);

  useHandleLibrary({
    excalidrawAPI,
    getInitialLibraryItems: getLibraryItemsFromStorage,
  });

  useEffect(() => {
    if (!excalidrawAPI || (!isCollabDisabled && !collabAPI)) {
      return;
    }

    slideRef.setExcalidrawAPI(excalidrawAPI);
    slideRef.setCollabAPI(collabAPI);

    const loadImages = (
      data: ResolutionType<typeof initializeScene>,
      isInitialLoad = false,
    ) => {
      if (!data.scene) {
        return;
      }
      if (collabAPI?.isCollaborating()) {
        if (data.scene.elements) {
          collabAPI
            .fetchImageFilesFromFirebase({
              elements: data.scene.elements,
              forceFetchFiles: true,
            })
            .then(({ loadedFiles, erroredFiles }) => {
              excalidrawAPI.addFiles(loadedFiles);
              updateStaleImageStatuses({
                excalidrawAPI,
                erroredFiles,
                elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
              });
            });
        }
      } else {
        const fileIds =
          data.scene.elements?.reduce((acc, element) => {
            if (isInitializedImageElement(element)) {
              return acc.concat(element.fileId);
            }
            return acc;
          }, [] as FileId[]) || [];

        if (data.isExternalScene) {
          loadFilesFromFirebase(
            `${FIREBASE_STORAGE_PREFIXES.shareLinkFiles}/${data.id}`,
            data.key,
            fileIds,
          ).then(({ loadedFiles, erroredFiles }) => {
            excalidrawAPI.addFiles(loadedFiles);
            updateStaleImageStatuses({
              excalidrawAPI,
              erroredFiles,
              elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
            });
          });
        } else if (isInitialLoad) {
          if (fileIds.length) {
            LocalData.fileStorage
              .getFiles(fileIds)
              .then(({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
          // on fresh load, clear unused files from IDB (from previous
          // session)
          LocalData.fileStorage.clearObsoleteFiles({ currentFileIds: fileIds });
        }
      }
    };

    initializeScene({
      collabAPI,
      excalidrawAPI,
      roomData: props.roomData || null,
      replay: props.replay,
      embed: props.embed,
    }).then(async (data) => {
      loadImages(data, /* isInitialLoad */ true);
      initialStatePromiseRef.current.promise.resolve(data.scene);
    });

    const onHashChange = async (event: HashChangeEvent) => {
      event.preventDefault();
      const libraryUrlTokens = parseLibraryTokensFromUrl();
      if (!libraryUrlTokens) {
        if (
          collabAPI?.isCollaborating() &&
          !isCollaborationLink(window.location.href)
        ) {
          collabAPI.stopCollaboration(false);
        }
        excalidrawAPI.updateScene({ appState: { isLoading: true } });

        initializeScene({
          collabAPI,
          excalidrawAPI,
          roomData: props.roomData || null,
          replay: props.replay,
          embed: props.embed,
        }).then((data) => {
          loadImages(data);
          if (data.scene) {
            excalidrawAPI.updateScene({
              ...data.scene,
              ...restore(data.scene, null, null, { repairBindings: true }),
              commitToHistory: true,
            });
          }
        });
      }
    };

    const titleTimeout = setTimeout(
      () => (document.title = APP_NAME),
      TITLE_TIMEOUT,
    );

    const syncData = debounce(() => {
      if (isTestEnv()) {
        return;
      }
      if (
        !document.hidden &&
        ((collabAPI && !collabAPI.isCollaborating()) || isCollabDisabled)
      ) {
        // don't sync if local state is newer or identical to browser state
        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_DATA_STATE)) {
          const localDataState = importFromLocalStorage();
          const username = importUsernameFromLocalStorage();
          let langCode = languageDetector.detect() || defaultLang.code;
          if (Array.isArray(langCode)) {
            langCode = langCode[0];
          }
          setLangCode(langCode);
          excalidrawAPI.updateScene({
            ...localDataState,
          });
          excalidrawAPI.updateLibrary({
            libraryItems: getLibraryItemsFromStorage(),
          });
          collabAPI?.setUsername(username || "");
        }

        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_FILES)) {
          const elements = excalidrawAPI.getSceneElementsIncludingDeleted();
          const currFiles = excalidrawAPI.getFiles();
          const fileIds =
            elements?.reduce((acc, element) => {
              if (
                isInitializedImageElement(element) &&
                // only load and update images that aren't already loaded
                !currFiles[element.fileId]
              ) {
                return acc.concat(element.fileId);
              }
              return acc;
            }, [] as FileId[]) || [];
          if (fileIds.length) {
            LocalData.fileStorage
              .getFiles(fileIds)
              .then(({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
        }
      }
    }, SYNC_BROWSER_TABS_TIMEOUT);

    const onUnload = () => {
      LocalData.flushSave();
    };

    const visibilityChange = (event: FocusEvent | Event) => {
      if (event.type === EVENT.BLUR || document.hidden) {
        LocalData.flushSave();
      }
      if (
        event.type === EVENT.VISIBILITY_CHANGE ||
        event.type === EVENT.FOCUS
      ) {
        syncData();
      }
    };

    window.addEventListener(EVENT.HASHCHANGE, onHashChange, false);
    window.addEventListener(EVENT.UNLOAD, onUnload, false);
    window.addEventListener(EVENT.BLUR, visibilityChange, false);
    document.addEventListener(EVENT.VISIBILITY_CHANGE, visibilityChange, false);
    window.addEventListener(EVENT.FOCUS, visibilityChange, false);
    return () => {
      window.removeEventListener(EVENT.HASHCHANGE, onHashChange, false);
      window.removeEventListener(EVENT.UNLOAD, onUnload, false);
      window.removeEventListener(EVENT.BLUR, visibilityChange, false);
      window.removeEventListener(EVENT.FOCUS, visibilityChange, false);
      document.removeEventListener(
        EVENT.VISIBILITY_CHANGE,
        visibilityChange,
        false,
      );
      clearTimeout(titleTimeout);
    };
  }, [isCollabDisabled, collabAPI, excalidrawAPI, setLangCode, props]);

  useEffect(() => {
    const unloadHandler = (event: BeforeUnloadEvent) => {
      LocalData.flushSave();

      if (
        excalidrawAPI &&
        LocalData.fileStorage.shouldPreventUnload(
          excalidrawAPI.getSceneElements(),
        )
      ) {
        preventUnload(event);
      }
    };
    window.addEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    return () => {
      window.removeEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    };
  }, [excalidrawAPI]);

  useEffect(() => {
    languageDetector.cacheUserLanguage(langCode);
  }, [langCode]);

  const [theme, setTheme] = useState<Theme>(
    () =>
      (localStorage.getItem(
        STORAGE_KEYS.LOCAL_STORAGE_THEME,
      ) as Theme | null) ||
      // FIXME migration from old LS scheme. Can be removed later. #5660
      importFromLocalStorage().appState?.theme ||
      THEME.LIGHT,
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.LOCAL_STORAGE_THEME, theme);
    // currently only used for body styling during init (see public/index.html),
    // but may change in the future
    document.documentElement.classList.toggle("dark", theme === THEME.DARK);
  }, [theme]);

  const onChange = async (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    // 녹화시 푸쉬
    recorderRef.pushDrawingElementsAction(elements, appState, files);

    if (collabAPI?.isCollaborating()) {
      collabAPI.syncElements(elements, currentSceneId);
    }

    setTheme(appState.theme);

    if (
      !isEqual(elements, currentExcalidrawElements.current) ||
      !isEqual(appState, currentExcalidrawAppState.current) ||
      !isEqual(files, currentExcalidrawFiles.current)
    ) {
      currentExcalidrawElements.current = elements as any;
      currentExcalidrawAppState.current = appState as any;
      currentExcalidrawFiles.current = files as any;

      await slideRef.setScene(
        {
          id: currentSceneId || "",
          drawing: {
            elements: elements as any,
          },
        },
        { isSync: false },
      );

      if (refSlideList.current) {
        refSlideList.current.generateThumbnail();
      }
    }
  };

  const [latestShareableLink, setLatestShareableLink] = useState<string | null>(
    null,
  );
  const [isOpen, setIsOpen] = useState(false);

  const handleSurveyClick = () => {
    const userRole = userRef.getUserRole();
    const surveyUrl =
      userRole === RoomUserRole.TEACHER
        ? "https://forms.gle/hq2JfAEbpcFFV69B7"
        : "https://forms.gle/oFrDyJveRCTVWd9MA";

    window.open(surveyUrl, "_blank");
    localStorage.clear();

    // setIsOpen(false);
    // window.location.href = "https://syncblock.net/";
  };

  const onExportToBackend = async (
    exportedElements: readonly NonDeletedExcalidrawElement[],
    appState: Partial<AppState>,
    files: BinaryFiles,
  ) => {
    if (exportedElements.length === 0) {
      throw new Error(t("alerts.cannotExportEmptyCanvas"));
    }
    try {
      const { url, errorMessage } = await exportToBackend(
        exportedElements,
        {
          ...appState,
          viewBackgroundColor: appState.exportBackground
            ? appState.viewBackgroundColor
            : getDefaultAppState().viewBackgroundColor,
        },
        files,
      );

      if (errorMessage) {
        throw new Error(errorMessage);
      }

      if (url) {
        setLatestShareableLink(url);
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        const { width, height } = appState;
        console.error(error, {
          width,
          height,
          devicePixelRatio: window.devicePixelRatio,
        });
        throw new Error(error.message);
      }
    }
  };

  const renderCustomStats = (
    elements: readonly NonDeletedExcalidrawElement[],
    appState: UIAppState,
  ) => {
    return (
      <CustomStats
        setToast={(message) => excalidrawAPI!.setToast({ message })}
        appState={appState}
        elements={elements}
      />
    );
  };

  const onLibraryChange = async (items: LibraryItems) => {
    if (!items.length) {
      localStorage.removeItem(STORAGE_KEYS.LOCAL_STORAGE_LIBRARY);
      return;
    }
    const serializedItems = JSON.stringify(items);
    localStorage.setItem(STORAGE_KEYS.LOCAL_STORAGE_LIBRARY, serializedItems);
  };

  const isOffline = useAtomValue(isOfflineAtom);

  const onCollabDialogOpen = useCallback(
    () => setShareDialogState({ isOpen: true, type: "collaborationOnly" }),
    [setShareDialogState],
  );

  useEffect(() => {
    if (props.replay) {
      setRoomStatus(RoomStatus.STUDYING);
    }
  }, [props, setRoomStatus]);

  useEffect(() => {
    if (props.replay && collabAPI && excalidrawAPI) {
      playerRef.fetchRecord(props.roomData?.roomId || "");
    }
  }, [props, collabAPI, excalidrawAPI]);

  useEffect(() => {
    if (roomStatus === RoomStatus.ENDED) {
      location.href = "https://syncblock.net/";
    }
  }, [roomStatus]);

  useLayoutEffect(() => {
    if (!!sessionStorage.getItem("name")) {
      setRoomStatus(RoomStatus.STUDYING);
    }
  }, [setRoomStatus]);

  const webRtcUsers = useAtomValue(webRTCUsersAtom);
  const socketUsers = useAtomValue(socketUsersAtom);
  const [socket] = useAtom(socketAtom);
  const divRef = useRef(null);

  useEffect(() => {
    const hashWebRtcUsers: { [key: string]: WebRTCUser } = {};
    webRtcUsers.forEach((user) => {
      hashWebRtcUsers[user.socketId] = user;
    });
  }, [socket, socketUsers, webRtcUsers]);

  useEffect(() => {
    if (socket && userRef.getUserRole() === RoomUserRole.STUDENT) {
      socket.on("roomClosed", () => {
        const surveyUrl = "https://forms.gle/oFrDyJveRCTVWd9MA";
        window.location.href = surveyUrl;
      });

      return () => {
        socket.off("roomClosed");
      };
    }
  }, [socket]);

  useEffect(() => {
    if (
      roomStatus === RoomStatus.ENDED &&
      userRef.getUserRole() === RoomUserRole.STUDENT
    ) {
      const surveyUrl = "https://forms.gle/oFrDyJveRCTVWd9MA";
      window.location.href = surveyUrl;
    }
  }, [roomStatus]);

  const closeRoom = useCallback(() => {
    if (collabAPI) {
      collabAPI.getPortal().broadcastCloseRoom();
      setRoomStatus(RoomStatus.ENDED);
      if (userRef.getUserRole() === RoomUserRole.TEACHER) {
        setIsOpen(true); // 팝업창 열기 (선생님용)
      } else {
        const surveyUrl = "https://forms.gle/oFrDyJveRCTVWd9MA";
        window.location.href = surveyUrl; // 학생 설문 페이지로 이동
      }
    }
  }, [collabAPI, setRoomStatus]);

  // browsers generally prevent infinite self-embedding, there are
  // cases where it still happens, and while we disallow self-embedding
  // by not whitelisting our own origin, this serves as an additional guard
  if (isSelfEmbedding) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          height: "100%",
        }}
      >
        <h1>I'm not a pretzel!</h1>
      </div>
    );
  }

  return (
    <>
      <div
        style={{ height: "100%", display: "flex" }}
        className={clsx("excalidraw-app", {
          "is-collaborating": isCollaborating,
        })}
      >
        <>
          {roomStatus === RoomStatus.STUDYING && (
            <div className="whiteboard-wrap">
              <div className="whiteboard-header">
                <div className="whiteboard-info">
                  <div className="room-author">
                    {props.roomData?.author || "Syncblock"}
                  </div>
                  {props.roomData?.name && (
                    <div className="room-name">{props.roomData?.name}</div>
                  )}
                </div>
                <div className="whiteboard-controls">
                  {props.replay ? (
                    <Recorder />
                  ) : (
                    <WhiteboardControls divRef={divRef} />
                  )}
                </div>

                <div className="whiteboard-actions">
                  {props.replay ? (
                    <button
                      type="button"
                      className="btn btn-link btn-with-icon btn-bg-trans-white"
                      onClick={() => {
                        window.close();
                      }}
                    >
                      <i className="wb-icon wb-icon-sign-out"></i> 다시보기 종료
                    </button>
                  ) : (
                    <>
                      {userRef.getUserRole() === RoomUserRole.TEACHER && (
                        <Button
                          onClick={() =>
                            setShareDialogState({ isOpen: true, type: "share" })
                          }
                        >
                          학생 초대하기
                        </Button>
                      )}

                      {userRef.getUserRole() === RoomUserRole.TEACHER && (
                        <button
                          type="button"
                          className="btn btn-link btn-with-icon btn-bg-trans-white"
                          onClick={() => {
                            setIsOpen(true);
                            sessionStorage.clear();
                          }}
                        >
                          <i className="wb-icon wb-icon-sign-out"></i> 수업
                          종료하기
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="whiteboard-body">
                <SlideList
                  excalidrawAPI={excalidrawAPI}
                  collabAPI={collabAPI}
                  replay={props.replay}
                  ref={refSlideList}
                />

                <div className="whiteboard-main" ref={divRef}>
                  <Excalidraw
                    excalidrawAPI={excalidrawRefCallback}
                    onChange={onChange}
                    initialData={initialStatePromiseRef.current.promise}
                    isCollaborating={isCollaborating}
                    onPointerUpdate={
                      userRef.getUserRole() === RoomUserRole.SPECTATOR
                        ? () => {}
                        : collabAPI?.onPointerUpdate
                    }
                    viewModeEnabled={
                      props.replay ||
                      userRef.getUserRole() === RoomUserRole.SPECTATOR
                        ? true
                        : undefined
                    }
                    UIOptions={{
                      canvasActions: {
                        toggleTheme: true,
                        export: {
                          onExportToBackend,
                          renderCustomUI: (elements, appState, files) => {
                            return (
                              <ExportToExcalidrawPlus
                                elements={elements}
                                appState={appState}
                                files={files}
                                onError={(error) => {
                                  excalidrawAPI?.updateScene({
                                    appState: {
                                      errorMessage: error.message,
                                    },
                                  });
                                }}
                                onSuccess={() => {
                                  excalidrawAPI?.updateScene({
                                    appState: { openDialog: null },
                                  });
                                }}
                              />
                            );
                          },
                        },
                      },
                    }}
                    langCode={langCode}
                    renderCustomStats={renderCustomStats}
                    detectScroll={false}
                    handleKeyboardGlobally={true}
                    onLibraryChange={onLibraryChange}
                    autoFocus={true}
                    theme={theme}
                    // renderTopRightUI={(isMobile) => {
                    //   if (isMobile || !collabAPI || isCollabDisabled) {
                    //     return null;
                    //   }
                    //   return (
                    //     <LiveCollaborationTrigger
                    //       isCollaborating={isCollaborating}
                    //       onSelect={() =>
                    //         setShareDialogState({ isOpen: true, type: "share" })
                    //       }
                    //     />
                    //   );
                    // }}
                  >
                    <AppMainMenu
                      onCollabDialogOpen={onCollabDialogOpen}
                      isCollaborating={isCollaborating}
                      isCollabEnabled={!isCollabDisabled}
                    />
                    {/* <AppWelcomeScreen
          onCollabDialogOpen={onCollabDialogOpen}
          isCollabEnabled={!isCollabDisabled}
        /> */}
                    <OverwriteConfirmDialog>
                      <OverwriteConfirmDialog.Actions.ExportToImage />
                      <OverwriteConfirmDialog.Actions.SaveToDisk />
                      {excalidrawAPI && (
                        <OverwriteConfirmDialog.Action
                          title={t(
                            "overwriteConfirm.action.excalidrawPlus.title",
                          )}
                          actionLabel={t(
                            "overwriteConfirm.action.excalidrawPlus.button",
                          )}
                          onClick={() => {
                            exportToExcalidrawPlus(
                              excalidrawAPI.getSceneElements(),
                              excalidrawAPI.getAppState(),
                              excalidrawAPI.getFiles(),
                            );
                          }}
                        >
                          {t(
                            "overwriteConfirm.action.excalidrawPlus.description",
                          )}
                        </OverwriteConfirmDialog.Action>
                      )}
                    </OverwriteConfirmDialog>
                    {/* <AppFooter /> */}
                    <TTDDialog
                      onTextSubmit={async (input) => {
                        try {
                          const response = await fetch(
                            `${
                              import.meta.env.VITE_APP_AI_BACKEND
                            }/v1/ai/text-to-diagram/generate`,
                            {
                              method: "POST",
                              headers: {
                                Accept: "application/json",
                                "Content-Type": "application/json",
                              },
                              body: JSON.stringify({ prompt: input }),
                            },
                          );

                          const rateLimit = response.headers.has(
                            "X-Ratelimit-Limit",
                          )
                            ? parseInt(
                                response.headers.get("X-Ratelimit-Limit") ||
                                  "0",
                                10,
                              )
                            : undefined;

                          const rateLimitRemaining = response.headers.has(
                            "X-Ratelimit-Remaining",
                          )
                            ? parseInt(
                                response.headers.get("X-Ratelimit-Remaining") ||
                                  "0",
                                10,
                              )
                            : undefined;

                          const json = await response.json();

                          if (!response.ok) {
                            if (response.status === 429) {
                              return {
                                rateLimit,
                                rateLimitRemaining,
                                error: new Error(
                                  "Too many requests today, please try again tomorrow!",
                                ),
                              };
                            }

                            throw new Error(
                              json.message || "Generation failed...",
                            );
                          }

                          const generatedResponse = json.generatedResponse;
                          if (!generatedResponse) {
                            throw new Error("Generation failed...");
                          }

                          return {
                            generatedResponse,
                            rateLimit,
                            rateLimitRemaining,
                          };
                        } catch (err: any) {
                          throw new Error("Request failed");
                        }
                      }}
                    />
                    <TTDDialogTrigger />
                    {isCollaborating && isOffline && (
                      <div className="collab-offline-warning">
                        {t("alerts.collabOfflineWarning")}
                      </div>
                    )}
                    {latestShareableLink && (
                      <ShareableLinkDialog
                        link={latestShareableLink}
                        onCloseRequest={() => setLatestShareableLink(null)}
                        setErrorMessage={setErrorMessage}
                      />
                    )}
                    {excalidrawAPI && !isCollabDisabled && (
                      <Collab excalidrawAPI={excalidrawAPI} />
                    )}

                    <ShareDialog
                      collabAPI={collabAPI}
                      onExportToBackend={async () => {
                        if (excalidrawAPI) {
                          try {
                            await onExportToBackend(
                              excalidrawAPI.getSceneElements(),
                              excalidrawAPI.getAppState(),
                              excalidrawAPI.getFiles(),
                            );
                          } catch (error: any) {
                            setErrorMessage(error.message);
                          }
                        }
                      }}
                    />

                    {errorMessage && (
                      <ErrorDialog onClose={() => setErrorMessage("")}>
                        {errorMessage}
                      </ErrorDialog>
                    )}
                  </Excalidraw>

                  <Loading />
                  <DeviceDialogWrapper {...props} />
                </div>
                {!props.replay && isWebRTC && (
                  <div className="whiteboard-webrtc">
                    <Suspense fallback={<WebRTCLoading />}>
                      {props.engine === "janus" ? (
                        <WebRTCJanus></WebRTCJanus>
                      ) : (
                        <WebRTC></WebRTC>
                      )}
                    </Suspense>
                  </div>
                )}
              </div>
            </div>
          )}
          {roomStatus === RoomStatus.READY && (
            <div className="whiteboard-wrap">
              <div className="setting">
                <SettingForm
                  title={props.roomData?.name}
                  isEditName={!props.roomData?.user?.name}
                  videoMode="basic"
                  isCancel={false}
                  okBtnName="수업 시작"
                  events={{
                    onOk: () => {
                      setRoomStatus(RoomStatus.STUDYING);
                      location.reload();
                    },
                  }}
                ></SettingForm>
              </div>
            </div>
          )}
          {/* {roomStatus === RoomStatus.ENDED && (
            <div className="whiteboard-wrap">수업이 종료되었습니다.</div>
          )} */}
        </>
      </div>
      <Modal isOpen={isOpen} setIsOpen={setIsOpen}>
        <ModalContainer>
          <Xbutton onClick={() => setIsOpen(false)}>
            <svg
              width="24px"
              height="24px"
              stroke-width="1.5"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              color="#000"
            >
              <path
                d="M6.75827 17.2426L12.0009 12M17.2435 6.75736L12.0009 12M12.0009 12L6.75827 6.75736M12.0009 12L17.2435 17.2426"
                stroke="#000"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              ></path>
            </svg>
          </Xbutton>
          <ModalTitle>
            싱크블록을 이용해보시니 어떠셨나요?
            <br />
            서비스를 이용하신 경험을 저희에게 공유해주세요.
            <br />더 좋은 서비스를 만드는데 도움이 되며,
            <br />
            추첨을 통해 상품 획득의 기회도 받으실 수 있습니다.
          </ModalTitle>
          <ButtonWrapper>
            <CloseButton
              onClick={() => {
                closeRoom();
              }}
            >
              다음에 참여하기
            </CloseButton>
            <SurveyButton onClick={handleSurveyClick}>
              설문 참여하기
            </SurveyButton>
          </ButtonWrapper>
        </ModalContainer>
      </Modal>
    </>
  );
};

const defaultExcalidrawAppProps: ExcalidrawAppProps = {
  roomData: {
    roomId: "",
    roomKey: "",
    user: !!sessionStorage.getItem("name")
      ? { userId: "", name: sessionStorage.getItem("name") || "" }
      : null,
    author: "",
    name: "",
  },
  replay: false,
  embed: false,
  engine: "webrtc",
};
const ExcalidrawApp = (propsIn: ExcalidrawAppProps) => {
  const props = { ...defaultExcalidrawAppProps, ...propsIn };
  return (
    <TopErrorBoundary>
      <Provider unstable_createStore={() => appJotaiStore}>
        <ExcalidrawWrapper {...props} />
      </Provider>
    </TopErrorBoundary>
  );
};

const ModalContainer = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: center;
  padding: 32px 36px;
  border-radius: 16px;
  background: #fff;
  gap: 28px;
`;

const ModalTitle = styled.div`
  font-size: 16px;
  font-weight: 600;
  text-align: center;
  line-height: 22px;
  font-weight: 400;
`;

const CloseButton = styled.div`
  width: 136px;
  height: 36px;
  display: flex;
  justify-content: center;
  align-items: center;
  background: #f54260;
  border-radius: 8px;
  color: #fff !important;
  cursor: pointer;
  font-size: 14px;
`;

const Button = styled.div`
  width: 136px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #0fb884;
  border-color: #0fb884;
  color: #fff;
  cursor: pointer;
  border-radius: 6px;
  svg {
    color: #fff;
  }

  &:hover,
  &:active {
    background-color: #0fb884;
    border-color: #0fb884;
  }
`;

const ButtonWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
`;

const SurveyButton = styled.div`
  width: 110px;
  height: 36px;
  display: flex;
  justify-content: center;
  align-items: center;
  background: #5d61ea;
  border-radius: 8px;
  color: #fff !important;
  cursor: pointer;
  font-size: 14px;
`;

const Xbutton = styled.div`
  width: 100%;
  display: flex;
  justify-content: flex-end;
  position: relative;
  align-self: right;

  & > svg {
    width: 24px;
    height: 24px;
    cursor: pointer;
  }
`;

export default ExcalidrawApp;

export { RoomUserRole };
export type { ExcalidrawAppProps };
