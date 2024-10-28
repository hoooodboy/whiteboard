import { atom } from "jotai";
import type { Socket } from "socket.io-client";
import { DeviceStatus, WebRTCUser } from "../webrtc/types";
import type { RecordInfo, RoomUser, Scene, RoomStatusType } from "./types";
import { PlayerStatusEnum, RoomStatus } from "./types";
import type { WebRTCUserWithVideoRoomSubscriber } from "./webrtcJanus";

// 룸상태
export const roomStatusAtom = atom<RoomStatusType>(RoomStatus.READY);

export const screenShareStreamAtom = atom<MediaStream | null>(null);
export const isScreenSharingAtom = atom<boolean>(false);
export const roomIdAtom = atom<string | null | undefined>(null);

// Loaded Status
export const loadedSlideAtom = atom<boolean>(false);
export const loadedWebSocketAtom = atom<boolean>(false);
export const loadedWebRTCAtom = atom<boolean>(false);

// Slide
export const slideAtom = atom<Scene[]>([]);
// export const sceneAtom = atom<Scene | undefined>(undefined);
export const currentIndexAtom = atom<number | undefined>(0);
export const currentSceneIdAtom = atom<string | null>(null);

// Collab
export const socketLockAtom = atom<boolean>(false);
export const socketAtom = atom<Socket | null>(null);

// WebRTC
export const isWebRTCAtom = atom<boolean>(true);
export const socketUsersAtom = atom<RoomUser[]>([]);
export const webRTCUsersAtom = atom<WebRTCUser[]>([]);
export const showDeviceDialogAtom = atom<boolean>(false);
export const deviceStatusAtom = atom<DeviceStatus>({
  isVideo: true,
  isMic: true,
  videoDeviceId: "",
  micDeviceId: "",
  audioDeviceId: "",
});

// WebRTC Janus Only
export const subscribersAtom = atom<
  Map<string, WebRTCUserWithVideoRoomSubscriber>
>(new Map());

// Recording
export const playerStatusAtom = atom<PlayerStatusEnum>(PlayerStatusEnum.READY);

export const recordInfoAtom = atom<RecordInfo>({
  seek: 0,
  seekLength: 0,
  mediaUrl: "",
});
