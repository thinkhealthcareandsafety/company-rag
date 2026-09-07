export function PageLoader({ label }: { label?: string }) {
  return (
    <div className="page-loader">
      <span className="page-loader-spinner" />
      {label && <span className="page-loader-label">{label}</span>}
    </div>
  );
}

export function InlineSpinner() {
  return <span className="inline-spinner" />;
}
