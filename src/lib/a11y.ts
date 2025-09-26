export const setAria = (
  element: HTMLElement,
  attributes: Record<string, string>,
): void => {
  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key.startsWith('aria-') ? key : `aria-${key}`, value);
  });
};

export const trapFocusOutline = (): void => {
  document.body.addEventListener(
    'keydown',
    (event) => {
      if ((event as KeyboardEvent).key === 'Tab') {
        document.body.classList.add('user-is-tabbing');
      }
    },
    { passive: true },
  );
};
