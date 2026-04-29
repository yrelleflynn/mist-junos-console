import { useCallback, useRef, useState } from 'react';

export type SerialStatus = 'closed' | 'opening' | 'open' | 'error';

interface UseSerialResult {
  status: SerialStatus;
  open: (onData: (chunk: Uint8Array) => void) => Promise<void>;
  write: (data: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
}

const DEFAULT_OPTIONS: SerialOptions = {
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  flowControl: 'none',
};

export function useSerial(): UseSerialResult {
  const [status, setStatus] = useState<SerialStatus>('closed');
  const portRef = useRef<SerialPort | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  const open = useCallback(async (onData: (chunk: Uint8Array) => void) => {
    if (!('serial' in navigator)) {
      setStatus('error');
      throw new Error('Web Serial API not supported in this browser');
    }

    setStatus('opening');
    try {
      const port = await navigator.serial.requestPort();
      await port.open(DEFAULT_OPTIONS);
      portRef.current = port;

      if (port.writable) {
        writerRef.current = port.writable.getWriter();
      }

      if (port.readable) {
        const reader = port.readable.getReader();
        readerRef.current = reader;

        (async () => {
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              if (value) onData(value);
            }
          } catch {
            // stream closed or port disconnected
          } finally {
            setStatus('closed');
          }
        })();
      }

      setStatus('open');
    } catch (err) {
      setStatus('error');
      throw err;
    }
  }, []);

  const write = useCallback(async (data: Uint8Array) => {
    if (writerRef.current) {
      await writerRef.current.write(data);
    }
  }, []);

  const close = useCallback(async () => {
    try {
      readerRef.current?.cancel();
      writerRef.current?.releaseLock();
      await portRef.current?.close();
    } catch {
      // ignore errors on close
    } finally {
      portRef.current = null;
      writerRef.current = null;
      readerRef.current = null;
      setStatus('closed');
    }
  }, []);

  return { status, open, write, close };
}
