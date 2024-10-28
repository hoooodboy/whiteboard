import {
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
  ChangeEvent,
  useMemo,
  useCallback,
  useState,
} from "react";

import styled from "styled-components";
import { Scene as SceneType } from "../data/types";
import { ExcalidrawImperativeAPI } from "../../packages/excalidraw/types";
import Scene, { SceneRef } from "./Scene";
import { CollabAPI } from "../collab/Collab";
import { useAtom } from "jotai";
import { currentIndexAtom, loadedSlideAtom, slideAtom } from "../data/atoms";
import { loadingUIAtom, isLoadingAtom } from "../loading/atom";

import { RoomUserRole } from "../data/types";
import userRef from "../data/user";

import { getPdf2pngServer } from "../data/pdf";
import slideRef from "../data/slide";
import { debounce } from "../../packages/excalidraw/utils";

type Props = {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  collabAPI: CollabAPI | null;
  replay?: boolean;
};

enum Initialisation {
  NotStarted,
  Started,
  Complete,
}

const SlideList = forwardRef(
  ({ excalidrawAPI, collabAPI, replay }: Props, ref) => {
    useImperativeHandle(ref, () => ({
      generateThumbnail,
      setSlide,
      deleteScene,
    }));

    const initialisedRef = useRef<Initialisation>(Initialisation.NotStarted);
    const [currentIndex] = useAtom(currentIndexAtom);
    const [scenes] = useAtom(slideAtom);
    const [isLoadedSlide] = useAtom(loadedSlideAtom);
    // const [drawing, setDrawing] = useState<Drawing | undefined>();
    const [, setIsLoading] = useAtom(isLoadingAtom);
    const [, setLoadingUI] = useAtom(loadingUIAtom);

    const scenesWrapper = useRef<HTMLDivElement>(null);
    const selectFile = useRef<HTMLInputElement>(null);
    const childRefs = useRef<Array<SceneRef | null>>([]);

    // 슬라이드 이동
    useEffect(() => {
      // const scenesWrapperWidth = scenesWrapper.current?.offsetWidth || 0;
      const scenesWrapperHeight = scenesWrapper.current?.offsetHeight || 0;
      // const sceneWidth = 304;
      const sceneHeight = 172;
      scenesWrapper.current?.scrollTo({
        // top: 0,
        // left: currentIndex
        //   ? currentIndex * sceneWidth - (scenesWrapperWidth / 2 - sceneWidth / 2)
        //   : 0,
        top: currentIndex
          ? currentIndex * sceneHeight -
            (scenesWrapperHeight / 2 - sceneHeight / 2)
          : 0,
        left: 0,
        behavior: "smooth",
      });
    }, [currentIndex]);

    const generateThumbnail = useCallback(async () => {
      if (currentIndex && childRefs.current[currentIndex]) {
        childRefs.current[currentIndex]?.generateThumbnail();
      }
    }, [childRefs, currentIndex]);

    const setSlide = async (scenes: SceneType[], index: number) => {
      slideRef.setSlide(scenes, { focusIndex: index, isFit: true });
    };

    const moveToScene = (index: number) => {
      slideRef.selectScene(index, { isSync: true });
    };

    useEffect(() => {
      if (initialisedRef.current === Initialisation.NotStarted) {
        initialisedRef.current = Initialisation.Started;
        (async () => {
          initialisedRef.current = Initialisation.Complete;
        })();
      }
    }, []);

    const startSocket = useMemo(
      () =>
        debounce(() => {
          if (collabAPI) {
            collabAPI.startSocket();
          }
        }, 1000),
      [collabAPI],
    );

    useEffect(() => {
      if (collabAPI && isLoadedSlide && !collabAPI.isConnectedSocket()) {
        startSocket();
      }
      return () => {
        startSocket.cancel(); // cleanup 시 debounce된 함수 취소
      };
    }, [startSocket, isLoadedSlide, collabAPI]);

    const deleteScene = (id: string) => {
      slideRef.removeScene(id, { isSync: true });
    };

    const selectFileOnChanged = async (
      event: ChangeEvent<HTMLInputElement>,
    ) => {
      try {
        // loading 스타트
        setLoadingUI({
          icon: "pdf",
          message: "PDF를 불러오는 중입니다.",
        });
        setIsLoading(true);

        const file = event.target.files && event.target.files[0];
        if (file) {
          // 대기 걸기
          if (excalidrawAPI && collabAPI) {
            collabAPI.broadcastSlideWaiting();
          }

          // server
          const images = await getPdf2pngServer(file);

          setLoadingUI({
            icon: "pdf",
            message: "슬라이드를 추가하고 있습니다.",
          });
          const { slide, files } = await slideRef.imagesToSlide(images);
          if (slide && slide.length > 0) {
            if (excalidrawAPI) {
              await excalidrawAPI?.setFiles(files);
            }
            setLoadingUI({
              icon: "pdf",
              message: "슬라이드를 동기화 하고 있습니다.",
            });

            await slideRef.setSlide(slide, {
              focusIndex: 0,
              isSlideSync: true,
              isFit: true,
            });
          }
        }
      } catch (e) {
        // 대기 걸기
        if (excalidrawAPI && collabAPI) {
          collabAPI.broadcastSlideCanceled();
        }
        console.error(e);
      } finally {
        setIsLoading(false);
        event.target.value = "";
      }
    };

    const [isOpen, setIsOpen] = useState(true);

    const toggleSlideList = () => {
      setIsOpen(!isOpen);
    };

    return (
      <SlideListWrapper isOpen={isOpen}>
        <SceneList
          onDragOver={(e) => e.preventDefault()}
          // onDrop={handleDrop}
        >
          <SlideListHeader>
            <ToggleButton onClick={toggleSlideList}>
              {isOpen ? "◀" : "▶"}
            </ToggleButton>
          </SlideListHeader>
          <SceneListScenes ref={scenesWrapper} isOpen={isOpen}>
            {scenes.map((scene, index) => {
              return (
                <Scene
                  key={scene.id}
                  ref={(instance) => {
                    childRefs.current[index] = instance as any;
                  }}
                  index={index}
                  isActive={index === currentIndex}
                  isRemovable={scenes.length > 1}
                  onSelect={() =>
                    userRef.getUserRole() === RoomUserRole.TEACHER && !replay // 선생님만 슬라이드 이동 가능
                      ? moveToScene(index)
                      : () => {}
                  }
                  onRemove={(event: any) => {
                    event.stopPropagation();
                    if (
                      userRef.getUserRole() === RoomUserRole.TEACHER &&
                      !replay
                    ) {
                      // 선생님만 슬라이드 삭제 가능
                      deleteScene(scene.id);
                    }
                  }}
                />
              );
            })}
          </SceneListScenes>
          {userRef.getUserRole() === RoomUserRole.TEACHER && !replay ? ( // 선생님만 슬라이드 액션 가능
            <SceneListButtons>
              <input
                type="file"
                accept=".pdf"
                style={{ display: "none" }}
                ref={selectFile} //input에 접근 하기위해 useRef사용
                onChange={selectFileOnChanged}
              />
              <UploadButton
                className="btn btn-fill"
                type="button"
                onClick={() => selectFile.current?.click()}
                isOpen={isOpen}
              >
                파일 업로드
              </UploadButton>
            </SceneListButtons>
          ) : null}
        </SceneList>
      </SlideListWrapper>
    );
  },
);

const SlideListWrapper = styled.div<{ isOpen?: boolean }>`
  width: ${({ isOpen }) => (isOpen ? "14.58%" : "0px")};
  max-width: 360px;
  display: flex;
  flex-direction: column;
  transition: transform 0.3s ease-in-out;
  /* transform: ${({ isOpen }) =>
    isOpen ? "translateX(0)" : "translateX(-100%)"}; */

  position: relative;
  z-index: 10;
`;

const SceneList = styled.div`
  flex: 1 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
`;

const SceneListScenes = styled.div<{ isOpen?: boolean }>`
  flex: 1 0 1px;
  display: flex;
  flex-direction: column;
  overflow-y: scroll;
  overflow-x: hidden;
  gap: 16px;

  padding: ${({ isOpen }) => (isOpen ? "20px" : "0px")};
`;

const SceneListButtons = styled.div`
  flex: 0 0 auto;
  margin: 0;
  padding: 0 20px 20px 20px;
  z-index: 1; // 추가: z-index 속성을 사용하여 레이어 순서 조정

  > button {
    width: 100%;
    padding: 16px 32px;
    font-size: 16px;
    color: #fff;
    background: #5c63f3;
    border-radius: 8px;
    border: none;

    &:focus {
      outline: transparent;
    }
  }
`;
const SlideListHeader = styled.div`
  width: 100%;
  display: flex;
  justify-content: flex-end;
`;

const ToggleButton = styled.button`
  position: absolute;
  top: 20px;
  right: -20px;
  transform: translateY(-50%);
  width: 20px;
  height: 40px;
  background-color: #f4f4f5;
  border: none;
  cursor: pointer;
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 10000;
`;

const UploadButton = styled.button<{ isOpen?: boolean }>`
  width: 100%;
  padding: 16px 32px;
  font-size: 16px;
  color: #fff;
  background: #5c63f3;
  border-radius: 8px;
  border: none;
  display: ${({ isOpen }) => (isOpen ? "flex" : "none")};
`;

export default SlideList;
