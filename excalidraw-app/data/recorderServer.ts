import { ExcalidrawElement } from "../../packages/excalidraw/element/types";
import { AppState, BinaryFiles } from "../../packages/excalidraw/types";
import playerRef from "./player";
import slideRef from "./slide";
import { PlayerStatusEnum, RecorderStatusEnum } from "./types";

class recorderServerRef {
  private static instance: recorderServerRef;

  protected recorderStatus: RecorderStatusEnum;

  // new 클래스 구문 사용 제한을 목적으로
  // constructor() 함수 앞에 private 접근 제어자 추가
  private constructor() {
    this.recorderStatus = RecorderStatusEnum.NOT_STARTED;
  }
  public setLocalStream = (localStream: MediaStream | null) => {
    // 영상 녹화 안하기 때문에 아무것도 안함
  };

  /**
   * 녹화 토글형
   */
  public toggleRecording = async () => {
    if (this.recorderStatus === RecorderStatusEnum.RECORDING) {
      return await this.stopRecording();
    }
    return await this.startRecording();
  };

  /**
   * 녹화시작
   */
  public startRecording = async () => {
    const excalidrawAPI = slideRef.getExcalidrawAPI();
    const collabAPI = slideRef.getCollabAPI();
    const playerStatus = playerRef.getPlayerStatus();
    if (playerStatus === PlayerStatusEnum.PLAYING) {
      console.error("cannot record while playing");
      return false;
    }
    if (excalidrawAPI && collabAPI) {
      collabAPI.broadcastStartRecording(
        excalidrawAPI.getSceneElements(),
        (await slideRef.getCurrentSceneId()) || "",
        (await slideRef.getCurrentIndex()) || 0,
      );
    } else {
      console.error("not loaded apis");
      return false;
    }
    return true;
  };

  /**
   * 녹화 스트림 변경
   */
  public changeStream = async () => {
    // Janus에서 자체적으로 영상 찍어서 아무것도 안함
  };

  /**
   * 상태 변경
   */
  public setStatus = (status: RecorderStatusEnum) => {
    this.recorderStatus = status;
    switch (status) {
      case RecorderStatusEnum.RECORDED_OPTIMIZING:
        playerRef.setPlayerStatus(PlayerStatusEnum.RECORD_ENDING);
        break;
      case RecorderStatusEnum.RECORDING:
        playerRef.setPlayerStatus(PlayerStatusEnum.RECORDING);
        break;
      case RecorderStatusEnum.RECORDED:
        playerRef.setPlayerStatus(PlayerStatusEnum.READY);
        break;
    }
  };

  /**
   * 녹화 중지
   */
  public stopRecording = async () => {
    const excalidrawAPI = slideRef.getExcalidrawAPI();
    const collabAPI = slideRef.getCollabAPI();
    if (this.recorderStatus === RecorderStatusEnum.RECORDING) {
      if (excalidrawAPI && collabAPI) {
        collabAPI.broadcastStopRecording();
        // playerRef.setPlayerStatus(PlayerStatusEnum.READY);
        // this.recorderStatus = RecorderStatusEnum.RECORDED;
      } else {
        console.error("not loaded apis");
        return false;
      }
    } else {
      console.error("not recording");
      return false;
    }
    return true;
  };

  /**
   * 녹화 데이터에 excalidraw 변경 추가
   * @param elements
   * @param appState
   * @param files
   * @returns
   */
  public pushDrawingElementsAction = (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    // 서버는 자체 통신으로 녹화하기 때문에 아무것도 안함
    return true;
  };

  /**
   * 녹화 데이터에 씬 변경 추가
   * @param index
   * @returns
   */
  public pushChangeSceneAction = (index: number) => {
    // 서버는 자체 통신으로 녹화하기 때문에 아무것도 안함
    return true;
  };

  // 오직 getInstance() 스태틱 메서드를 통해서만
  // 단 하나의 객체를 생성할 수 있습니다.
  public static getInstance() {
    if (!recorderServerRef.instance) {
      recorderServerRef.instance = new recorderServerRef();
    }
    return recorderServerRef.instance;
  }
}

export default recorderServerRef.getInstance();
