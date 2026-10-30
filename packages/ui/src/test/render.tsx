import { DirectionProvider } from '@radix-ui/react-direction';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { DensityProvider, DigitsProvider, type Density, type Digits } from '../context';

interface Options {
  dir?: 'rtl' | 'ltr';
  density?: Density;
  digits?: Digits;
}

/** Renders as the apps do: inside an RTL page and Radix direction provider. */
export function renderUi(
  ui: ReactElement,
  { dir = 'rtl', density = 'comfortable', digits = 'latn' }: Options = {},
) {
  const user = userEvent.setup();
  const result = render(
    <DirectionProvider dir={dir}>
      <DigitsProvider digits={digits}>
        <DensityProvider density={density}>
          <div dir={dir}>{ui}</div>
        </DensityProvider>
      </DigitsProvider>
    </DirectionProvider>,
  );
  return { user, ...result };
}
