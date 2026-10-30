import { LogoMark } from './Logo';
import { Spinner } from './Spinner';

export function FullScreenLoader() {
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas">
      <div className="flex flex-col items-center gap-5 motion-safe:animate-rise">
        <LogoMark className="size-14" />
        <Spinner label="جارٍ التحميل…" className="size-6 text-brand" />
      </div>
    </div>
  );
}
