import { cloneDeep, find } from "lodash";
import { appJotaiStore } from "../app-jotai";
import { playerStatusAtom, recordInfoAtom } from "./atoms";
import slideRef from "./slide";
import { PlayerStatusEnum, RecordActionType, Record } from "./types";

type RecordStatus = {
  playingInterval: NodeJS.Timeout | null;
  currentSeek: number;
  startedTime: number;
};

class PlayerRef {
  private static instance: PlayerRef;

  protected record: Record;
  protected recordStatus: RecordStatus;
  protected playingInterval: NodeJS.Timeout | null;
  protected videoElement: HTMLVideoElement | null;
  protected seekIndex: number;

  // new 클래스 구문 사용 제한을 목적으로
  // constructor() 함수 앞에 private 접근 제어자 추가
  private constructor() {
    this.record = {
      startTime: -1,
      seekLength: 0,
      actions: [],
      files: {},
    };
    this.playingInterval = null;
    this.recordStatus = {
      playingInterval: null,
      currentSeek: 0,
      startedTime: 0,
    };
    this.videoElement = null;
    this.seekIndex = 0;
  }

  public setRecord = (record: Record) => {
    this.record = Object.assign(this.record, record);
    this.setPlayerStatus(PlayerStatusEnum.READY);
  };

  /**
   * seek 계산 해서 리턴
   * @param seek
   */
  protected _seek = async (seek: number) => {
    const startedTime = new Date().getTime() - seek;
    let i = 0;
    let currentSceneIndex = 0;
    let skipElement = null;
    let tmpMap: { [key: string]: any } = {};
    while (true) {
      const recordAction = this.record.actions[i];
      if (!recordAction || recordAction.time > seek) {
        break;
      }
      i++;
      if (recordAction.type === RecordActionType.DRAWING_ELEMENTS) {
        if (recordAction.data.elements) {
          for (const el of recordAction.data.elements) {
            tmpMap[el.id] = el;
          }
          skipElement = Object.values(tmpMap);
        }
      } else if (recordAction.type === RecordActionType.CHANGE_SCENE) {
        currentSceneIndex = recordAction.data;
        tmpMap = {};
        skipElement = null;
      }
    }
    return {
      startedTime,
      seek,
      skipElement,
      currentSceneIndex,
      seekIndex: i,
    };
  };

  /**
   * seek 이동
   * @param seek
   */
  public seek = async (seek: number) => {
    const playerStatus = this.getPlayerStatus();
    const result = await this._seek(seek);
    if (result && slideRef.getExcalidrawAPI()) {
      slideRef.setCurrentIndex(result.currentSceneIndex);

      const sceneId = await slideRef.getFindId(result.currentSceneIndex);
      if (sceneId) {
        slideRef.setCurrentSceneId(sceneId);
      }

      if (result.skipElement) {
        slideRef
          .getExcalidrawAPI()
          ?.updateScene({ elements: result.skipElement });
      }

      if (this.videoElement) {
        this.videoElement.currentTime = result.seek / 1000;
      }

      this.seekIndex = result.seekIndex;
      this.recordStatus.startedTime = result.startedTime;
      this.recordStatus.currentSeek = result.seek;

      const recordInfo = await appJotaiStore.get(recordInfoAtom);
      if (recordInfo) {
        await appJotaiStore.set(
          recordInfoAtom,
          Object.assign({}, recordInfo, {
            seek: result.seek,
          }),
        );
      }

      if (playerStatus === PlayerStatusEnum.READY) {
        this.setPlayerStatus(PlayerStatusEnum.PAUSED);
      }

      return true;
    }
    return false;
  };

  protected customUnionBy(
    arrays: Array<any>,
    iteratee: Array<any>,
    key: string,
  ) {
    const unionArray = cloneDeep(arrays);
    iteratee.forEach((x) => {
      const existingItem = find(unionArray, [key, x[key]]);
      if (existingItem) {
        Object.assign(existingItem, x);
      } else {
        unionArray.push(x);
      }
    });

    return unionArray;
  }

  /**
   * 녹화 재생
   * @param seek
   */
  public play = (seek?: number) => {
    const excalidrawAPI = slideRef.getExcalidrawAPI();
    const self = this;
    (async () => {
      const playerStatus = self.getPlayerStatus();
      if (excalidrawAPI) {
        if (self.record.seekLength === 0) {
          await self.loadTest();
          this.play(seek);
          console.error("not recorded");
          return false;
        } else if (playerStatus === PlayerStatusEnum.PLAYING) {
          if (seek) {
            self.recordStatus.currentSeek = seek;
            self.pause();
          } else {
            console.error("already playing");
            return false;
          }
        } else if (playerStatus === PlayerStatusEnum.RECORDING) {
          console.error("cannot play while recording");
          return false;
        }
        if (playerStatus === PlayerStatusEnum.PAUSED) {
          self.recordStatus.startedTime =
            new Date().getTime() - self.recordStatus.currentSeek;
        } else {
          self.recordStatus.startedTime =
            new Date().getTime() + (seek ? seek * -1 : 0);
          excalidrawAPI.resetScene();
        }
        self.setPlayerStatus(PlayerStatusEnum.PLAYING);

        if (self.videoElement) {
          self.videoElement.play();
        }

        if (typeof seek === "number") {
          await self.seek(seek);
        }
        self.recordStatus.playingInterval = setInterval(async () => {
          while (true) {
            const currentTime = (self.recordStatus.currentSeek =
              new Date().getTime() - self.recordStatus.startedTime);
            const recordAction = self.record.actions[self.seekIndex];
            const recordInfo = await appJotaiStore.get(recordInfoAtom);
            if (recordInfo) {
              await appJotaiStore.set(
                recordInfoAtom,
                Object.assign({}, recordInfo, {
                  seek: currentTime,
                }),
              );
            }
            if (
              !recordAction ||
              recordAction.time > currentTime + (seek || 0)
            ) {
              break;
            }
            ++self.seekIndex;
            if (recordAction.type === RecordActionType.DRAWING_ELEMENTS) {
              excalidrawAPI?.updateScene({
                elements: self.customUnionBy(
                  excalidrawAPI.getSceneElements() as Array<any>,
                  recordAction.data.elements,
                  "id",
                ),
              });
            } else if (recordAction.type === RecordActionType.CHANGE_SCENE) {
              const currentSceneIndex = recordAction.data;
              slideRef.setCurrentIndex(currentSceneIndex);
              const sceneId = await slideRef.getFindId(currentSceneIndex);
              if (sceneId) {
                slideRef.setCurrentSceneId(sceneId);
              }
              excalidrawAPI?.resetScene();
            }
          }

          if (self.recordStatus.currentSeek > self.record.seekLength) {
            if (self.recordStatus.playingInterval) {
              clearInterval(self.recordStatus.playingInterval);
            }
            self.seekIndex = 0;
            self.recordStatus.currentSeek = 0;
            self.recordStatus.startedTime = 0;
            self.setPlayerStatus(PlayerStatusEnum.READY);
          }
        }, 33);
      }
    })();
    return true;
  };

  /**
   * 녹화 데이터 로드
   * @param seek
   */
  public fetchRecord = async (
    roomId: string | null,
    isForce: boolean = false,
  ) => {
    if (isForce || this.record.seekLength === 0) {
      const collabAPI = slideRef.getCollabAPI();
      const excalidrawAPI = slideRef.getExcalidrawAPI();
      const res = await fetch(
        `${
          import.meta.env.VITE_APP_WS_SERVER_URL
        }/white-board/${roomId}/${roomId}.rec`,
      );
      const data = await res.json();
      this.record.startTime = 0;
      this.record.seekLength = data.seekLength;
      this.record.actions = data.actions;

      if (collabAPI && excalidrawAPI) {
        const { loadedFiles } = await collabAPI
          ?.getFileManager()
          .getFiles([...data.fileIds]);
        await excalidrawAPI?.setFiles(
          loadedFiles.length > 0 ? loadedFiles : [],
        );
      }

      this.seekIndex = 0;
      this.recordStatus.currentSeek = 0;
      this.recordStatus.startedTime = 0;
      this.setPlayerStatus(PlayerStatusEnum.READY);

      await appJotaiStore.set(recordInfoAtom, {
        seek: 0,
        seekLength: data.seekLength,
        mediaUrl: "",
      });
      this.setVideoElement(null);
    }
  };

  /**
   * 녹화 재생(테스트)
   * @param seek
   */
  public loadTest = async () => {
    const collabAPI = slideRef.getCollabAPI();
    const excalidrawAPI = slideRef.getExcalidrawAPI();
    const res = await fetch(
      `${import.meta.env.VITE_APP_WS_SERVER_URL}/white-board/${slideRef
        .getCollabAPI()
        ?.getPortal()
        .getRoomId()}/${slideRef.getCollabAPI()?.getPortal().getRoomId()}.rec`,
    );
    const data = await res.json();
    this.record.startTime = 0;
    this.record.seekLength = data.seekLength;
    this.record.actions = data.actions;

    if (collabAPI && excalidrawAPI) {
      const { loadedFiles } = await collabAPI
        ?.getFileManager()
        .getFiles([...data.fileIds]);
      await excalidrawAPI?.setFiles(loadedFiles.length > 0 ? loadedFiles : []);
    }

    this.seekIndex = 0;
    this.recordStatus.currentSeek = 0;
    this.recordStatus.startedTime = 0;
    this.setPlayerStatus(PlayerStatusEnum.READY);

    await appJotaiStore.set(recordInfoAtom, {
      seek: 0,
      seekLength: data.seekLength,
      mediaUrl: "",
    });
    this.setVideoElement(null);
    return this.play(0);
  };

  /**
   * 일시정지
   */
  public pause = () => {
    const playerStatus = this.getPlayerStatus();
    if (playerStatus === PlayerStatusEnum.PLAYING) {
      this.setPlayerStatus(PlayerStatusEnum.PAUSED);
      if (this.videoElement) {
        this.videoElement.pause();
      }
      if (this.recordStatus.playingInterval) {
        clearInterval(this.recordStatus.playingInterval);
      }
      return true;
    }
    console.error("cannot pause while not playing");
    return false;
  };

  /**
   * 재생 상태 가져오기
   */
  public getPlayerStatus = () => {
    return appJotaiStore.get(playerStatusAtom);
  };

  /**
   * 재생 상태 설정
   * @param playerStatus
   */
  public setPlayerStatus = (playerStatus: PlayerStatusEnum) => {
    appJotaiStore.set(playerStatusAtom, playerStatus);
  };

  /**
   * 영상 재생할 video 태그 설정
   * @param videoElement
   */
  public setVideoElement = (videoElement: HTMLVideoElement | null) => {
    this.videoElement = videoElement;
  };

  // 오직 getInstance() 스태틱 메서드를 통해서만
  // 단 하나의 객체를 생성할 수 있습니다.
  public static getInstance() {
    if (!PlayerRef.instance) {
      PlayerRef.instance = new PlayerRef();
    }
    return PlayerRef.instance;
  }
}

export default PlayerRef.getInstance();
