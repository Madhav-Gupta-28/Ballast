/** A slack outer span with a dense weight held inside it — the spread rail at 28px. */
export default function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="9" stroke="var(--rule-2)" strokeWidth="1.5" />
      <rect x="6" y="9.5" width="20" height="2.6" rx="1.3" fill="var(--slack)" />
      <rect x="11" y="19.9" width="10" height="2.6" rx="1.3" fill="var(--accent)" />
      <path d="M8 14.4v3.2M24 14.4v3.2" stroke="var(--rule-2)" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M13 14.4v3.2M19 14.4v3.2" stroke="var(--accent)" strokeWidth="1.3" strokeLinecap="round" opacity=".5" />
    </svg>
  );
}
