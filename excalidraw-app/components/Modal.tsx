import React from "react";
import styled from "styled-components";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";

const Modal: React.FC<{
  children: React.ReactNode;
  isOpen: boolean;
  setIsOpen: any;
}> = ({ children, isOpen, setIsOpen }) => {
  return createPortal(
    <ModalContainer isVisible={isOpen}>
      <AnimatePresence>
        {isOpen && (
          <ModalBlock
            isVisible={isOpen}
            initial={{
              opacity: 0,
              scale: 0.68,
            }}
            animate={{
              opacity: 1,
              scale: 1,
              transition: {
                ease: "easeOut",
                duration: 0.15,
              },
            }}
            exit={{
              opacity: 0,
              scale: 0.68,
              transition: {
                ease: "easeIn",
                duration: 0.15,
              },
            }}
          >
            {children}
          </ModalBlock>
        )}
      </AnimatePresence>
      <Background onClick={() => setIsOpen(false)}></Background>
    </ModalContainer>,
    document.body,
  );
};

const Background = styled.div`
  background: rgba(0, 0, 0, 0.5);
  width: 100%;
  height: 100%;

  position: absolute;
  z-index: -1;
`;

const ModalContainer = styled.div<{ isVisible?: boolean }>`
  width: 100%;
  height: 100%;

  display: flex;
  justify-content: center;
  align-items: center;

  /* background: rgba(0, 0, 0, 0.5); */
  position: fixed;
  top: 0;
  left: 50%;
  transform: translate(-50%, 0);

  opacity: ${(props) => (props.isVisible ? 1 : 0)};
  pointer-events: ${(props) => (props.isVisible ? "auto" : "none")};
  transition: opacity 0.1s ease-in-out;

  z-index: 100000;

  padding: 20px;
`;

const ModalBlock = styled(motion.div)<{ isVisible?: boolean }>`
  /* width: 100%; */
  /* max-width: 1220px; */
  overflow: scroll;
  /* padding: 40px; */

  display: flex;
  flex-direction: column;
  align-items: center;
  /* background: #fff; */
  position: relative;
  overflow: hidden;
`;

export default Modal;
