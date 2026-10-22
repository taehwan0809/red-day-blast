export type NativeDatePickerInput = Pick<HTMLInputElement, 'focus' | 'click'> & {
  showPicker?: () => void;
};

const syntheticClicks = new WeakSet<object>();

export function openNativeDatePicker(input: NativeDatePickerInput | null) {
  if (!input) return false;
  if (typeof input.showPicker === 'function') {
    try {
      input.showPicker();
      return true;
    } catch {
      // Some browsers reject showPicker outside a trusted activation.
    }
  }
  input.focus();
  if (!syntheticClicks.has(input)) {
    syntheticClicks.add(input);
    try {
      input.click();
    } finally {
      syntheticClicks.delete(input);
    }
  }
  return true;
}
