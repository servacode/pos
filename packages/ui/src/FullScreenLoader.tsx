import { LogoMark } from './Logo';
import { Spinner } from './Spinner';

/**
 * While a screen loads: the mark and a small spinner, centred on the page colour (هوية 4). Fades in,
 * so a load that ends at once shows nothing that jumps.
 */
export function FullScreenLoader() {
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas">
      <div className="flex flex-col items-center gap-6 motion-safe:animate-fade">
        <LogoMark className="size-12" />
        <Spinner label="جارٍ التحميل…" className="size-5 text-brand" />
      </div>
    </div>
  );
}
