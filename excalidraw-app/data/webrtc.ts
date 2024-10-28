import type { Socket } from "socket.io-client";
import { SocketId } from "../../packages/excalidraw/types";
import { appJotaiStore } from "../app-jotai";
import { collabAPIAtom } from "../collab/Collab";
import { deviceStatusAtom, socketUsersAtom, webRTCUsersAtom } from "./atoms";
import recorderRef from "./recorder";
import { RoomUser, RoomUserRole, RTCPeerData } from "./types";
import userRef from "./user";

const pc_config = {
  iceServers: JSON.parse(import.meta.env.VITE_APP_TURN_SERVER_URL) || [],
};

class webRtcRef {
  private static instance: webRtcRef;

  protected socket: Socket | null;
  protected localStream: MediaStream | null;
  protected pdList: {
    [socketId: string]: RTCPeerData;
  };
  protected onChangeStream: (stream: MediaStream | null) => void;

  private screenStream: MediaStream | null = null;
  private screenPCs: { [socketId: string]: RTCPeerConnection } = {};

  private constructor() {
    this.socket = null;
    this.localStream = null;
    this.pdList = {};
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
    const self = this;
    if (socket && socket.listeners("on-evented").length === 0) {
      socket.on("on-evented", () => {
        //
      });

      socket.on("all_users", (allUsers: Array<RoomUser>) => {
        allUsers.forEach(async (user) => {
          self.connectPeerConnection(user.socketId);
        });
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
        if (!self.pdList[data.id] || !self.pdList[data.id].pc) {
          return;
        }
        const pc = self.pdList[data.id].pc;
        if (pc) {
          pc.close();
        }
        delete self.pdList[data.id];
        await appJotaiStore.set(socketUsersAtom, (oldUsers) =>
          oldUsers.filter((user) => user.socketId !== data.id),
        );
      });

      socket.on(
        "getOffer",
        async (data: { sdp: RTCSessionDescription; offerSendID: string }) => {
          const { sdp, offerSendID } = data;
          const pc = self.createPeerConnection(offerSendID);
          if (!(pc && socket)) {
            return;
          }
          self.pdList = {
            ...self.pdList,
            [offerSendID]: {
              ...self.pdList[offerSendID],
              socketId: offerSendID,
              pc,
            },
          };
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
            const localSdp = await pc.createAnswer({
              offerToReceiveVideo: true,
              offerToReceiveAudio: true,
            });
            await pc.setLocalDescription(new RTCSessionDescription(localSdp));
            socket.emit("answer", {
              sdp: localSdp,
              answerSendID: socket.id,
              answerReceiveID: offerSendID,
            });
          } catch (e) {
            console.error(e, sdp, offerSendID);
          }
        },
      );

      socket.on(
        "getAnswer",
        (data: { sdp: RTCSessionDescription; answerSendID: string }) => {
          const { sdp, answerSendID } = data;
          const pd: RTCPeerData = self.pdList[answerSendID];
          if (!pd) {
            return;
          }
          const pc = pd.pc;
          if (!pc) {
            return;
          }
          try {
            pc.setRemoteDescription(new RTCSessionDescription(sdp));
          } catch (e) {
            console.error(e);
          }
        },
      );

      socket.on(
        "getCandidate",
        async (data: {
          candidate: RTCIceCandidateInit;
          candidateSendID: string;
        }) => {
          if (
            !self.pdList ||
            !self.pdList[data.candidateSendID] ||
            !self.pdList[data.candidateSendID].pc
          ) {
            return;
          }
          const pc = self.pdList[data.candidateSendID].pc;
          if (!pc) {
            return;
          }
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        },
      );

      socket.on(
        "screen-offer",
        async (data: { sdp: RTCSessionDescription; offerSendID: string }) => {
          const pc = new RTCPeerConnection(pc_config);
          this.screenPCs[data.offerSendID] = pc;

          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          socket.emit("screen-answer", {
            sdp: answer,
            answerSendID: socket.id,
            answerReceiveID: data.offerSendID,
          });

          pc.ontrack = (e) => {
            this.setScreenStream(e.streams[0]);
          };
        },
      );

      socket.on(
        "screen-answer",
        (data: { sdp: RTCSessionDescription; answerSendID: string }) => {
          const pc = this.screenPCs[data.answerSendID];
          if (pc) {
            pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          }
        },
      );

      socket.on(
        "screen-candidate",
        async (data: {
          candidate: RTCIceCandidateInit;
          candidateSendID: string;
        }) => {
          const pc = this.screenPCs[data.candidateSendID];
          if (pc) {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          }
        },
      );
    }
  };

  public isConnected = () => {
    if (this.socket) {
      return Object.keys(this.pdList).length > 0;
    }
    return false;
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

  public createPeerConnection = (socketID: string) => {
    try {
      const pc = new RTCPeerConnection(pc_config);

      pc.onicecandidate = (e) => {
        if (!(this.socket && e.candidate)) {
          return;
        }
        this.socket.emit("candidate", {
          candidate: e.candidate,
          candidateSendID: this.socket.id,
          candidateReceiveID: socketID,
        });
      };

      pc.oniceconnectionstatechange = (e) => {
        // console.log(e);
      };

      pc.ontrack = async (e) => {
        await appJotaiStore.set(webRTCUsersAtom, (oldUsers) => {
          return oldUsers
            .filter((user) => user.socketId !== socketID)
            .concat({
              socketId: socketID,
              stream: e.streams[0],
            });
        });
        recorderRef.changeStream();
      };

      if (this.localStream) {
        this.localStream.getTracks().forEach((track) => {
          if (this.localStream) {
            pc.addTrack(track, this.localStream);
          }
        });
      }

      return pc;
    } catch (e) {
      console.error(e);
      return undefined;
    }
  };

  public connectPeerConnection = async (socketID: string) => {
    const mySocketId = this.socket?.id;

    const pd = this.pdList[socketID];
    if (pd) {
      if (pd.pc) {
        pd.pc.close();
      }
      pd.stream = null;
    }
    const pc = this.createPeerConnection(socketID);
    if (!(pc && this.socket)) {
      delete this.pdList[socketID];
      return;
    }

    this.pdList = {
      ...this.pdList,
      [socketID]: {
        ...pd,
        pc,
      },
    };
    try {
      const localSdp = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await pc.setLocalDescription(new RTCSessionDescription(localSdp));
      this.socket.emit("offer", {
        sdp: localSdp,
        offerSendID: mySocketId,
        offerReceiveID: socketID,
      });
    } catch (e) {
      console.error(e);
    }
  };

  public getDevices = async () => {
    return await navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        const videoDevices = devices.filter(
          (device) => device.kind === "videoinput",
        );
        const audioDevices = devices.filter(
          (device) => device.kind === "audioinput",
        );

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
    try {
      const deviceStatus = await appJotaiStore.get(deviceStatusAtom);

      if (userRef.getUserRole() !== RoomUserRole.SPECTATOR) {
        if (this.localStream) {
          this.localStream.getTracks().forEach((track) => {
            track.stop();
          });
        }

        if (deviceStatus && (deviceStatus.isVideo || deviceStatus.isMic)) {
          let newLocalStream = new MediaStream();
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
            newLocalStream = await navigator.mediaDevices.getUserMedia(
              constraints,
            );
          } catch (e) {
            console.error(`getUserMedia error: ${e}`);
            await appJotaiStore.set(deviceStatusAtom, {
              ...deviceStatus,
              isVideo: false,
              isMic: false,
            });
          }

          if (this.localStream && this.localStream instanceof MediaStream) {
            if (this.socket) {
              const pcUser = Object.keys(this.pdList);
              if (pcUser && pcUser.length > 0) {
                if (newLocalStream) {
                  const audioTrack = newLocalStream.getAudioTracks()[0];
                  const videoTrack = newLocalStream.getVideoTracks()[0];

                  if (newLocalStream && this.localStream) {
                    const oldTrack = this.localStream.getTracks();
                    oldTrack.forEach((track) => {
                      this.localStream?.removeTrack(track);
                    });
                    newLocalStream.getTracks().forEach((track) => {
                      this.localStream?.addTrack(track);
                    });
                  }

                  pcUser.forEach(async (key) => {
                    const pd = this.pdList[key];
                    const pc = pd.pc;

                    if (pc && this.localStream) {
                      const audioSender = pc
                        .getSenders()
                        .find((s) => s.track?.kind === "audio");
                      const videoSender = pc
                        .getSenders()
                        .find((s) => s.track?.kind === "video");

                      let isChangeSdp = false;
                      if (audioSender && audioTrack) {
                        audioSender.replaceTrack(audioTrack);
                      } else if (audioSender && !audioTrack) {
                        audioSender.track?.stop();
                      } else if (audioTrack) {
                        pc.addTrack(audioTrack, this.localStream);
                        isChangeSdp = true;
                      }

                      if (videoSender && videoTrack) {
                        videoSender.replaceTrack(videoTrack);
                      } else if (videoSender && !videoTrack) {
                        videoSender.track?.stop();
                      } else if (videoTrack) {
                        pc.addTrack(videoTrack, this.localStream);
                        isChangeSdp = true;
                      }

                      if (isChangeSdp) {
                        await this.connectPeerConnection(key);
                      }
                    }
                  });
                }

                this.sendChangeStatus();
              }
            }
          } else {
            this.setLocalStream(newLocalStream);
            recorderRef.setLocalStream(newLocalStream);
          }
        } else {
          if (this.localStream) {
            this.localStream.getTracks().forEach((track) => {
              track.stop();
            });
          }
          this.sendChangeStatus();
        }
      }

      if (this.socket) {
        const deviceStatus = await appJotaiStore.get(deviceStatusAtom);
        const collabAPI = await appJotaiStore.get(collabAPIAtom);
        const user = userRef.getUser();
        this.socket.emit(
          "join-room-media",
          collabAPI?.getPortal()?.getRoomId(),
          {
            userId: user?.userId,
            name: user?.name,
            role: userRef.getUserRole(),
            isVideo: deviceStatus?.isVideo,
            isMic: deviceStatus?.isMic,
            externalId: this.socket.id,
          },
        );
      }
    } catch (e) {
      console.error(`WebRTC connection error: ${e}`);
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

  public toggleMicFromTeacher = async (socketId: SocketId) => {
    if (userRef.getUserRole() === RoomUserRole.TEACHER) {
      this.socket?.emit("toggleMic", socketId);
    } else {
      console.error("toggleMicFromTeacher: user is not teacher");
    }
  };

  public close = async () => {
    console.info("unmount WebRTC");
    if (this.pdList) {
      Object.keys(this.pdList).map((id) => {
        const pd = this.pdList[id];
        if (pd) {
          const pc = pd.pc;
          if (pc) {
            pc.close();
          }
          delete this.pdList[id];
        }
        return id;
      });
    }
    await appJotaiStore.set(socketUsersAtom, []);
  };

  public startScreenShare = async (stream: MediaStream) => {
    this.screenStream = stream;

    for (const socketId in this.pdList) {
      const pc = new RTCPeerConnection(pc_config);
      this.screenPCs[socketId] = pc;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          this.socket?.emit("screen-candidate", {
            candidate: e.candidate,
            candidateSendID: this.socket.id,
            candidateReceiveID: socketId,
          });
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      this.socket?.emit("screen-offer", {
        sdp: offer,
        offerSendID: this.socket.id,
        offerReceiveID: socketId,
      });
    }
  };

  public stopScreenShare = () => {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((track) => track.stop());
      this.screenStream = null;
    }

    for (const socketId in this.screenPCs) {
      this.screenPCs[socketId].close();
    }
    this.screenPCs = {};

    this.socket?.emit("screen-sharing-stopped");
  };

  public getScreenStream = () => {
    return this.screenStream;
  };

  public setScreenStream = (stream: MediaStream | null) => {
    this.screenStream = stream;
  };

  public static getInstance() {
    if (!webRtcRef.instance) {
      webRtcRef.instance = new webRtcRef();
    }
    return webRtcRef.instance;
  }
}

export default webRtcRef.getInstance();
