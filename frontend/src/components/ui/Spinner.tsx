export function Spinner({ size = 28 }: { size?: number }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      style={{
        width: size,
        height: size,
        display: 'inline-block',
        borderRadius: '50%',
        border: '3px solid var(--surface-2)',
        borderTopColor: 'var(--primary)',
        animation: 'spin 0.7s linear infinite',
      }}
    >
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </span>
  );
}
