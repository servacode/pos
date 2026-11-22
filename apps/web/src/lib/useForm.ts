import { useRef, useState, type FormEvent } from 'react';
import { errorMessage } from './api';
import { apiFieldErrors, focusFirstError, issuesToFieldErrors, type FieldErrors, type Issue } from './forms';

export type ValidationResult<TData> =
  { success: true; data: TData } | { success: false; error: { issues: readonly Issue[] } };

interface UseFormOptions<TValues, TData> {
  initialValues: TValues | (() => TValues);
  fieldOrder: readonly (keyof TValues & string)[];
  validate: (values: TValues) => ValidationResult<TData>;
  onSubmit: (data: TData) => Promise<void>;
}

export function useForm<TValues extends object, TData>({
  initialValues,
  fieldOrder,
  validate,
  onSubmit,
}: UseFormOptions<TValues, TData>) {
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<TValues>(initialValues);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function setValue<K extends keyof TValues & string>(name: K, value: TValues[K]) {
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => (current[name] ? { ...current, [name]: undefined } : current));
  }

  function showErrors(fieldErrors: FieldErrors) {
    setErrors(fieldErrors);
    focusFirstError(formRef.current, fieldOrder, fieldErrors);
  }

  /** On leaving a field: its own message appears now, without waiting for the save (nothing is focused or cleared elsewhere) */
  function validateField(name: keyof TValues & string) {
    const result = validate(values);
    if (result.success) return;
    const message = issuesToFieldErrors(result.error.issues)[name];
    if (message) setErrors((current) => ({ ...current, [name]: message }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const result = validate(values);
    if (!result.success) {
      showErrors(issuesToFieldErrors(result.error.issues));
      return;
    }

    setErrors({});
    setSubmitting(true);
    try {
      await onSubmit(result.data);
    } catch (error) {
      const fieldErrors = apiFieldErrors(error);
      const message = errorMessage(error);
      setFormError(Object.values(fieldErrors).includes(message) ? null : message);
      showErrors(fieldErrors);
    } finally {
      setSubmitting(false);
    }
  }

  return { formRef, values, setValue, validateField, errors, formError, submitting, handleSubmit };
}
