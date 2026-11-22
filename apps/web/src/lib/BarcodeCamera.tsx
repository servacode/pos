import { useEffect, useRef, useState } from 'react';
import { Alert, Button, CloseIcon } from '@serva/ui';

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorClass = new (options: { formats: string[] }) => BarcodeDetectorLike;

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];

function detectorClass(): BarcodeDetectorClass | null {
  const value = (globalThis as { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector;
  return typeof value === 'function' ? value : null;
}

/** True when this browser can read product barcodes from the camera (BarcodeDetector + a camera API). */
export function canScanBarcodes(): boolean {
  return detectorClass() !== null && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

const SCAN_EVERY_MS = 250;
/** The same code in view is counted once, then again only after this long (or after another code) */
const REPEAT_AFTER_MS = 1500;

/**
 * Reads product barcodes with the camera (the back one on a phone), one after another, until it is closed:
 * the stocktake counts each scan. A code held in front of the lens counts once, not on every frame.
 */
export function BarcodeCamera({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  useEffect(() => {
    const Detector = detectorClass();
    if (!Detector) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    let last = { code: '', at: 0 };
    const detector = new Detector({ formats: FORMATS });

    async function scan() {
      const video = videoRef.current;
      if (!alive || !video) return;
      try {
        const codes = await detector.detect(video);
        const now = Date.now();
        for (const found of codes) {
          if (found.rawValue !== last.code || now - last.at > REPEAT_AFTER_MS) {
            last = { code: found.rawValue, at: now };
            onCodeRef.current(found.rawValue);
          } else {
            last = { ...last, at: now };
          }
        }
      } catch {
        // No frame yet: try again on the next tick.
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
        if (alive) setError('لم نستطع فتح الكاميرا. اسمح للمتصفح باستعمالها، أو اكتب الباركود بيدك.');
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
        <div className="relative overflow-hidden rounded-card border border-line bg-sidebar shadow-e1">
          <video
            ref={videoRef}
            muted
            playsInline
            aria-label="الكاميرا: وجّهها إلى الباركود"
            className="aspect-video w-full object-cover"
          />
          <span aria-hidden="true" className="absolute inset-[18%] rounded-card border-4 border-on-mark/80" />
        </div>
      )}
      <Button variant="secondary" fullWidth icon={<CloseIcon />} onClick={onClose}>
        أغلق الكاميرا
      </Button>
    </div>
  );
}
