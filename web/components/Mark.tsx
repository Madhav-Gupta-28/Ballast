/**
 * The mark is the thesis: a slack outer span with a dense, deliberate weight
 * held inside it. Same shape as the spread rail, at 32px.
 */
export default function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="8.25" stroke="#35294f" strokeWidth="1.5" />
      <rect x="6" y="9" width="20" height="3" rx="1.5" fill="#4a4266" />
      <rect x="11" y="20" width="10" height="3" rx="1.5" fill="#a855f7" />
      <path d="M8 14.5v3M24 14.5v3" stroke="#35294f" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M13 14.5v3M19 14.5v3" stroke="#a855f7" strokeWidth="1.3" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}
