import { useAtom } from "jotai";
import { showDeviceDialogAtom } from "../data/atoms";
import styled from "./DeviceDialog.module.scss";
import SettingForm from "./SettingForm";

// DeviceDialog 컴포넌트 수정
const DeviceDialog = ({ isEditName = true }: { isEditName: boolean }) => {
  const [showDeviceDialog, setShowDeviceDialog] = useAtom(showDeviceDialogAtom);

  const handleClose = () => {
    setShowDeviceDialog(false);
  };

  const handleSave = async () => {
    // 약간의 딜레이를 주어 WebRTC 연결이 완료되도록 함
    setTimeout(() => {
      setShowDeviceDialog(false);
    }, 500);
  };

  return (
    <>
      {showDeviceDialog ? (
        <div className={styled.WebRTCDialog}>
          <button
            type="button"
            className={styled.closeBtn}
            onClick={handleClose}
          >
            <i className="wb-icon wb-icon-close"></i>
          </button>
          <SettingForm
            title="화상 설정"
            className="dialog"
            isEditName={isEditName}
            videoMode="basic"
            isCancel={true}
            okBtnName="변경사항 저장"
            events={{
              onCancel: handleClose,
              onOk: handleSave,
            }}
          ></SettingForm>
        </div>
      ) : (
        ""
      )}
    </>
  );
};

export default DeviceDialog;
