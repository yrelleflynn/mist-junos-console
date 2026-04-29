import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import 'xterm/css/xterm.css';

export interface TerminalHandle {
  write(data: Uint8Array): void;
  clear(): void;
}

interface TerminalProps {
  onData: (data: Uint8Array) => void;
}

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(
  function Terminal({ onData }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<XTerm | null>(null);
    const fitRef = useRef<FitAddon | null>(null);

    useImperativeHandle(ref, () => ({
      write(data: Uint8Array) {
        xtermRef.current?.write(data);
      },
      clear() {
        xtermRef.current?.clear();
      },
    }));

    useEffect(() => {
      if (!containerRef.current) return;

      const xterm = new XTerm({
        theme: {
          background: '#0d0d0f',
          foreground: '#e8e8ed',
          cursor: '#4f9cf9',
          selectionBackground: '#4f9cf940',
        },
        fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
        fontSize: 13,
        lineHeight: 1.2,
        cursorBlink: true,
        scrollback: 5000,
        convertEol: true,
      });

      const fit = new FitAddon();
      const links = new WebLinksAddon();
      xterm.loadAddon(fit);
      xterm.loadAddon(links);
      xterm.open(containerRef.current);
      fit.fit();

      xtermRef.current = xterm;
      fitRef.current = fit;

      xterm.onData((data) => {
        onData(new TextEncoder().encode(data));
      });

      const observer = new ResizeObserver(() => fit.fit());
      observer.observe(containerRef.current);

      return () => {
        observer.disconnect();
        xterm.dispose();
        xtermRef.current = null;
        fitRef.current = null;
      };
    }, [onData]);

    return (
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', overflow: 'hidden' }}
      />
    );
  },
);
