import { ExcalidrawElement } from "../../packages/excalidraw/element/types";
import { BinaryFiles } from "../../packages/excalidraw/types";

export type Drawing = {
  elements: ExcalidrawElement[];
};

export type Scene = {
  id: string;
  drawing: Drawing;
};

export const RoomStatus = {
  READY: "READY",
  STUDYING: "STUDYING",
  ENDED: "ENDED",
} as const;

export type RoomStatusType = typeof RoomStatus[keyof typeof RoomStatus];

export enum RoomUserRole {
  TEACHER = "TEACHER", // 선생님
  ASSISTANT = "ASSISTANT", // 조교
  STUDENT = "STUDENT", // 학생
  SPECTATOR = "SPECTATOR", // 관전자
}

export type UserData = {
  userId: string;
  name: string;
  role?: RoomUserRole;
  externalId?: string;
};

export type UserDataStatus = {
  isVideo?: boolean;
  isMic?: boolean;
};

export type RoomUser = {
  socketId: string;
} & UserData &
  UserDataStatus;

// export type RoomUser = {
//   id: string;
//   name: string;
//   role: RoomUserRole;
//   isVideo: boolean;
//   isMic: boolean;
//   rtc?: boolean;
// };

export interface RoomData {
  roomId: string;
  roomKey: string;
  user?: UserData | null;
  author?: string | null;
  name?: string | null;
}
export interface ExcalidrawAppProps {
  className?: string | undefined;
  roomData?: RoomData | null;
  replay?: boolean;
  embed?: boolean;
  engine?: "webrtc" | "janus";
}

export type RTCPeerData = {
  socketId: string;
  stream: MediaStream | null;
  pc: RTCPeerConnection | null;
};

export enum RecordActionType {
  DRAWING_ELEMENTS = "DE",
  CHANGE_SCENE = "CS",
}

export enum RecorderStatusEnum {
  NOT_STARTED = "NOT_STARTED", // 녹화대기
  RECORDING = "RECORDING", // 녹화중
  RECORDED_OPTIMIZING = "RECORDED_OPTIMIZING", // 녹화 종료 후 최적화 중
  RECORDED = "RECORDED", // 녹화 완료
}

export enum PlayerStatusEnum {
  READY = "READY", // 대기
  PLAYING = "PLAYING", // 재생중
  PAUSED = "PAUSED", // 일시정지
  RECORDING = "RECORDING", // 녹화중
  RECORD_ENDING = "RECORDING_ENDING", // 녹화 종료 중
}

export type RecordAction = {
  time: number;
  type: RecordActionType;
  data: any;
};

export type Record = {
  startTime: number; // 녹화 시작시간
  seekLength: number; // seek 길드
  actions: RecordAction[]; // 녹화 데이터
  files: BinaryFiles; // 파일 데이터
};

export type RecordInfo = {
  seek: number; // 현재 seek
  seekLength: number; // seek 길이
  mediaUrl: string; // 영상 url
};
