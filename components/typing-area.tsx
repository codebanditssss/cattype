import { useState, useEffect, useCallback, useRef } from 'react';
import { CodeSnippet } from '@/lib/code-snippets';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useGesture } from '@use-gesture/react';
import { useTypingStore } from '@/lib/store';
import { getIndentationForLanguage, calculateIndentation } from '@/lib/indentation-rules';
import useSound from 'use-sound';

interface TypingAreaProps {
  snippet: CodeSnippet;
  timeLeft: number;
  onType: (text: string) => void;
  cursorPosition: number;
  setCursorPosition: (pos: number) => void;
  currentText: string;
}

const SAMPLE_INTERVAL = 1000; // 1 second

export function TypingArea({
  snippet,
  timeLeft,
  onType,
  cursorPosition,
  setCursorPosition,
  currentText
}: TypingAreaProps) {
  const [isCursorVisible, setIsCursorVisible] = useState(true);
  const [hasStartedTyping, setHasStartedTyping] = useState(false);
  const [errorCount, setErrorCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastSampleTime = useRef<number>(0);
  const MAX_LINE_LENGTH = 60; // Maximum characters per line

  const {
    addWPMSample,
    updateAccuracy,
    updateCharacters,
    setComplete,
    settings
  } = useTypingStore();

  // Sound effects
  const [playKeyPress] = useSound('/sounds/keypress.mp3', { volume: 0.5 });
  const [playError] = useSound('/sounds/keypress.mp3', { volume: 0.3 });
  const [playEnter] = useSound('/sounds/keypress.mp3', { volume: 0.5 });
  const [playBackspace] = useSound('/sounds/keypress.mp3', { volume: 0.4 });

  // Cursor blinking effect
  useEffect(() => {
    const blinkInterval = setInterval(() => {
      setIsCursorVisible((prev) => !prev);
    }, 530);
    return () => clearInterval(blinkInterval);
  }, []);

  const calculateAndUpdateStats = useCallback(() => {
    const timeElapsed = (30 - timeLeft) / 60; // Convert to minutes
    if (timeElapsed > 0) {
      const wordCount = currentText.length / 5;
      const wpm = Math.round(wordCount / timeElapsed);
      const raw = Math.round((currentText.length / 5) / timeElapsed);
      
      addWPMSample(wpm, raw, errorCount);
      
      // Calculate accuracy
      const totalChars = currentText.length;
      const correctChars = currentText.split('').filter((char, i) => char === snippet.code[i]).length;
      const accuracy = totalChars > 0 ? (correctChars / (totalChars + errorCount)) * 100 : 0;
      updateAccuracy(accuracy);
      
      // Update character stats
      updateCharacters({
        correct: correctChars,
        incorrect: totalChars - correctChars,
        extra: Math.max(0, totalChars - snippet.code.length),
        missed: Math.max(0, snippet.code.length - totalChars),
      });
    }
  }, [timeLeft, currentText, snippet.code, errorCount, addWPMSample, updateAccuracy, updateCharacters]);

  // Calculate and store WPM periodically
  useEffect(() => {
    if (!hasStartedTyping) return;

    const now = Date.now();
    if (now - lastSampleTime.current >= SAMPLE_INTERVAL) {
      calculateAndUpdateStats();
      lastSampleTime.current = now;
    }

    const interval = setInterval(() => {
      const now = Date.now();
      if (now - lastSampleTime.current >= SAMPLE_INTERVAL) {
        calculateAndUpdateStats();
        lastSampleTime.current = now;
      }
    }, 100);

    return () => clearInterval(interval);
  }, [hasStartedTyping, calculateAndUpdateStats]);

  // Handle completion when text matches exactly
  useEffect(() => {
    if (currentText === snippet.code) {
      calculateAndUpdateStats();
      const elapsedTime = (30 - timeLeft);
      setComplete(elapsedTime);
    }
  }, [currentText, snippet.code, timeLeft, calculateAndUpdateStats, setComplete]);

  // Auto-scroll to cursor
  useEffect(() => {
    if (containerRef.current) {
      const container = containerRef.current;
      const cursorElement = container.querySelector('[data-cursor]');
      if (cursorElement) {
        cursorElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [cursorPosition]);

  // Add effect to handle focus when typing starts
  useEffect(() => {
    if (hasStartedTyping) {
      // Remove focus from all other focusable elements
      document.querySelectorAll('button, [tabindex="0"]').forEach(element => {
        if (element !== containerRef.current) {
          (element as HTMLElement).setAttribute('tabindex', '-1');
        }
      });

      // Ensure typing area stays focused
      containerRef.current?.focus();
    }

    // Cleanup function to restore focusability when component unmounts
    return () => {
      document.querySelectorAll('[tabindex="-1"]').forEach(element => {
        element.setAttribute('tabindex', '0');
      });
    };
  }, [hasStartedTyping]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!hasStartedTyping) {
        setHasStartedTyping(true);
      }

      // Handle special keys
      if (e.key === "Backspace") {
        e.preventDefault();
        if (cursorPosition > 0) {
          onType(currentText.slice(0, cursorPosition - 1) + currentText.slice(cursorPosition));
          setCursorPosition(cursorPosition - 1);
        }
        return;
      }

      // Only handle printable characters
      if (e.key.length !== 1 || e.metaKey || e.ctrlKey) {
        return;
      }

      e.preventDefault();

      // Check if adding this character would make the current line too long
      const newText = currentText.slice(0, cursorPosition) + e.key + currentText.slice(cursorPosition);
      const lines = newText.slice(0, cursorPosition + 1).split('\n');
      const currentLine = lines[lines.length - 1];

      if (currentLine.length >= MAX_LINE_LENGTH) {
        // Automatically insert a newline
        const textBeforeCursor = currentText.slice(0, cursorPosition);
        const textAfterCursor = currentText.slice(cursorPosition);
        const newTextWithLineBreak = textBeforeCursor + '\n' + e.key + textAfterCursor;
        onType(newTextWithLineBreak);
        setCursorPosition(cursorPosition + 2); // +2 for newline and new character
      } else {
        onType(newText);
        setCursorPosition(cursorPosition + 1);
      }

      // Check for errors
      if (e.key !== snippet.code[cursorPosition]) {
        setErrorCount(prev => prev + 1);
      }
    },
    [cursorPosition, currentText, onType, setCursorPosition, hasStartedTyping, snippet.code]
  );

  // Bind keyboard events
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Touch/mobile gesture handling
  const bind = useGesture({
    onTouchStart: () => {
      if (containerRef.current) {
        containerRef.current.focus();
      }
    },
  });

  const renderText = () => {
    const targetText = snippet.code;
    const chars = targetText.split('');
    const typedChars = currentText.split('');
    
    return (
      <div 
        ref={containerRef}
        className="relative font-mono text-xl leading-relaxed whitespace-pre-wrap outline-none max-w-[80ch] mx-auto"
        tabIndex={0}
        {...bind()}
      >
        {/* Timer - only show if typing has started */}
        <AnimatePresence>
          {hasStartedTyping && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute -top-8 left-0 text-xl font-mono text-primary"
            >
              <motion.span
                key={timeLeft}
                initial={{ scale: 1.2 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
              >
                {timeLeft}
              </motion.span>
              {settings.showErrors && (
                <span className="ml-4 text-sm text-muted-foreground">
                  Errors: {errorCount}
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Background (untyped) text */}
        <div className="text-muted-foreground opacity-50">
          {targetText}
        </div>
        
        {/* Overlay (typed) text with cursor */}
        <div className="absolute top-0 left-0 whitespace-pre-wrap">
          {typedChars.map((char, index) => {
            const isWithinTargetText = index < chars.length;
            const isCorrect = isWithinTargetText && char === chars[index];
            
            if (index === cursorPosition) {
              return (
                <motion.span 
                  key={`cursor-${index}`}
                  data-cursor
                  className={cn(
                    "text-primary",
                    isCursorVisible ? 'opacity-100' : 'opacity-0'
                  )}
                  animate={{
                    opacity: isCursorVisible ? 1 : 0
                  }}
                  transition={{
                    duration: 0.2
                  }}
                  style={{ borderRight: '2px solid currentColor' }}
                />
              );
            }
            
            return (
              <motion.span
                key={index}
                initial={{ scale: 1.2, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 400, damping: 20 }}
                className={cn(
                  isCorrect ? 'text-primary' : 'text-destructive',
                  !isWithinTargetText && 'opacity-50'
                )}
              >
                {char}
              </motion.span>
            );
          })}
          {cursorPosition === typedChars.length && (
            <motion.span 
              data-cursor
              className={cn(
                "text-primary",
                isCursorVisible ? 'opacity-100' : 'opacity-0'
              )}
              animate={{
                opacity: isCursorVisible ? 1 : 0
              }}
              transition={{
                duration: 0.2
              }}
              style={{ borderRight: '2px solid currentColor' }}
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <div 
      className="w-full max-w-3xl relative"
      onPaste={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {renderText()}
    </div>
  );
} 