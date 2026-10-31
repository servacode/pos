import { useEffect, useRef, useState } from 'react';
import { parsePairingQr } from '@serva/core';
import { Alert, Button, CloseIcon } from '@serva/ui';

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}

type BarcodeDetectorClass = new (options: { formats: string[] }) => BarcodeDetectorLike;

function detectorClass(): BarcodeDetectorClass | null {
  const value = (globalThis as { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector;
  return typeof value === 'function' ? value : null;
}

/** True when this browser can read a QR from the camera (BarcodeDetector + a camera API). */
export function canScanQr(): boolean {
  return detectorClass() !== null && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

const SCAN_EVERY_MS = 300;

/**
 * Reads the pairing QR with the camera (the back one on a tablet). Anything that is not a Serva
 * pairing link is ignored and the scan goes on. The camera stops when this closes.
 */
export function QrScanner({ onToken, onClose }: { onToken: (token: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    const Detector = detectorClass();
    if (!Detector) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    const detector = new Detector({ formats: ['qr_code'] });

    async function scan() {
      const video = videoRef.current;
      if (!alive || !video) return;
      try {
        const codes = await detector.detect(video);
        for (const code of codes) {
          const token = parsePairingQr(code.rawValue);
          if (token && alive) {
            // Turn the camera off at once, not when the screen happens to unmount.
            alive = false;
            stream?.getTracks().forEach((track) => track.stop());
            stream = null;
            onTokenRef.current(token);
            return;
          }
        }
      } catch {
        // The video has no frame yet: try again on the next tick.
      }
      if (alive) timer = setTimeout(() => void scan(), SCAN_EVERY_MS);
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(async (media) => {
        if (!alive) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        const video = videoRef.current;
        if (video) {
          video.srcObject = media;
          await Promise.resolve(video.play()).catch(() => undefined);
        }
        void scan();
      })
      .catch(() => {
        if (alive) setError('لم نستطع فتح الكاميرا. اسمح للمتصفح باستعمالها، أو الصق رابط الربط.');
      });

    return () => {
      alive = false;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <Alert tone="error">{error}</Alert>
      ) : (
        <div className="relative overflow-hidden rounded-card bg-ink">
          <video
            ref={videoRef}
            muted
            playsInline
            aria-label="الكاميرا: وجّهها إلى رمز QR"
            className="aspect-video w-full object-cover"
          />
          <span
            aria-hidden="true"
            className="absolute inset-[18%] rounded-card border-4 border-on-brand/80"
          />
        </div>
      )}
      <Button variant="secondary" icon={<CloseIcon />} onClick={onClose}>
        أغلق الكاميرا
      </Button>
    </div>
  );
}
