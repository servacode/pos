import { Button, TextField } from '@serva/ui';
import { useState } from 'react';
import type { ReceiptData } from './Receipt';
import { whatsappLink } from './whatsapp';

/**
 * «أرسل عبر واتساب»: opens the customer's chat with the receipt as text, a plain link with no
 * server. With the customer's number known it is one tap; without one it asks for the number.
 */
export function WhatsAppSend({
  data,
  phone,
  className,
}: {
  data: ReceiptData;
  phone: string | null;
  className?: string;
}) {
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const open = (number: string | null): boolean => {
    const link = whatsappLink(number, data);
    if (!link) return false;
    window.open(link, '_blank', 'noopener,noreferrer');
    return true;
  };
  if (typing) {
    return (
      <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-end">
        <TextField
          label="رقم جوال الزبون"
          type="tel"
          inputMode="tel"
          dir="ltr"
          placeholder="0933 123 456"
          value={typed}
          error={error || undefined}
          onChange={(e) => {
            setTyped(e.target.value);
            setError('');
          }}
          className="flex-1"
        />
        <Button
          size="lg"
          onClick={() => {
            if (!open(typed)) setError('رقم الجوال غير صحيح. مثال: 0912345678');
          }}
        >
          أرسل
        </Button>
      </div>
    );
  }
  return (
    <Button
      variant="secondary"
      size="lg"
      className={className}
      onClick={() => {
        if (phone && open(phone)) return;
        setTyping(true);
      }}
    >
      أرسل عبر واتساب
    </Button>
  );
}
