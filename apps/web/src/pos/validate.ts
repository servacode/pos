import { documentPayloadRejection, type OutboxEntry } from '@serva/sync';
import type { NewDocument } from '@serva/sync/client';

export class InvalidDocumentError extends Error {
  override readonly name = 'InvalidDocumentError';
}

/**
 * Checks a document against its contract schema before it is saved (contract step 4: the device
 * runs validateDocumentPayload before saving), so a malformed document never takes a number. Kept
 * out of the sign-in chunk: only the cashier app saves documents.
 */
export function validated(
  save: (input: NewDocument) => Promise<OutboxEntry>,
): (input: NewDocument) => Promise<OutboxEntry> {
  return async (input) => {
    const rejection = documentPayloadRejection({ type: input.type, payload: input.payload });
    if (rejection) {
      throw new InvalidDocumentError(
        `${input.type} payload: ${rejection.issues.map((i) => `${i.path} ${i.message}`).join('; ')}`,
      );
    }
    return save(input);
  };
}
