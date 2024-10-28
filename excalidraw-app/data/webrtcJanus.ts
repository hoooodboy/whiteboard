import type {
  VideoRoom,
  VideoRoomClient,
  VideoRoomPublisher,
  VideoRoomSession,
  VideoRoomSubscriber,
} from "janus-simple-videoroom-client";
import { createVideoRoomClient } from "janus-simple-videoroom-client";
import type { Socket } from "socket.io-client";
import { SocketId } from "../../packages/excalidraw/types";
import { appJotaiStore } from "../app-jotai";
import { collabAPIAtom } from "../collab/Collab";
import { WebRTCUser } from "../webrtc/types";
import { deviceStatusAtom, socketUsersAtom, subscribersAtom } from "./atoms";
import recorderRef from "./recorder";
import { RoomUser, RoomUserRole } from "./types";
import userRef from "./user";

export type WebRTCUserWithVideoRoomSubscriber = {
  user: RoomUser & WebRTCUser;
  subscriber: VideoRoomSubscriber;
};

class webRtcRef {
  private static instance: webRtcRef;

  protected socket: Socket | null;
  protected localStream: MediaStream | null;
  protected videoRoomClientRef: VideoRoomClient | null;
  protected videoRoomSessionRef: VideoRoomSession | null;
  protected videoRoomRef: VideoRoom | null;
  protected publisherRef: VideoRoomPublisher | null;
  protected onChangeStream: (stream: MediaStream | null) => void;

  // new 클래스 구문 사용 제한을 목적으로
  // constructor() 함수 앞에 private 접근 제어자 추가
  private constructor() {
    this.socket = null;
    this.localStream = null;
    this.videoRoomClientRef = null;
    this.videoRoomSessionRef = null;
    this.videoRoomRef = null;
    this.publisherRef = null;
    this.onChangeStream = () => {};
  }

  public getSocket = () => {
    return this.socket;
  };

  public setSocket = (socket: any) => {
    this.socket = socket;
    this.setEventFromSocket(this.socket);
  };

  public setEventFromSocket = (socket: Socket | null) => {
    if (socket && socket.listeners("on-evented").length === 0) {
      socket.on("on-evented", () => {
        //
      });
      socket.on("all_users", (allUsers: Array<RoomUser>) => {
        // None
      });

      socket.on("room-user-change", async (clients: RoomUser[]) => {
        await appJotaiStore.set(socketUsersAtom, clients);
      });

      socket.on("changeWebRtcStatus", async (roomUser: RoomUser) => {
        try {
          await appJotaiStore.set(socketUsersAtom, (prev) => {
            let found = prev.find(
              (user) => user.socketId === roomUser.socketId,
            );
            if (found) {
              found = Object.assign(found, roomUser);
            } else {
              return prev.concat(roomUser);
            }
            return [...prev];
          });
        } catch (e) {
          console.error(e);
        }
      });

      // 마이크 토글 신호
      socket.on("toggleMic", async () => {
        try {
          await appJotaiStore.set(deviceStatusAtom, (prev) => {
            return { ...prev, isMic: !prev.isMic };
          });
        } catch (e) {
          console.error(e);
        }
      });

      socket.on("user-exit", async (data: { id: string }) => {
        // Exit
      });
    }
  };

  public isConnected = () => {
    if (this.socket) {
      return !!this.videoRoomRef;
    }
    return false;
  };

  public getMediaStreamTrack = async () => {
    const deviceStatus = await appJotaiStore.get(deviceStatusAtom);

    if (deviceStatus && (deviceStatus.isVideo || deviceStatus.isMic)) {
      try {
        const constraints: MediaStreamConstraints = {
          video: deviceStatus.isVideo
            ? deviceStatus.videoDeviceId
              ? {
                  deviceId: {
                    exact: deviceStatus.videoDeviceId,
                  },
                  width: 240,
                  height: 240,
                  frameRate: 30,
                }
              : { width: 240, height: 240, frameRate: 30 }
            : false,
          audio: deviceStatus.isMic
            ? deviceStatus.micDeviceId
              ? { deviceId: deviceStatus.micDeviceId }
              : true
            : false,
        };
        const localStream = await navigator.mediaDevices.getUserMedia(
          constraints,
        );
        return {
          audioTrack: localStream.getAudioTracks()[0] || null,
          videoTrack: localStream.getVideoTracks()[0] || null,
        };
      } catch (e) {
        console.error(`getUserMedia error: ${e}`);
        await appJotaiStore.set(deviceStatusAtom, {
          ...deviceStatus,
          isVideo: false,
          isMic: false,
        });
      }
    }

    return {
      audioTrack: null,
      videoTrack: null,
    };
  };

  public getLocalStream = () => {
    return this.localStream;
  };

  public setLocalStream = (localStream: MediaStream | null) => {
    this.localStream = localStream;
    if (this.onChangeStream) {
      this.onChangeStream(localStream);
    }
  };

  public setOnChangeStream = (
    callback: (stream: MediaStream | null) => void,
  ) => {
    this.onChangeStream = callback;
  };

  public getDevices = async () => {
    return await navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        // 사용 가능한 비디오 디바이스 목록 가져오기
        const videoDevices = devices.filter(
          (device) => device.kind === "videoinput",
        );
        // 사용 가능한 오디오 디바이스 목록 가져오기
        const audioDevices = devices.filter(
          (device) => device.kind === "audioinput",
        );

        // 사용 가능한 비디오 디바이스가 있으면 선택할 수 있는 옵션을 제공
        if (videoDevices.length > 0) {
          return {
            videoDevices,
            audioDevices,
          };
        }
        console.error("사용 가능한 오디오 디바이스가 없습니다.");
        return null;
      })
      .catch((err) => {
        console.error("미디어 디바이스 목록을 가져올 수 없습니다:", err);
        return null;
      });
  };

  public connect = async () => {
    const self = this;
    const collabAPI = await appJotaiStore.get(collabAPIAtom);
    const deviceStatus = await appJotaiStore.get(deviceStatusAtom);
    const user = userRef.getUser();

    if (deviceStatus && (deviceStatus.isVideo || deviceStatus.isMic)) {
      const trackInfo = await this.getMediaStreamTrack();

      // 이전에 가져온 스트림이 있으면 트랙 교체
      if (this.localStream && this.localStream instanceof MediaStream) {
        // console.log("트랙 교체");
        const tracks: any[] = [];
        if (trackInfo.audioTrack) {
          tracks.push({
            type: "audio",
            capture: trackInfo.audioTrack || true,
          });
        }
        if (trackInfo.videoTrack) {
          tracks.push({
            type: "video",
            capture: trackInfo.videoTrack || true,
          });
        }
        const room = await this.getJanusVideoRoom();
        if (room) {
          room.pluginHandle.replaceTracks({
            tracks,
            error: (err) => {
              console.error(err);
            },
          });
          this.sendChangeStatus();
        }
      } else {
        // console.log("신규 스트림");
        const userName = userRef.getUser()?.name || "";
        const room = await this.getJanusVideoRoom();

        // console.info(`trackInfo`, trackInfo);
        const pub = await room.publish({
          publishOptions: { display: userName, record: false },
          // mediaOptions: {
          //   stream: localStreamRef.current,
          // },
          mediaOptions: {
            tracks: [
              { type: "audio", capture: trackInfo.audioTrack || true },
              {
                type: "video",
                capture: trackInfo.videoTrack || true,
              },
            ],
          },
        });

        pub.onTrackAdded((track) => {
          // console.log("local onTrackAdded", track);
          self.localStream?.addTrack(track);
        });
        pub.onTrackRemoved((track) => {
          // console.log("local onTrackRemoved", track);
          self.localStream?.removeTrack(track);
        });

        const localStream = new MediaStream();

        this.setLocalStream(localStream);
        recorderRef.setLocalStream(localStream);

        if (this.socket) {
          this.socket.emit(
            "join-room-media",
            collabAPI?.getPortal()?.getRoomId(),
            {
              userId: user?.userId,
              name: user?.name,
              role: userRef.getUserRole(),
              isVideo: deviceStatus?.isVideo,
              isMic: deviceStatus?.isMic,
              externalId: pub.publisherId,
            },
          );
        }

        this.publisherRef = pub;
      }
    } else {
      if (this.localStream) {
        this.localStream.getTracks().forEach((track) => {
          track.stop();
        });
      }
      this.sendChangeStatus();
    }
  };

  public sendChangeStatus = async () => {
    const user = userRef.getUser();
    const deviceStatus = await appJotaiStore.get(deviceStatusAtom);
    const collabAPI = await appJotaiStore.get(collabAPIAtom);
    const roomUser: RoomUser = {
      socketId: this.socket?.id || "",
      userId: user?.userId || "",
      name: user?.name || "",
      role: userRef.getUserRole(),
      isVideo: deviceStatus?.isVideo || false,
      isMic: deviceStatus?.isMic || false,
    };
    this.socket?.emit(
      "changeWebRtcStatus",
      collabAPI?.getPortal()?.getRoomId(),
      roomUser,
    );
  };

  /**
   * 마이크 토글
   * @param socketId
   */
  public toggleMicFromTeacher = async (socketId: SocketId) => {
    if (userRef.getUserRole() === RoomUserRole.TEACHER) {
      this.socket?.emit("toggleMic", socketId);
    } else {
      console.error("toggleMicFromTeacher: user is not teacher");
    }
  };

  public close = async () => {
    console.info("unmount WebRTC Janus");
    this.setSubscribers((v: Map<string, WebRTCUserWithVideoRoomSubscriber>) => {
      v.forEach((value) => {
        value.subscriber.unsubscribe();
      });
      return new Map<string, WebRTCUserWithVideoRoomSubscriber>();
    });
  };

  public getSubscribers = async () => {
    return await appJotaiStore.get(subscribersAtom);
  };

  public setSubscribers = async (subscribers: any) => {
    return await appJotaiStore.set(subscribersAtom, subscribers);
  };

  public onPublisherRemoved = async (publisherId: any) => {
    const subscribers = await this.getSubscribers();
    if (subscribers) {
      const sub = subscribers.get(publisherId);
      if (sub) {
        await sub.subscriber.unsubscribe();
        await this.setSubscribers((prev: any) => {
          const newState = new Map(prev);
          newState.delete(publisherId);
          return newState;
        });
      }
    }
  };

  public onPublisherAdded = async (publishers: any) => {
    const deviceStatus = await appJotaiStore.get(deviceStatusAtom);

    return publishers.forEach(async (publisher: any) => {
      /*
          {
              "id": 2748879613606614,
              "display": "허다서",
              "audio_codec": "opus",
              "video_codec": "vp8",
              "streams": [
                  {
                      "type": "audio",
                      "mindex": 0,
                      "mid": "0",
                      "codec": "opus",
                      "fec": true,
                      "talking": false
                  },
                  {
                      "type": "video",
                      "mindex": 1,
                      "mid": "1",
                      "codec": "vp8"
                  }
              ],
              "talking": false
          }
      */
      const user = {
        userId: userRef.getUser()?.userId,
        name: publisher.display,
        stream: new MediaStream(),
        role: userRef.getUserRole(),
        isVideo: deviceStatus?.isVideo,
        isMic: deviceStatus?.isMic,
        externalId: publisher.id,
      };

      const subscribers = await this.getSubscribers();
      if (subscribers && this.videoRoomRef) {
        const subscriber = subscribers.get(publisher.id)?.subscriber;
        if (!subscriber) {
          const sub = await this.videoRoomRef.subscribe([
            { feed: publisher.id },
          ]);
          if (sub) {
            await this.setSubscribers((prev: any) =>
              new Map(prev).set(publisher.id, {
                user,
                subscriber: sub,
              }),
            );
            // console.info("onPublisherAdded", JSON.stringify(publisher), sub);
            sub.onTrackAdded((track, mid) => {
              user.stream.addTrack(track);
              // console.info("onTrackAdded", track);
            });
            sub.onTrackRemoved(async (track) => {
              // console.log(
              //   "onTrackRemoved before",
              //   user,
              //   user.stream.getTracks().length,
              //   track,
              // );

              user.stream.removeTrack(track);
              if (user.stream.getTracks().length === 0) {
                await this.setSubscribers((prev: any) =>
                  new Map(prev).set(publisher.id, {
                    user,
                    subscriber: sub,
                  }),
                );
              }
              // console.log(
              //   "onTrackRemoved after",
              //   user,
              //   user.stream.getTracks().length,
              //   track,
              // );
            });
          }
        }
      }
    });
  };

  public getJanusClient = async () => {
    if (!this.videoRoomClientRef) {
      const client = await createVideoRoomClient();
      this.videoRoomClientRef = client;
    }
    return this.videoRoomClientRef;
  };

  public getJanusSession = async () => {
    if (!this.videoRoomSessionRef) {
      const client = await this.getJanusClient();
      const session = await client.createSession(
        `${import.meta.env.VITE_APP_JANUS_SERVER_URL}`,
        // "wss://janus.conf.meetecho.com/ws",
      );
      this.videoRoomSessionRef = session;
    }
    return this.videoRoomSessionRef;
  };

  public getJanusVideoRoom = async () => {
    if (!this.videoRoomRef) {
      const session = await this.getJanusSession();
      const room = await session.joinRoom(1234);
      room.onPublisherAdded(this.onPublisherAdded);
      room.onPublisherRemoved(this.onPublisherRemoved);
      this.videoRoomRef = room;
    }
    return this.videoRoomRef;
  };

  // 오직 getInstance() 스태틱 메서드를 통해서만
  // 단 하나의 객체를 생성할 수 있습니다.
  public static getInstance() {
    if (!webRtcRef.instance) {
      webRtcRef.instance = new webRtcRef();
    }
    return webRtcRef.instance;
  }
}

export default webRtcRef.getInstance();
