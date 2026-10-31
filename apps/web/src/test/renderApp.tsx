import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App } from '../App';
// App lazy-loads these; loading them up front keeps the first test of a file from spending
// its findBy timeout on compiling the chunk.
import '../admin/AdminApp';
import '../admin/devices/DevicesPage';
import '../pos/PosApp';
import '../pos/staff/StaffSignIn';
import '../pos/CashierApp';
import '../pos/link/DeviceLink';

export function renderApp(path = '/') {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return { user };
}
