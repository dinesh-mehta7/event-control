// Phone / mobile inputs accept digits only (max 15, the international limit).
// Spread `phoneInputProps` on the <input> and pass the typed value through `digitsOnly` in onChange.
export const digitsOnly = (value: string): string => value.replace(/\D/g, '').slice(0, 15);

export const phoneInputProps = {
  type: 'tel',
  inputMode: 'numeric',
  pattern: '[0-9]*',
  maxLength: 15,
  autoComplete: 'tel',
} as const;
