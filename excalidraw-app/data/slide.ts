import { throttle } from "lodash";
import { nanoid } from "nanoid";
import type { Socket } from "socket.io-client";
import {
  convertToExcalidrawElements,
  getCommonBounds,
  zoomToFitBounds,
} from "../../packages/excalidraw";
import { FileId } from "../../packages/excalidraw/element/types";
import {
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "../../packages/excalidraw/types";
import { exportToCanvas } from "../../packages/utils/export";
import { appJotaiStore } from "../app-jotai";
import { CollabAPI } from "../collab/Collab";
import loaderSingleton from "../data/LoaderSingleton";
import { readImage } from "../data/pdf";
import { isLoadingAtom, loadingUIAtom } from "../loading/atom";
import { currentIndexAtom, currentSceneIdAtom, slideAtom } from "./atoms";
import { loadSlideFromFirebase } from "./firebase";
import recorderRef from "./recorder";
import { Drawing, Scene } from "./types";

class SlideRef {
  private static instance: SlideRef;

  protected excalidrawAPI: ExcalidrawImperativeAPI | null;
  protected collabAPI: CollabAPI | null;

  // new 클래스 구문 사용 제한을 목적으로
  // constructor() 함수 앞에 private 접근 제어자 추가
  private constructor() {
    this.excalidrawAPI = null;
    this.collabAPI = null;
  }

  public createScene = async (
    drawing: Drawing,
    id?: string | null,
    size?: { width: number; height: number },
  ): Promise<Scene | undefined> => {
    return {
      id: id ? id : nanoid(),
      drawing,
    };
    // const canvas = await exportToCanvas(
    //   Object.assign(drawing, { maxWidthOrHeight: 128 }),
    // );
    // const width = canvas.width || (size ? size.width : canvas.width);
    // const height = canvas.height || (size ? size.height : canvas.height);
    // if (!width || !height) {
    //   return;
    // }
    // const ctx = canvas.getContext("2d");
    // if (ctx) {
    //   return {
    //     id: id ? id : nanoid(),
    //     width,
    //     height,
    //     imageUrl: canvas.toDataURL("image/png"),
    //     drawing,
    //   };
    // }
  };

  public getExcalidrawAPI = () => {
    return this.excalidrawAPI;
  };

  public setExcalidrawAPI = (excalidrawAPI: ExcalidrawImperativeAPI) => {
    this.excalidrawAPI = excalidrawAPI;
  };

  public getCollabAPI = () => {
    return this.collabAPI;
  };

  public setCollabAPI = (collabAPI: CollabAPI | null) => {
    this.collabAPI = collabAPI;
  };

  public getSlide = () => {
    return appJotaiStore.get(slideAtom);
  };

  public setSlide = async (
    scenes: Scene[],
    opt: {
      isSlideSync?: boolean;
      isFit?: boolean;
      focusIndex?: number;
    } = {
      isSlideSync: false,
      isFit: false,
    },
  ) => {
    let selectedIndex = null;
    await appJotaiStore.set(slideAtom, scenes);

    if (opt.focusIndex !== undefined) {
      const scene = scenes[opt.focusIndex >= 0 ? opt.focusIndex : 0] || null;
      selectedIndex = scene ? (opt.focusIndex >= 0 ? opt.focusIndex : 0) : 0;
      if (scene) {
        await this.drawScene(selectedIndex, {
          isReset: true,
          isSync: false,
          isFit: opt.isFit,
        });
        if (
          opt.isSlideSync &&
          this.excalidrawAPI &&
          this.collabAPI &&
          this.collabAPI.isCollaborating()
        ) {
          await this.collabAPI.syncSlideWithWait(
            scenes,
            Object.keys(this.excalidrawAPI.getFiles()) as unknown as FileId[],
            selectedIndex !== null ? selectedIndex.toString() : "",
          );
        }
      }
    }
  };

  public setCurrentIndex = async (index: number) => {
    await appJotaiStore.set(currentIndexAtom, index);
  };

  public getCurrentIndex = async () => {
    return await appJotaiStore.get(currentIndexAtom);
  };

  public getFindIndex = async (id: string) => {
    const slide = await this.getSlide();
    return slide?.findIndex((scene) => scene.id === id);
  };

  public getFindId = async (index: number) => {
    const slide = await this.getSlide();
    if (slide && slide[index]) {
      return slide[index].id;
    }
    return null;
  };

  public setCurrentSceneId = async (id: string) => {
    await appJotaiStore.set(currentSceneIdAtom, id);
  };

  public getCurrentSceneId = async () => {
    return await appJotaiStore.get(currentSceneIdAtom);
  };

  public getCurrentScene = async () => {
    const index = await this.getCurrentIndex();
    return this.getScene(index || 0);
  };

  public getScene = async (index: number) => {
    const slide = await this.getSlide();
    return slide && typeof index === "number" && slide[index]
      ? slide[index]
      : null;
  };

  public setScene = async (
    scene: Scene,
    opt: { isFocus?: boolean; index?: number; isSync?: boolean } = {
      isFocus: false,
      isSync: false,
    },
  ) => {
    const slide = await this.getSlide();
    const searchIndex = opt.index || (await this.getCurrentIndex());
    const findIndex =
      slide && searchIndex !== undefined && slide[searchIndex]
        ? searchIndex
        : null;
    if (slide && findIndex !== null) {
      // await appJotaiStore.set(slideAtom, (prev) => {
      //   return prev.map((item, index) => {
      //     if (index === findIndex) {
      //       return { ...item, scene };
      //     }
      //     return item;
      //   });
      // });

      //   await this.setSlide([
      //     ...slide.slice(0, findIndex),
      //     scene,
      //     ...slide.slice(findIndex + 1),
      //   ]);
      // 변경 이벤트 처리 안되게 바꾸기
      slide[findIndex] = scene;
      await this.setSlide(slide);
      if (opt.isFocus) {
        await this.drawScene(findIndex, { isSync: opt.isSync });
      }
    }
  };

  public onChangeCurrentScene = async (scene: Scene) => {
    if (this.excalidrawAPI) {
      // 협업 활성화시 동기화 (씬 전환)
      if (this.collabAPI && this.collabAPI.isCollaborating()) {
        this.collabAPI.syncElements(scene.drawing.elements, scene.id);
      }
    }
    this.setScene(scene);
  };

  protected drawScene = async (
    index: number,
    opt: {
      isReset?: boolean;
      isSync?: boolean;
      isFit?: boolean;
    } = {
      isReset: false,
      isSync: false,
      isFit: false,
    },
  ) => {
    const slide = await this.getSlide();
    const searchIndex =
      typeof index === "number" ? index : await this.getCurrentIndex();
    const findIndex =
      slide && searchIndex !== undefined && slide[searchIndex]
        ? searchIndex
        : null;

    if (slide && findIndex !== null) {
      const findScene = slide[findIndex];
      if (this.excalidrawAPI) {
        this.setCurrentSceneId(findScene.id);
        this.setCurrentIndex(findIndex);
        const appState = this.excalidrawAPI.getAppState();

        if (opt.isReset) {
          this.excalidrawAPI.resetScene();
        }

        // 협업 활성화시 동기화 (씬 전환)
        if (opt.isSync && this.collabAPI && this.collabAPI.isCollaborating()) {
          if (opt.isReset) {
            this.collabAPI.syncElementsWithReset(
              findScene.drawing.elements,
              findScene.id,
              findIndex,
            );
          } else {
            this.collabAPI.syncElements(
              findScene.drawing.elements,
              findScene.id,
            );
          }
        }

        if (opt.isFit) {
          // zoom to fit viewport
          const fitBoundsAppState = zoomToFitBounds({
            appState,
            bounds: getCommonBounds(findScene.drawing.elements),
            fitToViewport: true,
            viewportZoomFactor: 1,
          }).appState;

          this.excalidrawAPI.updateScene({
            elements: findScene.drawing.elements,
            appState: fitBoundsAppState,
            commitToHistory: true,
          });
        } else {
          this.excalidrawAPI.updateScene({
            elements: findScene.drawing.elements,
            appState,
            commitToHistory: true,
          });
        }
      }
    }
  };

  public selectScene = async (
    index: number,
    opt: {
      isSync?: boolean;
    } = {
      isSync: false,
    },
  ) => {
    this.drawScene(index, { isReset: true, isSync: opt.isSync, isFit: true });
    // 녹화시 푸쉬
    recorderRef.pushChangeSceneAction(index);
  };

  public removeScene = async (
    id: string,
    opt: {
      isSync?: boolean;
    } = {
      isSync: false,
    },
  ) => {
    const slide = await this.getSlide();
    const currentIndex = await this.getCurrentIndex();
    if (slide) {
      const index = slide.findIndex((sc) => sc.id === id);
      if (index >= 0) {
        const remainingScenes = slide.length - 1;
        if (remainingScenes > 0) {
          let newCurrent;
          if (currentIndex !== undefined) {
            const deletingCurrentScene = index === currentIndex;
            if (deletingCurrentScene) {
              newCurrent = {
                index: Math.max(currentIndex - 1, 0),
              };
            }
            await this.setSlide(slide.filter((scene) => scene.id !== id));
            if (newCurrent) {
              await this.selectScene(newCurrent.index, { isSync: false });
            }
            if (
              opt.isSync &&
              this.collabAPI &&
              this.collabAPI.isCollaborating()
            ) {
              this.collabAPI.broadcastSceneDeleted(id);
            }
          }
        }
      }
    }
  };

  public removeScenes = async (
    deleteIndexs: number[],
    opt: {
      isSync?: boolean;
    } = {
      isSync: false,
    },
  ) => {
    const slide = await this.getSlide();
    const sceneId = await this.getCurrentSceneId();
    if (slide && sceneId) {
      const removedSceneIds = new Array<string>();
      const tempSlide = [...slide];
      for (const index of deleteIndexs) {
        if (slide[index]) {
          removedSceneIds.push(slide[index].id);
          tempSlide.splice(index, 1);
        }
      }
      const findIndex = tempSlide.findIndex((scene) => scene.id === sceneId);
      await this.setSlide([...tempSlide], {
        focusIndex: findIndex >= 0 ? findIndex : 0,
      });
      /**
       * TODO: 브로드캐스트 여러개 삭제 구현
       */
      if (
        opt.isSync &&
        this.collabAPI &&
        this.collabAPI.isCollaborating() &&
        removedSceneIds.length > 0
      ) {
        this.collabAPI.broadcastSceneDeleted(removedSceneIds[0]);
      }
    }
  };

  public imagesToSlide = async (images: string[]) => {
    const tmpScenes = new Array<Scene>();
    const addFiles = new Array<BinaryFileData>();
    for (const image of images) {
      const size = await readImage(image as string);
      if (size) {
        const fileId = nanoid(40);
        const now = Date.now();
        const files: BinaryFiles | null = {};
        files[fileId] = {
          created: now,
          dataURL: image,
          id: fileId,
          lastRetrieved: now,
          mimeType: "image/png",
        } as any;
        const elements = convertToExcalidrawElements([
          {
            type: "image",
            fileId,
            width: size.width,
            height: size.height,
            x: 0,
            y: 0,
            locked: true,
          } as any,
        ]);

        const thisFiles = new Array<BinaryFileData>();
        for (const key in files) {
          thisFiles.push(files[key]);
          addFiles.push(files[key]);
        }
        const scene = await this.createScene({
          elements,
        } as Drawing);
        if (scene) {
          tmpScenes.push(scene);
        }
      }
    }
    return {
      slide: tmpScenes,
      files: addFiles,
    };
  };

  public createThumb = async (index: number) => {
    const scene = await this.getScene(index);
    if (scene) {
      // const timerName = `create_thumb_${index + 1}_${nanoid()}`;
      // console.time(timerName);
      const drawing: Drawing = {
        elements: scene.drawing?.elements || [],
      } as Drawing;
      const canvas = await exportToCanvas(
        Object.assign(
          {
            ...drawing,
            appState: this.excalidrawAPI?.getAppState() || {},
            files: this.excalidrawAPI?.getFiles() || null,
          },
          { maxWidthOrHeight: 320 }, // 128
        ),
      );
      // console.timeEnd(timerName);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        return canvas.toDataURL("image/png");
      }

      return null;
    }
  };

  public createThumbThrottle = throttle(async (index: number) => {
    const scene = await this.getScene(index);
    if (scene) {
      const drawing: Drawing = {
        elements: scene.drawing?.elements || [],
      } as Drawing;
      const canvas = await exportToCanvas(
        Object.assign(
          {
            ...drawing,
            appState: this.excalidrawAPI?.getAppState() || {},
            files: this.excalidrawAPI?.getFiles() || null,
          },
          { maxWidthOrHeight: 128 },
        ),
      );
      const width = 128;
      const height = 128;
      if (!width || !height) {
        return;
      }
      const ctx = canvas.getContext("2d");
      if (ctx) {
        return canvas.toDataURL("image/png");
      }

      return null;
    }
  }, 5000);

  // 딜레이
  private delay = async (ms: number) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
  };

  // 슬라이드 초기화
  public loadRoomSlideData = async (opts: {
    roomId: string;
    roomKey: string;
    socket: Socket | null;
  }) => {
    // 로딩 표시
    appJotaiStore.set(loadingUIAtom, {
      icon: "pdf",
      message: "페이지를 로드하고 있습니다.",
    });
    appJotaiStore.set(isLoadingAtom, true);

    try {
      const slide: {
        slides: Scene[];
        fileIds: readonly FileId[];
        currentSceneId: string;
      } | null = await loadSlideFromFirebase(opts.roomId, opts.roomKey, null);

      // 파일 로드
      if (slide && slide.fileIds.length > 0) {
        if (this.collabAPI && this.excalidrawAPI) {
          const { loadedFiles } = await this.collabAPI
            .getFileManager()
            .getFiles([...slide.fileIds]);
          await this.excalidrawAPI.setFiles(
            loadedFiles.length > 0 ? loadedFiles : [],
          );
        }
      }

      if (slide && slide.slides) {
        let currentIndex = slide.currentSceneId
          ? slide.slides.findIndex((scene) => scene.id === slide.currentSceneId)
          : 0;
        currentIndex = Math.max(currentIndex, 0);

        const scene = slide.slides[currentIndex] || null;
        const selectedIndex = scene ? currentIndex : 0;

        // 해당 슬라이드 그리기
        await this.setSlide(slide.slides, {
          focusIndex: selectedIndex,
          isFit: true,
        });

        // 끝나기 전에 딜레이 살짝 줘야 렌더링이 재대로 되서 넣음
        await this.delay(100);

        loaderSingleton.setIsSlide(true);

        return {
          elements: scene && scene.drawing ? scene.drawing.elements : [],
          scrollToContent: true,
          slide,
        };
      }
    } catch (error: any) {
      // log the error and move on. other peers will sync us the scene.
      console.error(error);
    } finally {
      appJotaiStore.set(isLoadingAtom, false);
    }
  };

  // 오직 getInstance() 스태틱 메서드를 통해서만
  // 단 하나의 객체를 생성할 수 있습니다.
  public static getInstance() {
    if (!SlideRef.instance) {
      SlideRef.instance = new SlideRef();
    }
    return SlideRef.instance;
  }
}

export default SlideRef.getInstance();
