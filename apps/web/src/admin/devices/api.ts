import type {
  CreatePairingCodeInput,
  DeviceListResponse,
  DeviceSummary,
  PairingCodeResponse,
  RenameDeviceInput,
} from '@serva/core';
import { apiFetch } from '../../lib/api';

// The owner's and manager's device requests (17 › الأجهزة). The server checks every permission.

export function listDevices() {
  return apiFetch<DeviceListResponse>('/v1/devices', { auth: true });
}

export function createPairingCode(input: CreatePairingCodeInput) {
  return apiFetch<PairingCodeResponse>('/v1/devices/pairing-codes', {
    method: 'POST',
    body: input,
    auth: true,
  });
}

export type DeviceDecision = 'approve' | 'reject' | 'revoke';

export function decideDevice(id: string, decision: DeviceDecision) {
  return apiFetch<DeviceSummary>(`/v1/devices/${encodeURIComponent(id)}/${decision}`, {
    method: 'POST',
    auth: true,
  });
}

export function renameDevice(id: string, input: RenameDeviceInput) {
  return apiFetch<DeviceSummary>(`/v1/devices/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: input,
    auth: true,
  });
}
