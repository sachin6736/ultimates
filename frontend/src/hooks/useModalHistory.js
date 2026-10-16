import { useEffect, useRef, useCallback } from 'react';

/**
 * Syncs a modal or drawer's open state with the browser History API.
 * - When the modal opens, an entry is pushed to window.history.
 * - When the user taps the device hardware back button / swipe back, the modal closes without leaving the page.
 * - Returns a wrapped `closeModal` callback to attach to Close/Cancel/Backdrop buttons.
 *
 * @param {boolean} isOpen - Whether the modal or drawer is open
 * @param {Function} onClose - State setter callback to close the modal
 * @param {string} modalKey - Unique identifier for this modal
 * @returns {Function} closeModal - Safe close function that pops history if needed
 */
export function useModalHistory(isOpen, onClose, modalKey) {
  const isPushedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (isOpen) {
      const currentSubModal = window.history.state?.subModal;
      if (currentSubModal !== modalKey) {
        const nextState = {
          ...(window.history.state || {}),
          isAppNav: true,
          subModal: modalKey,
          subModalAt: Date.now()
        };
        window.history.pushState(nextState, '');
        isPushedRef.current = true;
      }

      const handlePopState = (event) => {
        if (event.state?.subModal !== modalKey) {
          isPushedRef.current = false;
          onCloseRef.current?.();
        }
      };

      window.addEventListener('popstate', handlePopState);
      return () => {
        window.removeEventListener('popstate', handlePopState);
      };
    } else {
      isPushedRef.current = false;
    }
  }, [isOpen, modalKey]);

  const closeModal = useCallback(() => {
    if (isPushedRef.current && window.history.state?.subModal === modalKey) {
      window.history.back();
    } else {
      onClose();
    }
  }, [onClose, modalKey]);

  return closeModal;
}

export default useModalHistory;
