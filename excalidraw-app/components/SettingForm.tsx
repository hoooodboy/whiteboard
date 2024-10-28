import clsx from "clsx";
import { useAtom } from "jotai";
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { deviceStatusAtom } from "../data/atoms";
import userRef from "../data/user";
import styled from "./SettingForm.module.scss";
import webrtcRef from "../data/webrtc";

const SettingForm = forwardRef(
  (
    {
      title,
      className,
      videoMode = "basic",
      isEditName = true,
      okBtnName = "변경사항 저장",
      cancelBtnName = "취소",
      isCancel = false,
      events = {
        onOk: () => {},
        onCancel: () => {},
      },
    }: {
      title?: string | null;
      isEditName?: boolean;
      className?: string;
      videoMode?: "full" | "basic";
      okBtnName?: string;
      cancelBtnName?: string;
      isCancel?: boolean;
      events?: {
        onOk?: () => void;
        onCancel?: () => void;
      };
    },
    ref,
  ) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const localStreamRef = useRef<MediaStream>();
    const [videoDevice, setVideoDevice] = useState<string>("");
    const [micDevice, setMicDevice] = useState<string>("");
    const [audioDevice, setAudioDevice] = useState<string>("");
    const [name, setName] = useState<string>(userRef.getUser()?.name || "");
    const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
    const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
    const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
    const [deviceStatus, setDeviceStatus] = useAtom(deviceStatusAtom);
    const [errorMessage, setErrorMessage] = useState<string>("");

    const videoId = useId();
    const micId = useId();
    const audioId = useId();
    const inputNameId = useId();

    const getDevices = useCallback(async () => {
      // 사용 가능한 미디어 디바이스 목록 가져오기
      return await navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          // 사용 가능한 비디오 디바이스 목록 가져오기
          const videoDevices = devices.filter(
            (device) => device.kind === "videoinput",
          );
          // 사용 가능한 오디오 디바이스 목록 가져오기
          const micDevices = devices.filter(
            (device) => device.kind === "audioinput",
          );
          // 사용 가능한 오디오 디바이스 목록 가져오기
          const audioDevices = devices.filter(
            (device) => device.kind === "audiooutput",
          );

          setVideoDevices(videoDevices);
          setMicDevices(micDevices);
          setAudioDevices(audioDevices);

          // 사용 가능한 비디오 디바이스가 있으면 선택할 수 있는 옵션을 제공
          if (videoDevices.length > 0) {
            return {
              videoDevices,
              micDevices,
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
    }, []);

    const changeVideoDevice = (event: React.ChangeEvent<HTMLSelectElement>) => {
      const newVideoDevice = event.target.value;
      setVideoDevice(newVideoDevice);

      // 선택한 장치 정보를 로컬스토리지에 저장
      localStorage.setItem("selectedVideoDevice", newVideoDevice);
    };

    const changeAudioDevice = (event: React.ChangeEvent<HTMLSelectElement>) => {
      const newAudioDevice = event.target.value;
      setAudioDevice(newAudioDevice);

      // 선택한 장치 정보를 로컬스토리지에 저장
      localStorage.setItem("selectedAudioDevice", newAudioDevice);
    };

    const changeMicDevice = (event: React.ChangeEvent<HTMLSelectElement>) => {
      const newMicDevice = event.target.value;
      setMicDevice(newMicDevice);

      // 선택한 장치 정보를 로컬스토리지에 저장
      localStorage.setItem("selectedMicDevice", newMicDevice);
    };

    const changeName = (event: React.ChangeEvent<HTMLInputElement>) => {
      setName((event.target as HTMLInputElement).value);
      sessionStorage.setItem(
        "name",
        (event.target as HTMLInputElement).value.toString(),
      );
    };

    useEffect(() => {
      // 로컬스토리지에서 이전에 저장된 장치 정보 가져오기
      const savedVideoDevice = localStorage.getItem("selectedVideoDevice");
      const savedAudioDevice = localStorage.getItem("selectedAudioDevice");
      const savedMicDevice = localStorage.getItem("selectedMicDevice");

      if (savedVideoDevice) {
        setVideoDevice(savedVideoDevice);
      }
      if (savedAudioDevice) {
        setAudioDevice(savedAudioDevice);
      }
      if (savedMicDevice) {
        setMicDevice(savedMicDevice);
      }

      getDevices();
    }, [getDevices, deviceStatus]);

    useEffect(() => {
      setErrorMessage("");
      const constraints = {
        video: videoDevice
          ? {
              deviceId: {
                exact: videoDevice,
              },
              width: 240,
              height: 240,
              frameRate: 30,
            }
          : { width: 240, height: 240, frameRate: 30 },
        audio: micDevice ? { deviceId: micDevice } : true,
      };
      navigator.mediaDevices
        .getUserMedia(constraints)
        .then((stream) => {
          if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach((track) => {
              track.stop();
            });
          }
          localStreamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play();
          }
        })
        .catch((err) => {
          setErrorMessage(
            ` 카메라 마이크 권한을 받지 못했거나\n장치를 사용 중이라 장치를 받아오지 못 했습니다.\n${err.message}`,
          );
          console.error(err);
        })
        .finally(() => {
          // 혹여 오류 났더라도, 권한이 허용되어있으면 리스트 받아 올 수 있으니까 리스트 불러옴.
          getDevices();
        });
    }, [videoDevice, micDevice, getDevices]);

    useEffect(() => {
      if (videoRef.current) {
        if (
          typeof videoRef.current?.sinkId !== "undefined" &&
          typeof videoRef.current?.setSinkId !== "undefined"
        ) {
          videoRef.current
            .setSinkId(audioDevice)
            .then(() => {
              console.info(
                `Success, audio output device attached: ${audioDevice}`,
              );
            })
            .catch((error) => {
              let errorMessage = error;
              if (error.name === "SecurityError") {
                errorMessage = `You need to use HTTPS for selecting audio output device: ${error}`;
              }
              console.error(errorMessage);
              setAudioDevice("");
            });
        } else {
          console.warn("Browser does not support output device selection.");
        }
      }
    }, [audioDevice, audioDevices]);

    const handleOk = async () => {
      if (!name) {
        setErrorMessage("이름을 입력하세요.");
        return false;
      }

      try {
        // 1. Update user name
        userRef.setAnonymousUser(name);

        // 2. Update device status in global state
        const newDeviceStatus = {
          ...deviceStatus,
          videoDeviceId: videoDevice,
          micDeviceId: micDevice,
          audioDeviceId: audioDevice,
          isVideo: !!videoDevice,
          isMic: !!micDevice,
        };
        setDeviceStatus(newDeviceStatus);

        // 3. Stop existing tracks
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((track) => track.stop());
        }

        // 4. Create new stream with selected devices
        const constraints = {
          video: videoDevice
            ? {
                deviceId: { exact: videoDevice },
                width: 240,
                height: 240,
                frameRate: 30,
              }
            : false,
          audio: micDevice ? { deviceId: { exact: micDevice } } : false,
        };

        const newStream = await navigator.mediaDevices.getUserMedia(
          constraints,
        );
        localStreamRef.current = newStream;

        // 5. Update video preview
        if (videoRef.current) {
          videoRef.current.srcObject = newStream;
          await videoRef.current.play();
        }

        // 6. Close existing WebRTC stream
        if (webrtcRef.getLocalStream()) {
          const oldStream = webrtcRef.getLocalStream();
          oldStream?.getTracks().forEach((track) => track.stop());
        }

        // 7. Set new stream and update connections
        await webrtcRef.setLocalStream(newStream);

        // 8. Update WebRTC connection with new stream
        await webrtcRef.connect();

        // 9. Close dialog and trigger callback
        if (typeof events?.onOk === "function") {
          events.onOk();
        }
      } catch (err) {
        console.error("Failed to save device settings:", err);
        setErrorMessage("설정을 저장하는 중 오류가 발생했습니다.");
      }
    };

    const handleCancel = (
      event: React.MouseEvent<HTMLButtonElement, MouseEvent>,
    ) => {
      if (typeof events.onCancel === "function") {
        events.onCancel();
      }
    };

    useEffect(() => {
      getDevices();
    }, [getDevices, deviceStatus]);

    useEffect(() => {
      if (videoDevices.length > 0 && !videoDevice) {
        setVideoDevice(videoDevices[0].deviceId);
      }
    }, [videoDevices, videoDevice]);

    useEffect(() => {
      if (micDevices.length > 0 && !micDevice) {
        setMicDevice(micDevices[0].deviceId);
      }
    }, [micDevices, micDevice]);

    useEffect(() => {
      if (audioDevices.length > 0 && !audioDevice) {
        setAudioDevice(audioDevices[0].deviceId);
      }
    }, [audioDevices, audioDevice]);

    return (
      <>
        <div className={clsx("setting-form", styled.SettingForm, className)}>
          <div className={styled["form-title"]}>{title}</div>
          <div className={styled["video-container"]}>
            {errorMessage.includes("카메라 마이크 권한을 받지 못했거나") ? (
              <div
                style={{
                  width: 320,
                  height: 240,
                  border: "1px solid #ebebeb",
                  backgroundImage: `url("data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAiIGhlaWdodD0iODAiIHZpZXdCb3g9IjAgMCA4MCA4MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGcgaWQ9IkF2YXRhciIgY2xpcC1wYXRoPSJ1cmwoI2NsaXAwXzI4NF8xNDAyOSkiPgo8ZyBpZD0iZ3JvdXAiPgo8cGF0aCBpZD0iVmVjdG9yIiBkPSJNODAgNDBDODAgMTcuOTA4NiA2Mi4wOTE0IDAgNDAgMEMxNy45MDg2IDAgMCAxNy45MDg2IDAgNDBDMCA2Mi4wOTE0IDE3LjkwODYgODAgNDAgODBDNjIuMDkxNCA4MCA4MCA2Mi4wOTE0IDgwIDQwWiIgZmlsbD0idXJsKCNwYWludDBfbGluZWFyXzI4NF8xNDAyOSkiLz4KPGcgaWQ9Ikdyb3VwIj4KPHBhdGggaWQ9IlZlY3Rvcl8yIiBkPSJNNDQuNjA5NCAzNy4zMzRDNDguNjA3NiAzOS4yMTQ5IDUyLjQxMjIgMzguODgyIDU2LjAyMzEgMzYuMzM1NCIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSI0IiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KPHBhdGggaWQ9IlZlY3Rvcl8zIiBkPSJNNDQuMjM3OSAyNy4wODZDNDQuMTE3NiAyNS43MTA1IDQyLjkwNSAyNC42OTMgNDEuNTI5NSAyNC44MTM0QzQwLjE1NDEgMjQuOTMzNyAzOS4xMzY2IDI2LjE0NjMgMzkuMjU3IDI3LjUyMTdDMzkuMzc3MyAyOC44OTcyIDQwLjU4OTkgMjkuOTE0NyA0MS45NjUzIDI5Ljc5NDNDNDMuMzQwOCAyOS42NzQgNDQuMzU4MyAyOC40NjE0IDQ0LjIzNzkgMjcuMDg2WiIgZmlsbD0id2hpdGUiLz4KPHBhdGggaWQ9IlZlY3Rvcl80IiBkPSJNNTcuNTE5MiAyNS45MjM4QzU3LjM5ODggMjQuNTQ4NCA1Ni4xODYzIDIzLjUzMDkgNTQuODEwOCAyMy42NTEzQzUzLjQzNTMgMjMuNzcxNiA1Mi40MTc5IDI0Ljk4NDIgNTIuNTM4MiAyNi4zNTk2QzUyLjY1ODUgMjcuNzM1MSA1My44NzExIDI4Ljc1MjYgNTUuMjQ2NiAyOC42MzIyQzU2LjYyMiAyOC41MTE5IDU3LjYzOTUgMjcuMjk5MyA1Ny41MTkyIDI1LjkyMzhaIiBmaWxsPSJ3aGl0ZSIvPgo8L2c+CjwvZz4KPC9nPgo8ZGVmcz4KPGxpbmVhckdyYWRpZW50IGlkPSJwYWludDBfbGluZWFyXzI4NF8xNDAyOSIgeDE9IjcyLjUiIHkxPSItMTEiIHgyPSItMjQuNTcwOCIgeTI9IjcwLjcwNjEiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KPHN0b3Agc3RvcC1jb2xvcj0iIzY5RTRGRiIvPgo8c3RvcCBvZmZz
                  ZXQgPSIwLjMzIiBzdG9wLWNvbG9yPSIjNUM2M0YzIi8+CjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI0MxNjFGRiIvPgo8L2xpbmVhckdyYWRpZW50Pgo8Y2xpcFBhdGggaWQ9ImNsaXAwXzI4NF8xNDAyOSI+CjxyZWN0IHdpZHRoPSI4MCIgaGVpZ2h0PSI4MCIgZmlsbD0id2hpdGUiLz4KPC9jbGlwUGF0aD4KPC9kZWZzPgo8L3N2Zz4K")`,
                  backgroundPosition: "center",
                  backgroundRepeat: "no-repeat",
                  borderRadius: 16,
                  // backgroundSize: "contain",
                }}
              ></div>
            ) : (
              <video className={videoMode} ref={videoRef}></video>
            )}
          </div>
          <div className={styled.devices}>
            {errorMessage && <div className={styled.error}>{errorMessage}</div>}
            <div style={isEditName ? {} : { display: "none" }}>
              <label htmlFor={inputNameId}>이름</label>
              <input
                type="text"
                defaultValue={name}
                id={inputNameId}
                onChange={changeName}
              />
            </div>
            <div>
              <label htmlFor={videoId}>카메라</label>
              <select
                onChange={changeVideoDevice}
                value={videoDevice}
                id={videoId}
              >
                <option key={0}>카메라 선택</option>
                {videoDevices.map((device, index) => (
                  <option key={index + 1} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={micId}>마이크</label>
              <select onChange={changeMicDevice} value={micDevice} id={micId}>
                <option key={0}>마이크 선택</option>
                {micDevices.map((device, index) => (
                  <option key={index + 1} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={audioId}>오디오</label>
              <select
                onChange={changeAudioDevice}
                value={audioDevice}
                id={audioId}
              >
                <option key={0}>오디오 선택</option>
                {audioDevices.map((device, index) => (
                  <option key={index + 1} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className={styled.buttons}>
            {isCancel && (
              <button
                type="button"
                className="btn btn-outline"
                onClick={handleCancel}
              >
                {cancelBtnName}
              </button>
            )}
            <button
              type="button"
              className="btn btn-fill btn-primary"
              onClick={handleOk}
            >
              {okBtnName}
            </button>
          </div>
        </div>
      </>
    );
  },
);

export default SettingForm;
