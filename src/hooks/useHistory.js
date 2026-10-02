import { useState, useCallback, useRef } from 'react';

export function useHistory(initialState = [], maxSteps = 10) {
  const [state, _setState] = useState(initialState);
  const historyRef = useRef([initialState]);
  const pointerRef = useRef(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const updateFlags = () => {
    setCanUndo(pointerRef.current > 0);
    setCanRedo(pointerRef.current < historyRef.current.length - 1);
  };

  const setState = useCallback((action) => {
    _setState(prev => {
      const nextState = typeof action === 'function' ? action(prev) : action;
      if (nextState === prev) return prev;
      
      const newHistory = historyRef.current.slice(0, pointerRef.current + 1);
      newHistory.push(nextState);
      
      if (newHistory.length > maxSteps + 1) {
        newHistory.shift();
      } else {
        pointerRef.current++;
      }
      
      historyRef.current = newHistory;
      updateFlags();
      
      return nextState;
    });
  }, [maxSteps]);

  const undo = useCallback(() => {
    if (pointerRef.current > 0) {
      pointerRef.current--;
      _setState(historyRef.current[pointerRef.current]);
      updateFlags();
    }
  }, []);

  const redo = useCallback(() => {
    if (pointerRef.current < historyRef.current.length - 1) {
      pointerRef.current++;
      _setState(historyRef.current[pointerRef.current]);
      updateFlags();
    }
  }, []);

  const reset = useCallback((newState) => {
    const nextState = typeof newState === 'function' ? newState(state) : newState;
    _setState(nextState);
    historyRef.current = [nextState];
    pointerRef.current = 0;
    updateFlags();
  }, [state]);

  return [state, setState, undo, redo, reset, canUndo, canRedo];
}
