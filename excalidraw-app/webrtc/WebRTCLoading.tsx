import styled from "./WebRTCLoading.module.scss";

const WebRTCLoading = () => {
  return (
    <div className={styled.Loading}>
      <div className={styled.loader}></div>
    </div>
  );
};

export default WebRTCLoading;
