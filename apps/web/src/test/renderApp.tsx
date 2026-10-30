import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App } from '../App';
// App lazy-loads these two; loading them up front keeps the first test of a file from spending
// its findBy timeout on compiling the chunk.
import '../admin/AdminApp';
import '../pos/PosApp';

export function renderApp(path = '/') {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return { user };
}
