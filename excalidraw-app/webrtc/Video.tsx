import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import clsx from "clsx";
import { RoomUserRole } from "../data/types";
import userRef from "../data/user";
import styled from "./Video.module.scss";

interface Props {
  name: string;
  stream?: MediaStream | null;
  isVideo?: boolean;
  isMic?: boolean;
  muted?: boolean;
  role?: RoomUserRole;
  me?: boolean;
  events?: { [key: string]: Function };
  userLabelEvents?: { [key: string]: Function };
  userMicEvents?: { [key: string]: Function };
  "data-socket-id"?: string;
}

const Video = forwardRef<{ getVideo: () => HTMLVideoElement | null }, Props>(
  (
    {
      name,
      stream,
      isVideo,
      isMic,
      muted,
      role,
      me,
      events,
      userLabelEvents,
      userMicEvents,
      "data-socket-id": socketId,
      ...rest
    },
    ref,
  ) => {
    useImperativeHandle(ref, () => ({
      getVideo: () => videoRef.current,
    }));

    const videoRef = useRef<HTMLVideoElement>(null);
    const [isMuted, setIsMuted] = useState<boolean>(false);
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const streamUpdateTimeoutRef = useRef<NodeJS.Timeout>();

    // 로컬 스트림 처리
    useEffect(() => {
      const updateStream = async () => {
        if (me && isVideo) {
          try {
            if (localStream) {
              localStream.getTracks().forEach((track) => track.stop());
            }

            const newStream = await navigator.mediaDevices.getUserMedia({
              video: {
                width: 240,
                height: 240,
                frameRate: 30,
              },
              audio: isMic,
            });

            setLocalStream(newStream);

            if (videoRef.current) {
              videoRef.current.srcObject = newStream;
              try {
                await videoRef.current.play();
              } catch (err) {
                console.error("Error playing video:", err);
              }
            }
          } catch (err) {
            console.error("Error accessing camera:", err);
            setLocalStream(null);
          }
        } else if (me && !isVideo && localStream) {
          localStream.getTracks().forEach((track) => track.stop());
          setLocalStream(null);
          if (videoRef.current) {
            videoRef.current.srcObject = null;
          }
        }
      };

      updateStream();

      return () => {
        if (localStream) {
          localStream.getTracks().forEach((track) => track.stop());
        }
      };
    }, [me, isVideo, isMic]);

    // 외부 스트림 처리
    useEffect(() => {
      const videoElement = videoRef.current;
      if (!videoElement) return;

      const currentStream = me ? localStream : stream;

      // 스트림 업데이트 지연 처리
      const updateVideoStream = () => {
        if (streamUpdateTimeoutRef.current) {
          clearTimeout(streamUpdateTimeoutRef.current);
        }

        streamUpdateTimeoutRef.current = setTimeout(() => {
          if (currentStream instanceof MediaStream) {
            if (videoElement.srcObject !== currentStream) {
              videoElement.srcObject = currentStream;
              videoElement
                .play()
                .catch((err) => console.error("Error playing video:", err));
            }
          } else if (!currentStream && videoElement.srcObject) {
            videoElement.srcObject = null;
          }
        }, 100); // 100ms 딜레이로 스트림 업데이트
      };

      updateVideoStream();
      setIsMuted(!!muted);

      return () => {
        if (streamUpdateTimeoutRef.current) {
          clearTimeout(streamUpdateTimeoutRef.current);
        }
      };
    }, [stream, localStream, muted, me]);

    return (
      <div
        className={clsx(styled.userVideoContainer, {
          [styled.me]: me,
          [styled[role?.toLowerCase() || ""]]: role,
        })}
        data-socket-id={socketId}
        {...events}
        {...rest}
      >
        <video
          className={clsx(styled.userVideo, {
            "video-on": isVideo,
            "video-off": !isVideo,
            "audio-on": isMic,
            "audio-off": !isMic,
            "muted-on": isMuted,
            "muted-off": !isMuted,
          })}
          ref={videoRef}
          muted={isMuted}
          autoPlay
          playsInline
        />
        <div className={styled.userLabel}>
          <i
            className={clsx(
              "wb-icon",
              isMic ? "wb-icon-mic-on" : "wb-icon-mic-off",
            )}
            {...userMicEvents}
            style={
              !me && userRef.getUserRole() === RoomUserRole.TEACHER
                ? { cursor: "pointer" }
                : {}
            }
          />
          <span
            className={styled.nameTag}
            {...userLabelEvents}
            style={!me ? { cursor: "pointer" } : {}}
          >
            {`${name} ${role === RoomUserRole.TEACHER ? "선생님" : ""}${
              role === RoomUserRole.STUDENT ? "학생" : ""
            }`}
          </span>
        </div>
      </div>
    );
  },
);

Video.defaultProps = {
  muted: false,
  me: false,
};

export default Video;
