import React from 'react';

/**
 * A reusable button component.
 * TODO: add aria-label support
 */
export function Button({ label, onClick, disabled = false }) {
  const [pressed, setPressed] = React.useState(false);

  React.useEffect(() => {
    if (pressed) {
      const timer = setTimeout(() => setPressed(false), 200);
      return () => clearTimeout(timer);
    }
  }, [pressed]);

  return (
    <button
      className={`btn ${pressed ? 'btn--pressed' : ''}`}
      onClick={(e) => {
        setPressed(true);
        onClick?.(e);
      }}
      disabled={disabled}
    >
      {label}
    </button>
  );
}

export default Button;
