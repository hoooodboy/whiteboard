import {
  loadedSlideAtom,
  loadedWebSocketAtom,
  loadedWebRTCAtom,
} from "./atoms";
import { appJotaiStore } from "../app-jotai";

class LoaderSingleton {
  private static instance: LoaderSingleton;

  // new 클래스 구문 사용 제한을 목적으로
  // constructor() 함수 앞에 private 접근 제어자 추가
  private constructor() {}

  public getIsSlide = () => {
    return appJotaiStore.get(loadedSlideAtom);
  };

  public setIsSlide = (state: boolean) => {
    return appJotaiStore.set(loadedSlideAtom, state);
  };

  public getIsWebSocket = () => {
    return appJotaiStore.get(loadedWebSocketAtom);
  };

  public setIsWebSocket = (state: boolean) => {
    return appJotaiStore.set(loadedWebSocketAtom, state);
  };

  public getIsWebRTC = () => {
    return appJotaiStore.get(loadedWebRTCAtom);
  };

  public setIsWebRTC = (state: boolean) => {
    return appJotaiStore.set(loadedWebRTCAtom, state);
  };

  // 오직 getInstance() 스태틱 메서드를 통해서만
  // 단 하나의 객체를 생성할 수 있습니다.
  public static getInstance() {
    if (!LoaderSingleton.instance) {
      LoaderSingleton.instance = new LoaderSingleton();
    }
    return LoaderSingleton.instance;
  }
}

export default LoaderSingleton.getInstance();
